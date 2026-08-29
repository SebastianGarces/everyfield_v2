import assert from "node:assert/strict";
import { test } from "node:test";

import type { PublicEvryConversation } from "@/components/evry/client-contract";
import {
  EVRY_CONFIRMATION_FIXTURES,
  meetingProgressFixture,
  partialMeetingReceiptFixture,
} from "@/lib/evry/artifacts/fixtures";
import { evryPublicArtifactSchema } from "@/lib/evry/artifacts/public";

import { evryWorkStateForConversation } from "./conversation-state";

function conversationWith(
  artifact: PublicEvryConversation["messages"][number]["artifacts"][number]["artifact"]
): PublicEvryConversation {
  const plan = "plan" in artifact ? artifact.plan : null;
  return {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Controlled conversation",
    createdAt: "2026-08-28T12:00:00.000Z",
    lastActivityAt: "2026-08-28T12:00:00.000Z",
    activePlan:
      plan && artifact.kind === "confirmation"
        ? {
            identity: plan,
            status: "awaiting_confirmation",
            expiresAt: "2026-08-28T13:00:00.000Z",
            confirmable: true,
          }
        : null,
    stateVersion: 1,
    state: {},
    messages: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        sequence: 0,
        author: "assistant",
        body: "Structured result",
        pageContext: null,
        deliveryStatus: "complete",
        createdAt: "2026-08-28T12:00:00.000Z",
        artifacts: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            ordinal: 0,
            artifact,
          },
        ],
      },
    ],
  };
}

test("durable server artifacts own confirmation, execution, and receipt states", () => {
  const confirmation = evryPublicArtifactSchema.parse(
    EVRY_CONFIRMATION_FIXTURES.meeting
  );
  assert.equal(
    evryWorkStateForConversation(conversationWith(confirmation)).phase,
    "confirmation"
  );

  const progress = evryPublicArtifactSchema.parse(
    meetingProgressFixture(EVRY_CONFIRMATION_FIXTURES.meeting.plan)
  );
  assert.equal(
    evryWorkStateForConversation(conversationWith(progress)).phase,
    "execution"
  );

  const partialReceipt = evryPublicArtifactSchema.parse(
    partialMeetingReceiptFixture(EVRY_CONFIRMATION_FIXTURES.meeting.plan)
  );
  assert.deepEqual(
    evryWorkStateForConversation(conversationWith(partialReceipt)),
    {
      phase: "blocked",
      message: "Meeting created; invitations need attention",
    }
  );
});

test("expired or nonconfirmable durable confirmations reopen as blocked", () => {
  const confirmation = evryPublicArtifactSchema.parse(
    EVRY_CONFIRMATION_FIXTURES.meeting
  );
  const conversation = conversationWith(confirmation);
  assert.ok(conversation.activePlan);
  const reopened = {
    ...conversation,
    activePlan: {
      ...conversation.activePlan,
      status: "expired" as const,
      confirmable: false,
    },
  };
  assert.deepEqual(evryWorkStateForConversation(reopened), {
    phase: "blocked",
    message:
      "This confirmation is no longer current. Review the conversation before continuing.",
  });
});

test("legacy partial, failed, and refused results never reopen as polite completion", () => {
  const plan = EVRY_CONFIRMATION_FIXTURES.meeting.plan;
  function legacyResult(
    status: "completed" | "partially_failed" | "failed" | "refused"
  ) {
    return evryPublicArtifactSchema.parse({
      kind: "result",
      plan,
      title: `Legacy ${status}`,
      status,
      steps: [
        {
          stepId: "meeting.create",
          label: "Create meeting",
          status:
            status === "completed"
              ? "completed"
              : status === "refused"
                ? "refused"
                : "failed",
          resultCode:
            status === "completed"
              ? "effect_completed"
              : status === "refused"
                ? "precondition_refused"
                : "effect_failed",
          affectedCount: status === "completed" ? 1 : 0,
          excludedCount: 0,
          sourceLinks: [],
        },
      ],
    });
  }

  assert.equal(
    evryWorkStateForConversation(
      conversationWith(legacyResult("partially_failed"))
    ).phase,
    "blocked"
  );
  assert.equal(
    evryWorkStateForConversation(conversationWith(legacyResult("failed")))
      .phase,
    "failed"
  );
  assert.equal(
    evryWorkStateForConversation(conversationWith(legacyResult("refused")))
      .phase,
    "failed"
  );
  assert.equal(
    evryWorkStateForConversation(conversationWith(legacyResult("completed")))
      .phase,
    "complete"
  );
});
