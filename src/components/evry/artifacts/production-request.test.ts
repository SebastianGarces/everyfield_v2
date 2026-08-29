import assert from "node:assert/strict";
import { test } from "node:test";

import type { PublicEvryConversation } from "@/components/evry/client-contract";
import { EVRY_CONFIRMATION_FIXTURES } from "@/lib/evry/artifacts/fixtures";
import {
  buildEvryProgressArtifact,
  buildEvryReceiptArtifact,
} from "@/lib/evry/artifacts/review";

import { coordinateEvryProductionArtifactRequest } from "./production-request";

const confirmation = EVRY_CONFIRMATION_FIXTURES.communication;
const requestKey = "10000000-0000-4000-8000-000000000001";
const baselineMessageId = "30000000-0000-4000-8000-000000000001";
const baselineArtifactId = "40000000-0000-4000-8000-000000000001";
const baseline = {
  stateVersion: 1,
  messageId: baselineMessageId,
  artifactId: baselineArtifactId,
} as const;

function conversation(
  artifact: PublicEvryConversation["messages"][number]["artifacts"][number]["artifact"],
  active = true
): PublicEvryConversation {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    title: "Launch update",
    createdAt: "2026-08-28T12:00:00.000Z",
    lastActivityAt: "2026-08-28T12:01:00.000Z",
    activePlan: active
      ? {
          identity: confirmation.plan,
          status: "executing",
          expiresAt: "2026-08-28T12:15:00.000Z",
          confirmable: false,
        }
      : null,
    stateVersion: 1,
    state: {},
    messages: [
      {
        id: baselineMessageId,
        sequence: 0,
        author: "assistant",
        body: "Review the stored artifact.",
        pageContext: null,
        deliveryStatus: "complete",
        createdAt: "2026-08-28T12:01:00.000Z",
        artifacts: [
          {
            id: baselineArtifactId,
            ordinal: 0,
            artifact,
          },
        ],
      },
    ],
  };
}

const safeRetryProgress = buildEvryProgressArtifact({
  kind: "progress",
  artifactVersion: 1,
  plan: confirmation.plan,
  title: "Safe retry available: Send a launch update",
  error: {
    kind: "expected",
    message: "Retry the exact plan to reconcile its durable outcome.",
  },
  steps: confirmation.steps.map((step) => ({
    stepId: step.stepId,
    label: step.title,
    status: "safe_retry",
    affectedCount: 0,
    excludedCount: 0,
  })),
});

const terminalReceipt = buildEvryReceiptArtifact({
  kind: "result",
  artifactVersion: 1,
  plan: confirmation.plan,
  title: "Launch update sent",
  status: "completed",
  steps: confirmation.steps.map((step) => ({
    stepId: step.stepId,
    label: step.title,
    status: "completed",
    resultCode: "effect_completed",
    affectedCount: 3,
    excludedCount: 1,
    sourceLinks: [],
    retry: { status: "unavailable" },
    error: null,
  })),
});

test("response-loss reconciliation reuses the exact request body and accepts persisted progress", async () => {
  const calls: Array<{ url: string; body?: string }> = [];
  const recoveredConversation = conversation(safeRetryProgress);
  const result = await coordinateEvryProductionArtifactRequest({
    conversationId: recoveredConversation.id,
    action: "execute",
    requestKey,
    plan: confirmation.plan,
    baseline,
    fetchArtifact: async (url, init) => {
      calls.push({ url, body: init.body });
      if (calls.length === 1) throw new Error("response lost after dispatch");
      return {
        async json() {
          return { status: "retryable", conversation: recoveredConversation };
        },
      };
    },
  });

  assert.deepEqual(result, {
    status: "conversation",
    conversation: recoveredConversation,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.body, calls[1]?.body);
  assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
    action: "execute",
    requestKey,
    plan: confirmation.plan,
  });
});

test("an unchanged safe-retry artifact does not reconcile two lost retry responses", async () => {
  const unchangedConversation = conversation(safeRetryProgress);
  let calls = 0;
  const result = await coordinateEvryProductionArtifactRequest({
    conversationId: unchangedConversation.id,
    action: "retry",
    requestKey,
    plan: confirmation.plan,
    baseline,
    fetchArtifact: async (_url, init) => {
      calls++;
      if (init.method === "POST") throw new Error("retry response lost");
      return {
        async json() {
          return { status: "available", conversation: unchangedConversation };
        },
      };
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(result, { status: "error", error: { kind: "uncertain" } });
});

test("new persisted progress reconciles two lost retry responses", async () => {
  const originalConversation = conversation(safeRetryProgress);
  const advancedMessage = {
    ...originalConversation.messages[0]!,
    id: "30000000-0000-4000-8000-000000000002",
    sequence: 1,
    artifacts: [
      {
        id: "40000000-0000-4000-8000-000000000002",
        ordinal: 0,
        artifact: safeRetryProgress,
      },
    ],
  };
  const advancedConversation: PublicEvryConversation = {
    ...originalConversation,
    stateVersion: baseline.stateVersion + 1,
    messages: [...originalConversation.messages, advancedMessage],
  };
  let calls = 0;
  const result = await coordinateEvryProductionArtifactRequest({
    conversationId: advancedConversation.id,
    action: "retry",
    requestKey,
    plan: confirmation.plan,
    baseline,
    fetchArtifact: async (_url, init) => {
      calls++;
      if (init.method === "POST") throw new Error("retry response lost");
      return {
        async json() {
          return { status: "available", conversation: advancedConversation };
        },
      };
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(result, {
    status: "conversation",
    conversation: advancedConversation,
  });
});

test("a terminal result replacing the baseline artifact in place stays uncertain", async () => {
  const replacedConversation = conversation(terminalReceipt, false);
  let calls = 0;
  const result = await coordinateEvryProductionArtifactRequest({
    conversationId: replacedConversation.id,
    action: "retry",
    requestKey,
    plan: confirmation.plan,
    baseline,
    fetchArtifact: async (_url, init) => {
      calls++;
      if (init.method === "POST") throw new Error("retry response lost");
      return {
        async json() {
          return { status: "available", conversation: replacedConversation };
        },
      };
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(result, { status: "error", error: { kind: "uncertain" } });
});

test("a newly appended terminal result reconciles two lost retry responses", async () => {
  const originalConversation = conversation(safeRetryProgress);
  const completedMessage = {
    ...originalConversation.messages[0]!,
    id: "30000000-0000-4000-8000-000000000003",
    sequence: 1,
    artifacts: [
      {
        id: "40000000-0000-4000-8000-000000000003",
        ordinal: 0,
        artifact: terminalReceipt,
      },
    ],
  };
  const completedConversation: PublicEvryConversation = {
    ...originalConversation,
    activePlan: null,
    stateVersion: baseline.stateVersion + 1,
    messages: [...originalConversation.messages, completedMessage],
  };
  let calls = 0;
  const result = await coordinateEvryProductionArtifactRequest({
    conversationId: completedConversation.id,
    action: "retry",
    requestKey,
    plan: confirmation.plan,
    baseline,
    fetchArtifact: async (_url, init) => {
      calls++;
      if (init.method === "POST") throw new Error("retry response lost");
      return {
        async json() {
          return { status: "available", conversation: completedConversation };
        },
      };
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(result, {
    status: "conversation",
    conversation: completedConversation,
  });
});

test("unreconciled transport loss stays nonterminal without a fake support reference", async () => {
  const originalConversation = conversation(confirmation);
  let calls = 0;
  const result = await coordinateEvryProductionArtifactRequest({
    conversationId: originalConversation.id,
    action: "execute",
    requestKey,
    plan: confirmation.plan,
    baseline,
    fetchArtifact: async (_url, init) => {
      calls++;
      if (init.method === "POST") throw new Error("transport lost");
      return {
        async json() {
          return { status: "available", conversation: originalConversation };
        },
      };
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(result, { status: "error", error: { kind: "uncertain" } });
});

test("only a server-issued unexpected correlation identity reaches the client", async () => {
  const correlationId = "50000000-0000-4000-8000-000000000001";
  let calls = 0;
  const result = await coordinateEvryProductionArtifactRequest({
    conversationId: "20000000-0000-4000-8000-000000000001",
    action: "execute",
    requestKey,
    plan: confirmation.plan,
    baseline,
    fetchArtifact: async () => {
      calls++;
      if (calls === 1) {
        return {
          async json() {
            return {
              status: "failed",
              error: { kind: "unexpected", correlationId },
            };
          },
        };
      }
      throw new Error("reconciliation unavailable");
    },
  });

  assert.deepEqual(result, {
    status: "error",
    error: { kind: "unexpected", correlationId },
  });
});
