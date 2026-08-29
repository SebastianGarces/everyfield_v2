import assert from "node:assert/strict";
import { test } from "node:test";

import type { PublicEvryConversation } from "@/components/evry/client-contract";
import { EVRY_CONFIRMATION_FIXTURES } from "@/lib/evry/artifacts/fixtures";
import { buildEvryProgressArtifact } from "@/lib/evry/artifacts/review";

import { coordinateEvryProductionArtifactRequest } from "./production-request";

const confirmation = EVRY_CONFIRMATION_FIXTURES.communication;
const requestKey = "10000000-0000-4000-8000-000000000001";

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
        id: "30000000-0000-4000-8000-000000000001",
        sequence: 0,
        author: "assistant",
        body: "Review the stored artifact.",
        pageContext: null,
        deliveryStatus: "complete",
        createdAt: "2026-08-28T12:01:00.000Z",
        artifacts: [
          {
            id: "40000000-0000-4000-8000-000000000001",
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

test("response-loss reconciliation reuses the exact request body and accepts persisted progress", async () => {
  const calls: Array<{ url: string; body?: string }> = [];
  const recoveredConversation = conversation(safeRetryProgress);
  const result = await coordinateEvryProductionArtifactRequest({
    conversationId: recoveredConversation.id,
    action: "execute",
    requestKey,
    plan: confirmation.plan,
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

test("unreconciled transport loss stays nonterminal without a fake support reference", async () => {
  const originalConversation = conversation(confirmation);
  let calls = 0;
  const result = await coordinateEvryProductionArtifactRequest({
    conversationId: originalConversation.id,
    action: "execute",
    requestKey,
    plan: confirmation.plan,
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
