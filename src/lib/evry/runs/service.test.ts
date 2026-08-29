import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evryConversationIdSchema,
  evryConversationMessageIdSchema,
  evryConversationRequestKeySchema,
  initialEvryConversationState,
} from "@/lib/evry/conversations/contract";
import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";
import type { EvryResumedConversation } from "@/lib/evry/conversations/service";
import { compileEvryConversationContext } from "@/lib/evry/conversations/context";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import { EVRY_ACTIVE_RUN_TTL_MS, parseEvryActiveRunRecord } from "./contract";
import { recoverEvryActiveRun } from "./service";

const PLANT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = evryConversationRequestKeySchema.parse(
  "30000000-0000-4000-8000-000000000001"
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

function storedConversation(): EvryStoredConversation {
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
        requestKey: REQUEST_ID,
        sequence: 0,
        author: "user" as const,
        body: "Durable request",
        pageContext: null,
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

test("expiry reconciles durable output once and never creates a second owner", async () => {
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
  assert.equal(result.status, "durable");
  assert.deepEqual(events, [
    "find-run",
    "find-durable-request",
    "resume-durable",
  ]);
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
