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
import {
  evryConversationRequestKeySchema,
  evryConversationMessageIdSchema,
  evryResolvedReferenceSchema,
} from "@/lib/evry/conversations/contract";
import { composeEvryCapabilityConversationContinuations } from "@/lib/evry/capabilities/conversation";
import {
  appendTrustedEvryConversationMessage,
  continueEvryConversation,
  createEvryConversation,
} from "@/lib/evry/conversations/service";
import { publicEvryConversation } from "@/lib/evry/conversations/public";
import {
  createEvryConversationRecord,
  EvryConversationStateConflictError,
  EvryConversationIdempotencyError,
  findEvryConversationRecord,
} from "@/lib/evry/conversations/repository";
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
  evryActiveRunStore,
  findEvryActiveRun,
} from "./repository";
import { recoverEvryActiveRun } from "./service";
import {
  prepareEvryConversationActiveRun,
  runPreparedEvryConversationActiveRun,
  type EvryConversationRunInput,
} from "./conversation";

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

for (const operation of ["create", "continue"] as const)
  for (const failure of ["generation", "completion"] as const)
    test(
      `${operation}: failure during ${failure} retries the same saved turn once, even with two retry requests`,
      { skip },
      async () => {
        const [actor] = await fixture();
        assert.ok(actor);
        const requestKey = evryConversationRequestKeySchema.parse(randomUUID());
        const existing =
          operation === "continue"
            ? await createEvryConversationRecord({
                actorUserId: actor.userId,
                plantId: actor.plantId,
                requestKey:
                  evryConversationRequestKeySchema.parse(randomUUID()),
                body: "Earlier request",
                pageContext: null,
                requestPageContext: null,
                createdAt: new Date(),
              })
            : null;
        if (existing) conversations.push(existing.id);
        let modelCalls = 0;
        let completionCalls = 0;
        const boundaries = {
          runs: {
            ...evryActiveRunStore,
            async complete(input: Parameters<typeof completeEvryActiveRun>[0]) {
              completionCalls++;
              if (failure === "completion" && completionCalls === 1)
                throw new Error(
                  "isolated completion failure after response save"
                );
              return completeEvryActiveRun(input);
            },
          },
          recover: recoverEvryActiveRun,
          now: () => new Date(),
        };
        const continueCapabilityConversation =
          composeEvryCapabilityConversationContinuations([
            {
              identity: "isolated-provider",
              matches: () => true,
              async continue({ conversation }) {
                if (!conversations.includes(conversation.id))
                  conversations.push(conversation.id);
                modelCalls++;
                if (failure === "generation" && modelCalls === 1)
                  throw new Error("isolated model failure after message save");
                return { body: "You have no tasks due today.", artifacts: [] };
              },
            },
          ]);
        const input: EvryConversationRunInput = {
          actor,
          requestKey,
          identity: existing
            ? {
                kind: "conversation",
                operation: "continue",
                conversationId: existing.id,
                planId: null,
                planFingerprint: null,
              }
            : {
                kind: "conversation",
                operation: "create",
                conversationId: null,
                planId: null,
                planFingerprint: null,
              },
          fingerprintInput: {
            operation,
            message: "Show my tasks",
            pageContext: null,
          },
          startedAt: new Date(),
          perform: async (reportStage) => {
            const options = {
              actor,
              requestKey,
              message: "Show my tasks",
              pageContext: null,
              requestPageContext: null,
              now: new Date(),
              reportStage,
              continueCapabilityConversation,
            } satisfies Parameters<typeof createEvryConversation>[0];
            const resumed = existing
              ? (
                  await continueEvryConversation({
                    ...options,
                    conversationId: existing.id,
                  })
                )?.resumed
              : await createEvryConversation(options);
            assert.ok(resumed);
            return { conversation: publicEvryConversation(resumed) };
          },
        };
        const first = await prepareEvryConversationActiveRun(input);
        await assert.rejects(
          runPreparedEvryConversationActiveRun(first, () => {}, boundaries),
          failure === "generation"
            ? /isolated model failure/
            : /isolated completion failure/
        );
        assert.equal(
          (await findEvryActiveRun({ actor, requestKey }))?.status,
          "failed"
        );
        await assert.rejects(
          prepareEvryConversationActiveRun({
            ...input,
            fingerprintInput: {
              operation,
              message: "Different message",
              pageContext: null,
            },
          }),
          EvryActiveRunIdentityError,
          "a failed request key cannot be repurposed"
        );
        const retries = await Promise.all([
          prepareEvryConversationActiveRun({ ...input, startedAt: new Date() }),
          prepareEvryConversationActiveRun({ ...input, startedAt: new Date() }),
        ]);
        assert.deepEqual(retries.map(({ claim }) => claim.ownership).sort(), [
          "adopted",
          "claimed",
        ]);
        const owner = retries.find(
          ({ claim }) => claim.ownership === "claimed"
        )!;
        const recovered = await runPreparedEvryConversationActiveRun(
          owner,
          () => {},
          boundaries
        );
        assert.ok(recovered && "conversation" in recovered);
        assert.equal(
          recovered.conversation.messages.filter(
            ({ author }) => author === "user"
          ).length,
          existing ? 2 : 1
        );
        assert.equal(
          recovered.conversation.messages.filter(
            ({ author }) => author === "assistant"
          ).length,
          1
        );
        assert.equal(recovered.conversation.id, conversations.at(-1));
        const replay = await runPreparedEvryConversationActiveRun(
          retries.find(({ claim }) => claim.ownership === "adopted")!,
          () => {}
        );
        assert.deepEqual(replay, recovered);
        assert.equal(
          modelCalls,
          failure === "generation" ? 2 : 1,
          "a committed response is replayed without another provider call"
        );
        assert.equal(
          await countEvryActiveRunsForRequest({ actor, requestKey }),
          1
        );
      }
    );

test(
  "a saved request with an expired reference clarifies without rewriting the user turn",
  { skip },
  async () => {
    const [actor] = await fixture();
    assert.ok(actor);
    const now = new Date("2026-09-17T12:00:00Z");
    const base = await createEvryConversationRecord({
      actorUserId: actor.userId,
      plantId: actor.plantId,
      requestKey: evryConversationRequestKeySchema.parse(randomUUID()),
      body: "Find Alex",
      pageContext: null,
      requestPageContext: null,
      createdAt: now,
    });
    conversations.push(base.id);
    const reference = evryResolvedReferenceSchema.parse({
      key: "person:alex",
      entityType: "person",
      entityId: randomUUID(),
      label: "Alex",
      distinguishingFacts: [],
      sourceLink: { label: "Open Alex", href: "/people" },
      aliases: ["him"],
      sourceMessageId: base.messages[0]!.id,
      resolvedAt: now.toISOString(),
      validThrough: "2026-09-17T12:01:00Z",
    });
    await appendTrustedEvryConversationMessage({
      actor,
      conversationId: base.id,
      messageId: evryConversationMessageIdSchema.parse(randomUUID()),
      requestKey: evryConversationRequestKeySchema.parse(randomUUID()),
      expectedStateVersion: base.stateVersion,
      state: { ...base.state, resolvedReferences: [reference] },
      author: "assistant",
      body: "I found Alex.",
      pageContext: null,
      requestPageContext: null,
      relevanceKeys: [],
      deliveryStatus: "complete",
      artifacts: [],
      idempotencyContext: { status: "none" },
      replayReference: null,
      now,
    });
    let providerCalls = 0;
    const input = {
      actor,
      conversationId: base.id,
      requestKey: randomUUID(),
      message: "Show him",
      pageContext: null,
      requestPageContext: null,
      now,
      continueCapabilityConversation:
        composeEvryCapabilityConversationContinuations([
          {
            identity: "isolated-provider",
            matches: () => true,
            async continue() {
              providerCalls++;
              throw new Error("isolated provider failure");
            },
          },
        ]),
    };
    await assert.rejects(
      continueEvryConversation(input),
      /isolated provider failure/
    );
    await assert.rejects(
      continueEvryConversation({ ...input, message: "Show someone else" }),
      EvryConversationIdempotencyError
    );
    await assert.rejects(
      continueEvryConversation({
        ...input,
        pageContext: {
          kind: "person",
          recordId: randomUUID(),
          label: "Different person",
        },
      }),
      EvryConversationStateConflictError
    );
    const savedRequest = await findEvryConversationRecord({
      actorUserId: actor.userId,
      plantId: actor.plantId,
      conversationId: base.id,
    });
    assert.ok(savedRequest);
    await appendTrustedEvryConversationMessage({
      actor,
      conversationId: base.id,
      messageId: evryConversationMessageIdSchema.parse(randomUUID()),
      requestKey: evryConversationRequestKeySchema.parse(randomUUID()),
      expectedStateVersion: savedRequest.stateVersion,
      state: {
        ...savedRequest.state,
        resolvedReferences: [
          { ...reference, entityId: randomUUID(), label: "Taylor" },
        ],
      },
      author: "assistant",
      body: "Reference context updated.",
      pageContext: null,
      requestPageContext: null,
      relevanceKeys: [],
      deliveryStatus: "complete",
      artifacts: [],
      idempotencyContext: { status: "none" },
      replayReference: null,
      now,
    });
    await assert.rejects(
      continueEvryConversation(input),
      EvryConversationStateConflictError,
      "a retry must not bind him to a different person"
    );
    const result = await continueEvryConversation({
      ...input,
      now: new Date("2026-09-17T12:02:00Z"),
    });
    assert.equal(result?.status, "clarification");
    assert.equal(
      result?.reference.status === "clarification" && result.reference.reason,
      "stale"
    );
    assert.equal(providerCalls, 1);
    const saved = result!.resumed.conversation.messages.filter(
      (message) => message.requestKey === input.requestKey
    );
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0]!.replayReference, {
      status: "resolved",
      reference,
      relevanceKeys: [reference.key],
    });

    const current = result!.resumed.conversation;
    await appendTrustedEvryConversationMessage({
      actor,
      conversationId: base.id,
      messageId: evryConversationMessageIdSchema.parse(randomUUID()),
      requestKey: evryConversationRequestKeySchema.parse(randomUUID()),
      expectedStateVersion: current.stateVersion,
      state: current.state,
      author: "user",
      body: "Now find Taylor",
      pageContext: null,
      requestPageContext: null,
      relevanceKeys: [],
      deliveryStatus: "complete",
      artifacts: [],
      idempotencyContext: { status: "not_applicable" },
      replayReference: { status: "not_applicable" },
      now,
    });
    await assert.rejects(
      continueEvryConversation(input),
      EvryConversationStateConflictError
    );
    assert.equal(
      providerCalls,
      1,
      "a saved request cannot consume later user turns"
    );
  }
);

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
