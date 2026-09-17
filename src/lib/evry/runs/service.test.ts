import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evryConversationIdSchema,
  evryConversationMessageIdSchema,
  evryConversationRequestKeySchema,
  initialEvryConversationState,
  type EvryConversationRequestKey,
} from "@/lib/evry/conversations/contract";
import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";
import type { EvryResumedConversation } from "@/lib/evry/conversations/service";
import { compileEvryConversationContext } from "@/lib/evry/conversations/context";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import {
  EVRY_ACTIVE_RUN_TTL_MS,
  parseEvryActiveRunRecord,
  fingerprintEvryActiveRunRequest,
} from "./contract";
import { recoverEvryActiveRun } from "./service";

const PLANT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = evryConversationRequestKeySchema.parse(
  "30000000-0000-4000-8000-000000000001"
);
const OLDER_REQUEST_ID = evryConversationRequestKeySchema.parse(
  "30000000-0000-4000-8000-000000000002"
);
const CONVERSATION_ID = evryConversationIdSchema.parse(
  "40000000-0000-4000-8000-000000000001"
);
const START = new Date("2026-08-29T01:00:00.000Z");
const actor: EvryPlantActor = Object.freeze({
  userId: USER_ID,
  plantId: PLANT_ID,
  seat: "owner",
}) as unknown as EvryPlantActor;

function storedConversation(
  requestKey: EvryConversationRequestKey = REQUEST_ID
): EvryStoredConversation {
  return Object.freeze({
    id: CONVERSATION_ID,
    actorUserId: USER_ID,
    plantId: PLANT_ID,
    title: "Durable request",
    createdAt: START,
    lastActivityAt: START,
    activePlan: null,
    stateVersion: 0,
    state: initialEvryConversationState(),
    messages: Object.freeze([
      Object.freeze({
        id: evryConversationMessageIdSchema.parse(
          "50000000-0000-4000-8000-000000000001"
        ),
        requestKey,
        sequence: 0,
        author: "user" as const,
        body: "Durable request",
        pageContext: null,
        requestPageContext: null,
        replayReference: { status: "not_applicable" as const },
        relevanceKeys: Object.freeze([]),
        deliveryStatus: "complete" as const,
        createdAt: START,
        artifacts: Object.freeze([]),
      }),
    ]),
  });
}

function resumed(): EvryResumedConversation {
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

function activeRun() {
  return parseEvryActiveRunRecord({
    id: "60000000-0000-4000-8000-000000000001",
    churchId: PLANT_ID,
    actorUserId: USER_ID,
    requestKey: REQUEST_ID,
    requestFingerprint: "a".repeat(64),
    kind: "conversation",
    operation: "create",
    status: "active",
    stage: "compiling_response",
    version: 1,
    conversationId: null,
    planId: null,
    planFingerprint: null,
    startedAt: START,
    changedAt: new Date(START.valueOf() + 100),
    expiresAt: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
    completedAt: null,
  });
}

function expiredContinuation() {
  return parseEvryActiveRunRecord({
    id: "60000000-0000-4000-8000-000000000001",
    churchId: PLANT_ID,
    actorUserId: USER_ID,
    requestKey: REQUEST_ID,
    requestFingerprint: "a".repeat(64),
    kind: "conversation",
    operation: "continue",
    status: "active",
    stage: "compiling_response",
    version: 1,
    conversationId: CONVERSATION_ID,
    planId: null,
    planFingerprint: null,
    startedAt: START,
    changedAt: new Date(START.valueOf() + 100),
    expiresAt: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
    completedAt: null,
  });
}

function failedExecution() {
  return parseEvryActiveRunRecord({
    id: "60000000-0000-4000-8000-000000000002",
    churchId: PLANT_ID,
    actorUserId: USER_ID,
    requestKey: REQUEST_ID,
    requestFingerprint: "b".repeat(64),
    kind: "execution",
    operation: "execute",
    status: "failed",
    stage: "executing",
    version: 2,
    conversationId: CONVERSATION_ID,
    planId: "70000000-0000-4000-8000-000000000001",
    planFingerprint: "c".repeat(64),
    startedAt: START,
    changedAt: new Date(START.valueOf() + 1_000),
    expiresAt: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
    completedAt: new Date(START.valueOf() + 1_000),
  });
}

function reuseRun(status: "completed" | "failed") {
  const completedAt = new Date(START.valueOf() + 1_000);
  return parseEvryActiveRunRecord({
    id: "60000000-0000-4000-8000-000000000003",
    churchId: PLANT_ID,
    actorUserId: USER_ID,
    requestKey: REQUEST_ID,
    requestFingerprint: "d".repeat(64),
    kind: "conversation",
    operation: "reuse",
    status,
    stage: "compiling_response",
    version: 2,
    conversationId: status === "completed" ? CONVERSATION_ID : null,
    planId: null,
    planFingerprint: null,
    startedAt: START,
    changedAt: completedAt,
    expiresAt: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
    completedAt,
  });
}

test("an unexpired owner remains the only active run projection", async () => {
  let durableReads = 0;
  const result = await recoverEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now: new Date(START.valueOf() + 1_000),
    boundaries: {
      runs: { find: async () => activeRun() },
      resume: async () => {
        durableReads += 1;
        return null;
      },
      findConversationByRequest: async () => {
        durableReads += 1;
        return null;
      },
    },
  });
  assert.equal(result.status, "active");
  assert.equal(durableReads, 0);
});

test("expiry shows an unanswered saved request as interrupted without restarting its owner", async () => {
  const events: string[] = [];
  const result = await recoverEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS + 1),
    boundaries: {
      runs: {
        find: async () => {
          events.push("find-run");
          return activeRun();
        },
      },
      findConversationByRequest: async () => {
        events.push("find-durable-request");
        return storedConversation();
      },
      resume: async () => {
        events.push("resume-durable");
        return resumed();
      },
    },
  });
  assert.equal(result.status, "interrupted");
  if (result.status !== "interrupted")
    throw new Error("Expected interrupted request");
  assert.equal(
    result.retry,
    null,
    "an expired owner cannot be restarted by a recovery read"
  );
  assert.deepEqual(events, [
    "find-run",
    "find-durable-request",
    "resume-durable",
  ]);
});

for (const operation of ["create", "continue"] as const) {
  test(`${operation} recovery offers the server-owned exact failed request, without starting work`, async () => {
    const { plantId, ...row } = activeRun();
    const run = parseEvryActiveRunRecord({
      ...row,
      churchId: plantId,
      operation,
      status: "failed",
      completedAt: START,
      conversationId: operation === "continue" ? CONVERSATION_ID : null,
      requestFingerprint: fingerprintEvryActiveRunRequest({
        version: 1,
        operation,
        ...(operation === "continue"
          ? { conversationId: CONVERSATION_ID }
          : {}),
        message: "Durable request",
        pageContext: null,
      }),
    });
    const result = await recoverEvryActiveRun({
      actor,
      requestKey: REQUEST_ID,
      now: START,
      boundaries: {
        runs: { find: async () => run },
        resume: async () => resumed(),
        findConversationByRequest: async (input) => {
          assert.equal(input.actorUserId, USER_ID);
          assert.equal(input.plantId, PLANT_ID);
          assert.equal(input.requestKey, REQUEST_ID);
          return storedConversation();
        },
      },
    });
    assert.equal(result.status, "interrupted");
    if (result.status !== "interrupted")
      throw new Error("Expected interrupted request");
    assert.deepEqual(result.retry, {
      operation,
      message: "Durable request",
      pageContext: null,
      savedMessageId: storedConversation().messages[0]!.id,
    });
    for (const reason of [
      "fingerprint",
      "later_turn",
      "legacy_context",
    ] as const) {
      const original = storedConversation();
      const user = original.messages[0]!;
      const conversation: EvryStoredConversation = {
        ...original,
        messages:
          reason === "later_turn"
            ? [
                user,
                {
                  ...user,
                  id: evryConversationMessageIdSchema.parse(
                    "50000000-0000-4000-8000-000000000002"
                  ),
                  sequence: 1,
                  requestKey: OLDER_REQUEST_ID,
                  body: "Later request",
                },
              ]
            : [
                {
                  ...user,
                  ...(reason === "legacy_context"
                    ? { requestPageContext: undefined }
                    : {}),
                },
              ],
      };
      const blocked = await recoverEvryActiveRun({
        actor,
        requestKey: REQUEST_ID,
        now: START,
        boundaries: {
          runs: {
            find: async () =>
              reason === "fingerprint"
                ? { ...run, requestFingerprint: "f".repeat(64) }
                : run,
          },
          findConversationByRequest: async () => conversation,
          resume: async () => ({
            conversation,
            activePlan: null,
            context: compileEvryConversationContext({
              conversation,
              activePlan: null,
            }),
          }),
        },
      });
      assert.equal(blocked.status, "interrupted");
      if (blocked.status !== "interrupted")
        throw new Error("Expected interrupted request");
      assert.equal(blocked.retry, null, reason);
    }
  });
}

test("missing run history shows an interrupted request without inventing retry identity", async () => {
  const result = await recoverEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now: START,
    boundaries: {
      runs: { find: async () => null },
      resume: async () => resumed(),
      findConversationByRequest: async () => storedConversation(),
    },
  });
  assert.equal(result.status, "interrupted");
  if (result.status !== "interrupted")
    throw new Error("Expected interrupted request");
  assert.equal(result.retry, null);
});

test("expired and missing runs terminate when no durable state exists", async () => {
  const boundaries = {
    runs: { find: async () => activeRun() },
    findConversationByRequest: async () => null,
    resume: async () => null,
  };
  assert.deepEqual(
    await recoverEvryActiveRun({
      actor,
      requestKey: REQUEST_ID,
      now: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS + 1),
      boundaries,
    }),
    {
      status: "expired",
      requestId: REQUEST_ID,
      kind: "conversation",
      operation: "create",
      sequence: 2,
      conversationId: null,
    }
  );
  assert.deepEqual(
    await recoverEvryActiveRun({
      actor,
      requestKey: REQUEST_ID,
      now: START,
      boundaries: {
        ...boundaries,
        runs: { find: async () => null },
      },
    }),
    { status: "unavailable", requestId: REQUEST_ID }
  );
});

test("an expired continuation without its exact request never reuses older conversation state", async () => {
  let conversationResumeCount = 0;
  const result = await recoverEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS + 1),
    boundaries: {
      runs: { find: async () => expiredContinuation() },
      findConversationByRequest: async () => null,
      resume: async () => {
        conversationResumeCount += 1;
        return {
          ...resumed(),
          conversation: storedConversation(OLDER_REQUEST_ID),
        };
      },
    },
  });
  assert.deepEqual(result, {
    status: "expired",
    requestId: REQUEST_ID,
    kind: "conversation",
    operation: "continue",
    sequence: 2,
    conversationId: CONVERSATION_ID,
  });
  assert.equal(conversationResumeCount, 0);
});

test("a failed execution without an exact durable receipt never returns an older conversation", async () => {
  let conversationResumeCount = 0;
  const result = await recoverEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now: new Date(START.valueOf() + 2_000),
    boundaries: {
      runs: { find: async () => failedExecution() },
      findConversationByRequest: async () => null,
      resume: async () => {
        conversationResumeCount += 1;
        return {
          ...resumed(),
          conversation: storedConversation(OLDER_REQUEST_ID),
        };
      },
    },
  });
  assert.deepEqual(result, {
    status: "unavailable",
    requestId: REQUEST_ID,
  });
  assert.equal(conversationResumeCount, 0);
});

test("failed reuse never falls back to its rejected same-key conversation", async () => {
  let requestFallbackReads = 0;
  let resumes = 0;
  const result = await recoverEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    expectedOperation: "reuse",
    now: new Date(START.valueOf() + 2_000),
    boundaries: {
      runs: { find: async () => reuseRun("failed") },
      findConversationByRequest: async () => {
        requestFallbackReads += 1;
        return storedConversation();
      },
      resume: async () => {
        resumes += 1;
        return resumed();
      },
    },
  });
  assert.deepEqual(result, { status: "unavailable", requestId: REQUEST_ID });
  assert.equal(requestFallbackReads, 0);
  assert.equal(resumes, 0);
});

test("reuse recovery requires its operation row before request-key lookup", async () => {
  let requestFallbackReads = 0;
  const result = await recoverEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    expectedOperation: "reuse",
    now: new Date(START.valueOf() + 2_000),
    boundaries: {
      runs: { find: async () => null },
      findConversationByRequest: async () => {
        requestFallbackReads += 1;
        return storedConversation();
      },
      resume: async () => resumed(),
    },
  });
  assert.deepEqual(result, { status: "unavailable", requestId: REQUEST_ID });
  assert.equal(requestFallbackReads, 0);
});

test("completed reuse recovers only the destination bound by its run", async () => {
  let exactResumeId: string | null = null;
  const result = await recoverEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    expectedOperation: "reuse",
    now: new Date(START.valueOf() + 2_000),
    boundaries: {
      runs: { find: async () => reuseRun("completed") },
      findConversationByRequest: async () => {
        throw new Error("completed reuse cannot use request-key fallback");
      },
      resume: async ({ conversationId }) => {
        exactResumeId = conversationId;
        return resumed();
      },
    },
  });
  assert.equal(result.status, "durable");
  assert.equal(exactResumeId, CONVERSATION_ID);
});
