import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evryConversationIdSchema,
  evryConversationMessageIdSchema,
  evryConversationPlanIdentitySchema,
  evryConversationRequestKeySchema,
  initialEvryConversationState,
} from "@/lib/evry/conversations/contract";
import { compileEvryConversationContext } from "@/lib/evry/conversations/context";
import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";
import type { EvryResumedConversation } from "@/lib/evry/conversations/service";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import {
  EVRY_ACTIVE_RUN_TTL_MS,
  parseEvryActiveRunRecord,
  type EvryActiveRunRecord,
} from "./contract";
import { resumeEvryActiveRun } from "./resume";

const START = new Date("2026-08-29T01:00:00.000Z");
const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const PLAN = evryConversationPlanIdentitySchema.parse({
  planId: "30000000-0000-4000-8000-000000000001",
  fingerprint: "a".repeat(64),
});
const actor = {
  userId: "40000000-0000-4000-8000-000000000001",
  plantId: "50000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;

function storedConversation(): EvryStoredConversation {
  return Object.freeze({
    id: evryConversationIdSchema.parse(CONVERSATION_ID),
    actorUserId: actor.userId,
    plantId: actor.plantId,
    title: "Durable execution",
    createdAt: START,
    lastActivityAt: START,
    activePlan: null,
    stateVersion: 0,
    state: initialEvryConversationState(),
    messages: Object.freeze([
      Object.freeze({
        id: evryConversationMessageIdSchema.parse(
          "70000000-0000-4000-8000-000000000001"
        ),
        requestKey: evryConversationRequestKeySchema.parse(REQUEST_ID),
        sequence: 0,
        author: "assistant" as const,
        body: "The execution already reached durable state.",
        pageContext: null,
        relevanceKeys: Object.freeze([]),
        deliveryStatus: "complete" as const,
        createdAt: START,
        artifacts: Object.freeze([]),
      }),
    ]),
  });
}

function resumedConversation(): EvryResumedConversation {
  const conversation = storedConversation();
  return Object.freeze({
    conversation,
    activePlan: null,
    context: compileEvryConversationContext({
      conversation,
      activePlan: null,
    }),
  });
}

function activeExecution() {
  return parseEvryActiveRunRecord({
    id: "60000000-0000-4000-8000-000000000001",
    churchId: actor.plantId,
    actorUserId: actor.userId,
    requestKey: REQUEST_ID,
    requestFingerprint: "b".repeat(64),
    kind: "execution",
    operation: "execute",
    status: "active",
    stage: "executing",
    version: 0,
    conversationId: CONVERSATION_ID,
    planId: PLAN.planId,
    planFingerprint: PLAN.fingerprint,
    startedAt: START,
    changedAt: START,
    expiresAt: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
    completedAt: null,
  });
}

function replaceExecution(
  current: EvryActiveRunRecord,
  overrides: Partial<Parameters<typeof parseEvryActiveRunRecord>[0]>
): EvryActiveRunRecord {
  return parseEvryActiveRunRecord({
    id: current.id,
    churchId: current.plantId,
    actorUserId: current.actorUserId,
    requestKey: current.requestKey,
    requestFingerprint: current.requestFingerprint,
    kind: current.kind,
    operation: current.operation,
    status: current.status,
    stage: current.stage,
    version: current.version,
    conversationId: current.conversationId,
    planId: current.planId,
    planFingerprint: current.planFingerprint,
    startedAt: current.startedAt,
    changedAt: current.changedAt,
    expiresAt: current.expiresAt,
    completedAt: current.completedAt,
    ...overrides,
  });
}

function durableResponse(sequence: number) {
  return {
    status: "durable" as const,
    requestId: REQUEST_ID,
    kind: "execution" as const,
    sequence,
    conversation: {
      id: CONVERSATION_ID,
      title: "Durable execution",
      createdAt: START.toISOString(),
      lastActivityAt: START.toISOString(),
      activePlan: null,
      stateVersion: 0,
      state: {},
      messages: [],
    },
  };
}

test("explicit expiry adoption reuses the exact request and plan, then settles once", async () => {
  let row = activeExecution();
  const lifecycleRequests: unknown[] = [];
  let completionCount = 0;
  let adoptionCount = 0;
  const durable = {
    status: "durable" as const,
    requestId: REQUEST_ID,
    kind: "execution" as const,
    sequence: 1,
    conversation: {
      id: CONVERSATION_ID,
      title: "Durable execution",
      createdAt: START.toISOString(),
      lastActivityAt: START.toISOString(),
      activePlan: null,
      stateVersion: 0,
      state: {},
      messages: [],
    },
  };
  const resumed = resumedConversation();
  const boundaries = {
    runs: {
      find: async () => row,
      adoptExpiredExecution: async ({
        expectedVersion,
        adoptedAt,
      }: {
        expectedVersion: number;
        adoptedAt: Date;
      }) => {
        if (
          row.version !== expectedVersion ||
          adoptedAt < row.expiresAt ||
          row.status !== "active"
        ) {
          return null;
        }
        adoptionCount += 1;
        row = parseEvryActiveRunRecord({
          id: row.id,
          churchId: row.plantId,
          actorUserId: row.actorUserId,
          requestKey: row.requestKey,
          requestFingerprint: row.requestFingerprint,
          kind: row.kind,
          operation: row.operation,
          status: row.status,
          stage: row.stage,
          version: row.version + 1,
          conversationId: row.conversationId,
          planId: row.planId,
          planFingerprint: row.planFingerprint,
          startedAt: row.startedAt,
          changedAt: adoptedAt,
          expiresAt: new Date(adoptedAt.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
          completedAt: null,
        });
        return row;
      },
      complete: async ({
        completedAt,
        expectedVersion,
      }: {
        completedAt: Date;
        expectedVersion?: number;
      }) => {
        if (expectedVersion !== row.version || row.status !== "active") {
          return row;
        }
        completionCount += 1;
        row = parseEvryActiveRunRecord({
          id: row.id,
          churchId: row.plantId,
          actorUserId: row.actorUserId,
          requestKey: row.requestKey,
          requestFingerprint: row.requestFingerprint,
          kind: row.kind,
          operation: row.operation,
          status: "completed",
          stage: row.stage,
          version: row.version + 1,
          conversationId: row.conversationId,
          planId: row.planId,
          planFingerprint: row.planFingerprint,
          startedAt: row.startedAt,
          changedAt: completedAt,
          expiresAt: row.expiresAt,
          completedAt,
        });
        return row;
      },
      fail: async () => row,
      releaseExecution: async () => row,
    },
    resumeExecution: async (input: unknown) => {
      lifecycleRequests.push(input);
      return {
        status: "already_finished" as const,
        resumed,
      };
    },
    recover: async () => durable,
  };
  const afterExpiry = new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS + 1);
  assert.equal(
    (
      await resumeEvryActiveRun({
        actor,
        requestKey: REQUEST_ID,
        now: afterExpiry,
        boundaries,
      })
    ).status,
    "durable"
  );
  assert.deepEqual(lifecycleRequests, [
    {
      actor,
      conversationId: CONVERSATION_ID,
      request: { action: "execute", requestKey: REQUEST_ID, plan: PLAN },
    },
  ]);
  assert.equal(completionCount, 1);
  assert.equal(adoptionCount, 1);

  await resumeEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now: afterExpiry,
    boundaries,
  });
  assert.equal(lifecycleRequests.length, 1);
  assert.equal(completionCount, 1);
  assert.equal(adoptionCount, 1);
});

test("only one reconnect owns an expired execution lease and the old epoch cannot settle", async () => {
  let row = activeExecution();
  let lifecycleCount = 0;
  const lifecycleEntered = Promise.withResolvers<void>();
  const allowLifecycle = Promise.withResolvers<void>();
  const store = {
    find: async () => row,
    adoptExpiredExecution: async ({
      expectedVersion,
      adoptedAt,
    }: {
      expectedVersion: number;
      adoptedAt: Date;
    }) => {
      if (
        row.status !== "active" ||
        row.version !== expectedVersion ||
        row.expiresAt > adoptedAt
      ) {
        return null;
      }
      row = replaceExecution(row, {
        version: row.version + 1,
        changedAt: adoptedAt,
        expiresAt: new Date(adoptedAt.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
      });
      return row;
    },
    complete: async ({
      expectedVersion,
      completedAt,
    }: {
      expectedVersion?: number;
      completedAt: Date;
    }) => {
      if (row.status !== "active" || row.version !== expectedVersion) {
        return row;
      }
      row = replaceExecution(row, {
        status: "completed",
        version: row.version + 1,
        changedAt: completedAt,
        completedAt,
      });
      return row;
    },
    fail: async () => row,
    releaseExecution: async () => row,
  };
  const now = new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS + 1);
  const boundaries = {
    runs: store,
    resumeExecution: async () => {
      lifecycleCount += 1;
      lifecycleEntered.resolve();
      await allowLifecycle.promise;
      return {
        status: "already_finished" as const,
        resumed: resumedConversation(),
      };
    },
    recover: async () =>
      row.status === "completed"
        ? durableResponse(row.version + 1)
        : {
            status: "active" as const,
            requestId: REQUEST_ID,
            kind: "execution" as const,
            operation: "execute" as const,
            sequence: row.version,
            stage: "executing" as const,
            conversationId: CONVERSATION_ID,
            expiresAt: row.expiresAt.toISOString(),
          },
  };

  const winner = resumeEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now,
    boundaries,
  });
  await lifecycleEntered.promise;
  assert.equal(row.version, 1);

  const concurrent = await resumeEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now,
    boundaries,
  });
  assert.equal(concurrent.status, "active");
  assert.equal(lifecycleCount, 1);

  const staleOwner = await store.complete({
    expectedVersion: 0,
    completedAt: now,
  });
  assert.equal(staleOwner?.status, "active");
  assert.equal(row.version, 1);

  allowLifecycle.resolve();
  assert.equal((await winner).status, "durable");
  assert.equal(row.status, "completed");
  assert.equal(lifecycleCount, 1);
});

test("an uncertain failure after an effect commit stays resumable and reconciles the same attempt", async () => {
  let row = activeExecution();
  let lifecycleCount = 0;
  let effectCount = 0;
  const firstNow = new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS + 1);
  const store = {
    find: async () => row,
    adoptExpiredExecution: async ({
      expectedVersion,
      adoptedAt,
    }: {
      expectedVersion: number;
      adoptedAt: Date;
    }) => {
      if (
        row.status !== "active" ||
        row.version !== expectedVersion ||
        row.expiresAt > adoptedAt
      ) {
        return null;
      }
      row = replaceExecution(row, {
        version: row.version + 1,
        changedAt: adoptedAt,
        expiresAt: new Date(adoptedAt.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
      });
      return row;
    },
    complete: async ({
      expectedVersion,
      completedAt,
    }: {
      expectedVersion?: number;
      completedAt: Date;
    }) => {
      if (row.status !== "active" || row.version !== expectedVersion) {
        return row;
      }
      row = replaceExecution(row, {
        status: "completed",
        version: row.version + 1,
        changedAt: completedAt,
        completedAt,
      });
      return row;
    },
    fail: async () => row,
    releaseExecution: async ({
      expectedVersion,
      releasedAt,
    }: {
      expectedVersion: number;
      releasedAt: Date;
    }) => {
      if (row.status !== "active" || row.version !== expectedVersion) {
        return row;
      }
      row = replaceExecution(row, {
        version: row.version + 1,
        changedAt: releasedAt,
        expiresAt: releasedAt,
      });
      return row;
    },
  };
  const recover = async () =>
    row.status === "completed"
      ? durableResponse(row.version + 1)
      : {
          status: "resumable" as const,
          requestId: REQUEST_ID,
          kind: "execution" as const,
          operation: "execute" as const,
          sequence: row.version,
          conversationId: CONVERSATION_ID,
        };
  const resumeExecution = async () => {
    lifecycleCount += 1;
    if (lifecycleCount === 1) {
      effectCount += 1;
      throw new Error("receipt append lost after committed effect");
    }
    return {
      status: "already_finished" as const,
      resumed: resumedConversation(),
    };
  };

  const uncertain = await resumeEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now: firstNow,
    boundaries: { runs: store, resumeExecution, recover },
  });
  assert.equal(uncertain.status, "resumable");
  assert.equal(row.status, "active");
  assert.equal(effectCount, 1);

  const reconciled = await resumeEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now: new Date(firstNow.valueOf() + 1),
    boundaries: { runs: store, resumeExecution, recover },
  });
  assert.equal(reconciled.status, "durable");
  assert.equal(row.status, "completed");
  assert.equal(lifecycleCount, 2);
  assert.equal(effectCount, 1);
});
