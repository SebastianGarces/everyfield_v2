import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { createEvryExecutionCapabilityRegistry } from "@/lib/evry/executor";
import { createEvryPlanCapabilityRegistry } from "@/lib/evry/plans";
import {
  hydrateStoredEvryConversationArtifact,
  type StoredEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import {
  evryConversationIdSchema,
  evryConversationMessageIdSchema,
  evryConversationPlanIdentitySchema,
  evryConversationRequestKeySchema,
  initialEvryConversationState,
} from "@/lib/evry/conversations/contract";
import type { EvryConversationPlanResumeRevalidator } from "@/lib/evry/conversations/plan-resume";
import type {
  EvryStoredConversation,
  EvryStoredConversationArtifact,
  EvryStoredConversationMessage,
} from "@/lib/evry/conversations/repository";
import type {
  appendTrustedEvryConversationMessage,
  resumeEvryConversation,
} from "@/lib/evry/conversations/service";

import { EVRY_CONFIRMATION_FIXTURES } from "./fixtures";
import {
  createEvryArtifactLifecycle,
  receiptFromEvryExecution,
  unexpectedEvryReceipt,
  type EvryArtifactLifecycleBoundaries,
} from "./lifecycle";

const ACTOR = {
  userId: "user-1",
  plantId: "plant-1",
  seat: "champion",
} as unknown as EvryPlantActor;
const NOW = new Date("2026-08-28T12:00:00.000Z");
const CONVERSATION_ID = evryConversationIdSchema.parse(
  "10000000-0000-4000-8000-000000000001"
);
const REQUEST_KEY = "20000000-0000-4000-8000-000000000001";

function storedArtifact(
  document: StoredEvryConversationArtifactDocument,
  ordinal = 0
): EvryStoredConversationArtifact {
  return {
    id: "30000000-0000-4000-8000-" + String(ordinal + 1).padStart(12, "0"),
    ordinal,
    kind: document.kind,
    document,
    artifact: hydrateStoredEvryConversationArtifact(document),
  };
}

function message(input: {
  requestKey: string;
  sequence: number;
  artifacts?: readonly StoredEvryConversationArtifactDocument[];
  body?: string;
}): EvryStoredConversationMessage {
  return {
    id: evryConversationMessageIdSchema.parse(
      "40000000-0000-4000-8000-" + String(input.sequence + 1).padStart(12, "0")
    ),
    requestKey: evryConversationRequestKeySchema.parse(input.requestKey),
    sequence: input.sequence,
    author: "assistant",
    body: input.body ?? "Review this exact plan.",
    pageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    createdAt: NOW,
    artifacts: (input.artifacts ?? []).map(storedArtifact),
  };
}

function startingConversation(): EvryStoredConversation {
  const confirmation = EVRY_CONFIRMATION_FIXTURES.meeting;
  return {
    id: CONVERSATION_ID,
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    title: "Schedule the launch meeting",
    createdAt: NOW,
    lastActivityAt: NOW,
    activePlan: confirmation.plan,
    stateVersion: 0,
    state: initialEvryConversationState(),
    messages: [
      message({
        requestKey: "50000000-0000-4000-8000-000000000001",
        sequence: 0,
        artifacts: [confirmation],
      }),
    ],
  };
}

function harness() {
  let conversation = startingConversation();
  let planStatus:
    | "awaiting_confirmation"
    | "approved"
    | "executing"
    | "cancelled" = "awaiting_confirmation";
  const calls: string[] = [];
  let executeResult: Awaited<
    ReturnType<EvryArtifactLifecycleBoundaries["execute"]>
  > = {
    status: "completed",
    correlationId: "60000000-0000-4000-8000-000000000001",
    steps: EVRY_CONFIRMATION_FIXTURES.meeting.steps.map((step) => ({
      stepId: step.stepId,
      capabilityIdentity: "fixture.effect",
      status: "completed",
      durable: true,
      affectedCount: 1,
      excludedCount: 0,
    })),
  };
  let executeError: unknown = null;
  let trustedStepIds = EVRY_CONFIRMATION_FIXTURES.meeting.steps.map(
    ({ stepId }) => stepId
  );

  const resume = (async () => {
    const activePlan = conversation.activePlan
      ? {
          identity: conversation.activePlan,
          status: planStatus,
          expiresAt: "2026-08-28T13:00:00.000Z",
          confirmable: planStatus === "awaiting_confirmation",
        }
      : null;
    return {
      conversation,
      activePlan,
      context: {} as never,
    };
  }) as typeof resumeEvryConversation;

  const append = (async (
    input: Parameters<typeof appendTrustedEvryConversationMessage>[0]
  ) => {
    calls.push(
      "append:" +
        (input.artifacts[0]?.kind ?? "message") +
        ":" +
        input.activePlan?.mode
    );
    const nextMessage = message({
      requestKey: input.requestKey,
      sequence: conversation.messages.length,
      artifacts: input.artifacts,
      body: input.body,
    });
    conversation = {
      ...conversation,
      activePlan:
        input.activePlan?.mode === "clear" ? null : conversation.activePlan,
      stateVersion: conversation.stateVersion + 1,
      lastActivityAt: input.now,
      messages: [...conversation.messages, nextMessage],
    };
    return conversation;
  }) as typeof appendTrustedEvryConversationMessage;

  const revalidatePlan = (async () => {
    throw new Error("the fake resume owns plan revalidation");
  }) as EvryConversationPlanResumeRevalidator;
  const boundaries: EvryArtifactLifecycleBoundaries = {
    planRegistry: createEvryPlanCapabilityRegistry([]),
    executionRegistry: createEvryExecutionCapabilityRegistry([]),
    revalidatePlan,
    resume,
    append,
    async confirm(input) {
      calls.push("confirm");
      assert.equal(input.actor, ACTOR);
      assert.equal(
        input.planId,
        EVRY_CONFIRMATION_FIXTURES.meeting.plan.planId
      );
      assert.equal(
        input.fingerprint,
        EVRY_CONFIRMATION_FIXTURES.meeting.plan.fingerprint
      );
      planStatus = "approved";
      return {
        status: "approved",
        confirmationId: "70000000-0000-4000-8000-000000000001",
      };
    },
    async execute(input) {
      calls.push("execute");
      assert.equal(input.actor, ACTOR);
      assert.equal(
        input.planId,
        EVRY_CONFIRMATION_FIXTURES.meeting.plan.planId
      );
      assert.equal(
        input.fingerprint,
        EVRY_CONFIRMATION_FIXTURES.meeting.plan.fingerprint
      );
      planStatus = "executing";
      if (executeError) throw executeError;
      return executeResult;
    },
    async cancel(input) {
      calls.push("cancel");
      assert.equal(input.actorUserId, ACTOR.userId);
      assert.equal(input.plantId, ACTOR.plantId);
      assert.equal(
        input.planId,
        EVRY_CONFIRMATION_FIXTURES.meeting.plan.planId
      );
      assert.equal(
        input.fingerprint,
        EVRY_CONFIRMATION_FIXTURES.meeting.plan.fingerprint
      );
      planStatus = "cancelled";
      return true;
    },
    async reviewPlan(input) {
      calls.push("review");
      assert.equal(input.actor, ACTOR);
      assert.deepEqual(input.plan, EVRY_CONFIRMATION_FIXTURES.meeting.plan);
      return {
        confirmation: null,
        steps: trustedStepIds.map((stepId) => ({
          stepId,
          disclosure: null,
        })),
      };
    },
    now: () => NOW,
    correlationId: () => "80000000-0000-4000-8000-000000000001",
  };
  return {
    boundaries,
    calls,
    conversation: () => conversation,
    setConversation(next: EvryStoredConversation) {
      conversation = next;
    },
    setExecuteResult(
      next: Awaited<ReturnType<EvryArtifactLifecycleBoundaries["execute"]>>
    ) {
      executeResult = next;
    },
    setExecuteError(error: unknown) {
      executeError = error;
    },
    setTrustedStepIds(stepIds: readonly string[]) {
      trustedStepIds = [...stepIds];
    },
  };
}

function request(action: "cancel" | "edit" | "execute") {
  return {
    actor: ACTOR,
    conversationId: CONVERSATION_ID,
    request: {
      action,
      requestKey: REQUEST_KEY,
      plan: evryConversationPlanIdentitySchema.parse(
        EVRY_CONFIRMATION_FIXTURES.meeting.plan
      ),
    },
  } as const;
}

test("execute persists progress before the effect and a terminal receipt after it", async () => {
  const fake = harness();
  const result = await createEvryArtifactLifecycle(fake.boundaries)(
    request("execute")
  );

  assert.equal(result.status, "executed");
  assert.deepEqual(fake.calls, [
    "review",
    "confirm",
    "append:progress:preserve",
    "execute",
    "append:result:clear",
  ]);
  const documents = fake
    .conversation()
    .messages.flatMap(({ artifacts }) =>
      artifacts.map(({ document }) => document)
    );
  assert.equal(documents.at(-2)?.kind, "progress");
  assert.equal(documents.at(-1)?.kind, "result");
  assert.equal(fake.conversation().activePlan, null);
  const receipt = documents.at(-1);
  assert.equal(
    receipt?.kind === "result" && "artifactVersion" in receipt
      ? receipt.steps.length
      : 0,
    EVRY_CONFIRMATION_FIXTURES.meeting.steps.length
  );
});

test("a replay returns the persisted receipt without a second confirm or execution", async () => {
  const fake = harness();
  const run = createEvryArtifactLifecycle(fake.boundaries);
  await run(request("execute"));
  const callsAfterFirstRun = [...fake.calls];

  const replay = await run(request("execute"));

  assert.equal(replay.status, "already_finished");
  assert.deepEqual(fake.calls, callsAfterFirstRun);
});

test("cancel and edit durably cancel the exact plan and clear conversation authority", async () => {
  for (const action of ["cancel", "edit"] as const) {
    const fake = harness();
    const result = await createEvryArtifactLifecycle(fake.boundaries)(
      request(action)
    );
    assert.equal(result.status, action === "edit" ? "editing" : "cancelled");
    assert.deepEqual(fake.calls, ["cancel", "append:message:clear"]);
    assert.equal(fake.conversation().activePlan, null);
    assert.match(
      fake.conversation().messages.at(-1)?.body ?? "",
      action === "edit" ? /fresh plan/ : /cancelled/
    );
  }
});

test("a mismatched conversation plan reaches no plan or persistence boundary", async () => {
  const fake = harness();
  fake.setConversation({
    ...fake.conversation(),
    activePlan: evryConversationPlanIdentitySchema.parse({
      planId: "90000000-0000-4000-8000-000000000001",
      fingerprint: "9".repeat(64),
    }),
  });

  const result = await createEvryArtifactLifecycle(fake.boundaries)(
    request("execute")
  );

  assert.equal(result.status, "unavailable");
  assert.deepEqual(fake.calls, []);
});

test("a confirmation whose step lineage differs from the trusted plan cannot confirm or execute", async () => {
  const fake = harness();
  fake.setTrustedStepIds(["undisclosed-effect"]);

  const result = await createEvryArtifactLifecycle(fake.boundaries)(
    request("execute")
  );

  assert.equal(result.status, "unavailable");
  assert.deepEqual(fake.calls, ["review"]);
});

test("partial execution preserves all disclosed statuses and safe-retry state", () => {
  const confirmation = EVRY_CONFIRMATION_FIXTURES.meeting;
  const statuses = [
    "completed",
    "refused",
    "failed",
    "skipped",
    "retryable",
  ] as const;
  const receipt = receiptFromEvryExecution({
    confirmation,
    fallbackCorrelationId: "a0000000-0000-4000-8000-000000000001",
    result: {
      status: "partially_failed",
      correlationId: "a0000000-0000-4000-8000-000000000002",
      steps: confirmation.steps.map((step, index) => ({
        stepId: step.stepId,
        capabilityIdentity: "fixture.effect",
        status: statuses[index] ?? "failed",
        durable: statuses[index] !== "retryable",
        affectedCount: index === 0 ? 1 : 0,
        excludedCount: index === 3 ? 1 : 0,
      })),
    },
  });

  assert.deepEqual(
    receipt.steps.map(({ status }) => status),
    ["completed", "refused", "failed", "skipped", "failed"]
  );
  assert.equal(receipt.steps.at(-1)?.retry.status, "safe_retry");
  assert.equal(receipt.status, "partially_failed");
});

test("unexpected execution errors persist only fixed copy identity, never internals", async () => {
  const fake = harness();
  fake.setExecuteError(new Error("provider secret database stack"));
  const result = await createEvryArtifactLifecycle(fake.boundaries)(
    request("execute")
  );
  assert.equal(result.status, "executed");
  const receipt = fake
    .conversation()
    .messages.flatMap(({ artifacts }) => artifacts)
    .map(({ document }) => document)
    .findLast(
      (document) => document.kind === "result" && "artifactVersion" in document
    );
  assert.ok(
    receipt && receipt.kind === "result" && "artifactVersion" in receipt
  );
  const serialized = JSON.stringify(receipt);
  assert.match(serialized, /80000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(serialized, /provider secret|database|stack/);
});

test("unexpected receipt construction is exact-plan and exact-lineage", () => {
  const receipt = unexpectedEvryReceipt({
    confirmation: EVRY_CONFIRMATION_FIXTURES.communication,
    correlationId: "b0000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(
    receipt.steps.map(({ stepId }) => stepId),
    EVRY_CONFIRMATION_FIXTURES.communication.steps.map(({ stepId }) => stepId)
  );
  assert.deepEqual(receipt.plan, EVRY_CONFIRMATION_FIXTURES.communication.plan);
});
