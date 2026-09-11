import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  evryActionPlans,
  evryActionPlanStates,
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
  adoptExpiredEvryExecutionRun,
  claimEvryActiveRun,
  completeEvryActiveRun,
  countEvryActiveRunsForRequest,
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
// Immutable plans intentionally survive until this suite's disposable DB reset.
const retainedPlanActors = new Set<string>();
const retainedPlanPlants = new Set<string>();

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
  const removableActors = actors.filter((id) => !retainedPlanActors.has(id));
  const removablePlants = plants.filter((id) => !retainedPlanPlants.has(id));
  if (removableActors.length) {
    await db.delete(users).where(inArray(users.id, removableActors));
  }
  if (removablePlants.length) {
    await db.delete(churches).where(inArray(churches.id, removablePlants));
  }
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
    assert.equal(
      await countEvryActiveRunsForRequest({ actor: actor!, requestKey }),
      1
    );

    const reuseRequestKey =
      evryConversationRequestKeySchema.parse(randomUUID());
    const reuseIdentity = {
      kind: "conversation" as const,
      operation: "reuse" as const,
      conversationId: null,
      planId: null,
      planFingerprint: null,
    };
    const reuseFingerprint = fingerprintEvryActiveRunRequest({
      version: 1,
      operation: "reuse",
      sourceConversationId: randomUUID(),
      resultArtifactId: randomUUID(),
      recipeIdentity: "meeting.invitation.reference",
    });
    const reuseClaims = await Promise.all([
      claimEvryActiveRun({
        actor: actor!,
        requestKey: reuseRequestKey,
        requestFingerprint: reuseFingerprint,
        identity: reuseIdentity,
        startedAt,
      }),
      claimEvryActiveRun({
        actor: actor!,
        requestKey: reuseRequestKey,
        requestFingerprint: reuseFingerprint,
        identity: reuseIdentity,
        startedAt,
      }),
    ]);
    assert.deepEqual(reuseClaims.map(({ ownership }) => ownership).sort(), [
      "adopted",
      "claimed",
    ]);
    await assert.rejects(
      claimEvryActiveRun({
        actor: actor!,
        requestKey: reuseRequestKey,
        requestFingerprint: fingerprintEvryActiveRunRequest({
          version: 1,
          operation: "reuse",
          sourceConversationId: randomUUID(),
          resultArtifactId: randomUUID(),
          recipeIdentity: "meeting.invitation.reference",
        }),
        identity: reuseIdentity,
        startedAt,
      }),
      EvryActiveRunIdentityError
    );
    const completedReuse = await completeEvryActiveRun({
      actor: actor!,
      requestKey: reuseRequestKey,
      conversationId: conversation.id,
      completedAt: new Date(startedAt.valueOf() + 500),
    });
    assert.equal(completedReuse?.operation, "reuse");
    assert.equal(completedReuse?.conversationId, conversation.id);

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

test(
  "expired execution adoption is one atomic lease and fences the still-live owner",
  { skip },
  async () => {
    const [actor] = await fixture();
    const requestKey = evryConversationRequestKeySchema.parse(randomUUID());
    const conversation = await createEvryConversationRecord({
      actorUserId: actor!.userId,
      plantId: actor!.plantId,
      requestKey: evryConversationRequestKeySchema.parse(randomUUID()),
      body: "Execution lease fixture",
      pageContext: null,
      requestPageContext: null,
      createdAt: new Date(),
    });
    conversations.push(conversation.id);
    const planId = randomUUID();
    const planFingerprint = "c".repeat(64);
    const planCreatedAt = new Date();
    retainedPlanActors.add(actor!.userId);
    retainedPlanPlants.add(actor!.plantId);
    await db.batch([
      db.insert(evryActionPlans).values({
        id: planId,
        churchId: actor!.plantId,
        actorUserId: actor!.userId,
        requestKey: randomUUID(),
        intentFingerprint: "d".repeat(64),
        fingerprint: planFingerprint,
        document: {
          version: 1,
          steps: [
            {
              id: "lease-proof",
              capabilityIdentity: "proof.lease@1",
              effectClass: "reversible",
              arguments: {},
              dependsOn: [],
            },
          ],
        },
        createdAt: planCreatedAt,
        expiresAt: new Date(planCreatedAt.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
      }),
      db.insert(evryActionPlanStates).values({
        planId,
        churchId: actor!.plantId,
        status: "executing",
        changedAt: planCreatedAt,
      }),
    ]);

    const startedAt = new Date(Date.now() - EVRY_ACTIVE_RUN_TTL_MS - 1_000);
    const requestFingerprint = fingerprintEvryActiveRunRequest({
      action: "execute",
      conversationId: conversation.id,
      plan: { planId, fingerprint: planFingerprint },
    });
    const identity = {
      kind: "execution" as const,
      operation: "execute" as const,
      conversationId: conversation.id,
      planId,
      planFingerprint,
    };
    const original = await claimEvryActiveRun({
      actor: actor!,
      requestKey,
      requestFingerprint,
      identity,
      startedAt,
    });
    const adoptedAt = new Date();
    const adopters = await Promise.all([
      adoptExpiredEvryExecutionRun({
        actor: actor!,
        requestKey,
        expectedVersion: original.run.version,
        adoptedAt,
      }),
      adoptExpiredEvryExecutionRun({
        actor: actor!,
        requestKey,
        expectedVersion: original.run.version,
        adoptedAt,
      }),
    ]);
    const winners = adopters.filter((run) => run !== null);
    assert.equal(winners.length, 1);
    assert.equal(winners[0]?.version, original.run.version + 1);

    const staleCompletion = await completeEvryActiveRun({
      actor: actor!,
      requestKey,
      conversationId: conversation.id,
      completedAt: adoptedAt,
      expectedVersion: original.run.version,
    });
    assert.equal(staleCompletion?.status, "active");
    assert.equal(staleCompletion?.version, winners[0]?.version);

    const winnerCompletion = await completeEvryActiveRun({
      actor: actor!,
      requestKey,
      conversationId: conversation.id,
      completedAt: adoptedAt,
      expectedVersion: winners[0]!.version,
    });
    assert.equal(winnerCompletion?.status, "completed");
  }
);
