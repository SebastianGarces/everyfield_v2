import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  evryActiveRuns,
  evryConversationArtifacts,
  evryConversationMessages,
  evryConversations,
  evryConversationStates,
  users,
} from "@/db/schema";
import { evryConversationRequestKeySchema } from "@/lib/evry/conversations/contract";
import { createEvryConversationRecord } from "@/lib/evry/conversations/repository";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import {
  EVRY_ACTIVE_RUN_TTL_MS,
  EvryActiveRunIdentityError,
  fingerprintEvryActiveRunRequest,
} from "./contract";
import {
  claimEvryActiveRun,
  completeEvryActiveRun,
  findEvryActiveRun,
} from "./repository";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres is required";
const SCRATCH = "__evry active runs live__";
const plants: string[] = [];
const actors: string[] = [];
const conversations: string[] = [];

after(async () => {
  if (!LIVE_DB) return;
  if (actors.length) {
    await db
      .delete(evryActiveRuns)
      .where(inArray(evryActiveRuns.actorUserId, actors));
  }
  if (conversations.length) {
    await db
      .delete(evryConversationArtifacts)
      .where(inArray(evryConversationArtifacts.conversationId, conversations));
    await db
      .delete(evryConversationMessages)
      .where(inArray(evryConversationMessages.conversationId, conversations));
    await db
      .delete(evryConversationStates)
      .where(inArray(evryConversationStates.conversationId, conversations));
    await db
      .delete(evryConversations)
      .where(inArray(evryConversations.id, conversations));
  }
  if (actors.length) await db.delete(users).where(inArray(users.id, actors));
  if (plants.length)
    await db.delete(churches).where(inArray(churches.id, plants));
});

async function fixture() {
  const insertedPlants = await db
    .insert(churches)
    .values([{ name: SCRATCH }, { name: SCRATCH }])
    .returning({ id: churches.id });
  plants.push(...insertedPlants.map(({ id }) => id));
  const insertedActors = await db
    .insert(users)
    .values([
      {
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: SCRATCH,
        seat: "owner",
        churchId: insertedPlants[0]!.id,
      },
      {
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: SCRATCH,
        seat: "admin",
        churchId: insertedPlants[1]!.id,
      },
    ])
    .returning({ id: users.id, churchId: users.churchId, seat: users.seat });
  actors.push(...insertedActors.map(({ id }) => id));
  return insertedActors.map(
    (actor) =>
      ({
        userId: actor.id,
        plantId: actor.churchId!,
        seat: actor.seat!,
      }) as unknown as EvryPlantActor
  );
}

test(
  "active runs claim once, stay actor-private, and replay durable completion",
  { skip },
  async () => {
    await db.execute(sql`select 1`);
    const [actor, foreignActor] = await fixture();
    const requestKey = evryConversationRequestKeySchema.parse(randomUUID());
    const conversation = await createEvryConversationRecord({
      actorUserId: actor!.userId,
      plantId: actor!.plantId,
      requestKey: evryConversationRequestKeySchema.parse(randomUUID()),
      body: "Durable run fixture",
      pageContext: null,
      requestPageContext: null,
      createdAt: new Date(),
    });
    conversations.push(conversation.id);
    const startedAt = new Date();
    const requestFingerprint = fingerprintEvryActiveRunRequest({
      operation: "create",
      message: "Durable run fixture",
    });
    const identity = {
      kind: "conversation" as const,
      operation: "create" as const,
      conversationId: null,
      planId: null,
      planFingerprint: null,
    };

    const claims = await Promise.all([
      claimEvryActiveRun({
        actor: actor!,
        requestKey,
        requestFingerprint,
        identity,
        startedAt,
      }),
      claimEvryActiveRun({
        actor: actor!,
        requestKey,
        requestFingerprint,
        identity,
        startedAt,
      }),
    ]);
    assert.deepEqual(claims.map(({ ownership }) => ownership).sort(), [
      "adopted",
      "claimed",
    ]);
    const [count] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(evryActiveRuns)
      .where(
        and(
          eq(evryActiveRuns.churchId, actor!.plantId),
          eq(evryActiveRuns.actorUserId, actor!.userId),
          eq(evryActiveRuns.requestKey, requestKey)
        )
      );
    assert.equal(count?.count, 1);

    const expiredRequestKey =
      evryConversationRequestKeySchema.parse(randomUUID());
    const expiredStartedAt = new Date(
      startedAt.valueOf() - EVRY_ACTIVE_RUN_TTL_MS - 1
    );
    const expiredClaim = await claimEvryActiveRun({
      actor: actor!,
      requestKey: expiredRequestKey,
      requestFingerprint,
      identity,
      startedAt: expiredStartedAt,
    });
    const expiredReplay = await claimEvryActiveRun({
      actor: actor!,
      requestKey: expiredRequestKey,
      requestFingerprint,
      identity,
      startedAt,
    });
    assert.equal(expiredClaim.ownership, "claimed");
    assert.equal(expiredReplay.ownership, "adopted");
    assert.equal(expiredReplay.run.id, expiredClaim.run.id);

    await assert.rejects(
      claimEvryActiveRun({
        actor: actor!,
        requestKey,
        requestFingerprint: "f".repeat(64),
        identity,
        startedAt,
      }),
      EvryActiveRunIdentityError
    );
    assert.equal(
      await findEvryActiveRun({ actor: foreignActor!, requestKey }),
      null
    );
    const foreignClaim = await claimEvryActiveRun({
      actor: foreignActor!,
      requestKey,
      requestFingerprint,
      identity,
      startedAt,
    });
    assert.equal(foreignClaim.ownership, "claimed");
    await db.delete(users).where(eq(users.id, foreignActor!.userId));
    assert.equal(
      await findEvryActiveRun({ actor: foreignActor!, requestKey }),
      null,
      "deleting the owning user cascades its metadata-only run"
    );
    await db.delete(churches).where(eq(churches.id, foreignActor!.plantId));

    const completed = await completeEvryActiveRun({
      actor: actor!,
      requestKey,
      conversationId: conversation.id,
      completedAt: new Date(startedAt.valueOf() + 1_000),
    });
    assert.equal(completed?.status, "completed");
    const replay = await claimEvryActiveRun({
      actor: actor!,
      requestKey,
      requestFingerprint,
      identity,
      startedAt,
    });
    assert.equal(replay.ownership, "adopted");
    assert.equal(replay.run.conversationId, conversation.id);

    await db
      .delete(evryConversationMessages)
      .where(eq(evryConversationMessages.conversationId, conversation.id));
    await db
      .delete(evryConversationStates)
      .where(eq(evryConversationStates.conversationId, conversation.id));
    await db
      .delete(evryConversations)
      .where(eq(evryConversations.id, conversation.id));
    assert.equal(
      await findEvryActiveRun({ actor: actor!, requestKey }),
      null,
      "deleting the owning conversation cascades its run"
    );
  }
);
