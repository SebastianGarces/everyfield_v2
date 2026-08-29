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

import { EVRY_ACTIVE_RUN_TTL_MS, parseEvryActiveRunRecord } from "./contract";
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

test("explicit expiry adoption reuses the exact request and plan, then settles once", async () => {
  let row = activeExecution();
  const lifecycleRequests: unknown[] = [];
  let completionCount = 0;
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
      claim: async () => {
        throw new Error("resume must not claim a second run");
      },
      advance: async () => {
        throw new Error("execution resume has no conversation stage");
      },
      complete: async ({ completedAt }: { completedAt: Date }) => {
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
          version: 1,
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

  await resumeEvryActiveRun({
    actor,
    requestKey: REQUEST_ID,
    now: afterExpiry,
    boundaries,
  });
  assert.equal(lifecycleRequests.length, 1);
  assert.equal(completionCount, 1);
});
