import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVRY_CONFIRMATION_FIXTURES,
  UNEXPECTED_ERROR_RECEIPT,
} from "@/lib/evry/artifacts/fixtures";

import {
  parseEvryArtifactLifecycleResponse,
  parseEvryConversationEnvelope,
} from "./client-contract";

function envelope(artifact: unknown): unknown {
  return {
    status: "available",
    conversation: {
      id: "10000000-0000-4000-8000-000000000001",
      title: "Launch update",
      createdAt: "2026-08-28T12:00:00.000Z",
      lastActivityAt: "2026-08-28T12:01:00.000Z",
      activePlan: null,
      stateVersion: 1,
      state: {},
      messages: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          sequence: 0,
          author: "assistant",
          body: "The update could not be sent.",
          pageContext: null,
          deliveryStatus: "complete",
          createdAt: "2026-08-28T12:01:00.000Z",
          artifacts: [
            {
              id: "30000000-0000-4000-8000-000000000001",
              ordinal: 0,
              artifact,
            },
          ],
        },
      ],
    },
  };
}

test("the browser response accepts the closed unexpected error identity", () => {
  const conversation = parseEvryConversationEnvelope(
    envelope(UNEXPECTED_ERROR_RECEIPT)
  );
  assert.deepEqual(
    conversation.messages[0]?.artifacts[0]?.artifact,
    UNEXPECTED_ERROR_RECEIPT
  );
});

test("the browser response refuses unexpected error detail from a request", () => {
  assert.throws(() =>
    parseEvryConversationEnvelope(
      envelope({
        ...UNEXPECTED_ERROR_RECEIPT,
        steps: UNEXPECTED_ERROR_RECEIPT.steps.map((step) => ({
          ...step,
          error:
            step.error?.kind === "unexpected"
              ? {
                  ...step.error,
                  message: "database details, provider response, and prompt",
                }
              : step.error,
        })),
      })
    )
  );
});

test("the browser response refuses unknown artifact variants", () => {
  assert.throws(() =>
    parseEvryConversationEnvelope(
      envelope({ kind: "model_component", html: "<script>alert(1)</script>" })
    )
  );
});

test("the browser accepts only a closed, revalidated active-plan projection", () => {
  const input = envelope(EVRY_CONFIRMATION_FIXTURES.communication) as {
    conversation: Record<string, unknown>;
  };
  input.conversation.activePlan = {
    identity: EVRY_CONFIRMATION_FIXTURES.communication.plan,
    status: "awaiting_confirmation",
    expiresAt: "2026-08-28T12:15:00.000Z",
    confirmable: true,
  };
  const conversation = parseEvryConversationEnvelope(input);
  assert.equal(conversation.activePlan?.confirmable, true);

  input.conversation.activePlan = {
    ...(conversation.activePlan ?? {}),
    callerSelectedSteps: ["send-message"],
  };
  assert.throws(() => parseEvryConversationEnvelope(input));
});

test("artifact lifecycle errors cannot expose unexpected detail", () => {
  assert.deepEqual(
    parseEvryArtifactLifecycleResponse({
      status: "failed",
      error: {
        kind: "unexpected",
        correlationId: "40000000-0000-4000-8000-000000000001",
      },
    }),
    {
      status: "failed",
      error: {
        kind: "unexpected",
        correlationId: "40000000-0000-4000-8000-000000000001",
      },
    }
  );
  assert.throws(() =>
    parseEvryArtifactLifecycleResponse({
      status: "failed",
      error: {
        kind: "unexpected",
        correlationId: "40000000-0000-4000-8000-000000000001",
        detail: "provider response and database stack",
      },
    })
  );
});
