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
  confirmationMatchesTrustedPlan,
  progressFromRetryableEvryExecution,
  type EvryArtifactLifecycleBoundaries,
} from "./lifecycle";
import { buildEvryConfirmationArtifact } from "./review";

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
    "awaiting_confirmation" | "approved" | "executing" | "cancelled" =
    "awaiting_confirmation";
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
  let executeOverride: EvryArtifactLifecycleBoundaries["execute"] | null = null;
  let trustedConfirmation = EVRY_CONFIRMATION_FIXTURES.meeting;

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
      if (executeOverride) return executeOverride(input);
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
      return { confirmation: trustedConfirmation };
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
    setDisplayedConfirmation(
      confirmation: typeof EVRY_CONFIRMATION_FIXTURES.meeting
    ) {
      conversation = {
        ...conversation,
        messages: conversation.messages.map((storedMessage, index) =>
          index === 0
            ? {
                ...storedMessage,
                artifacts: [storedArtifact(confirmation)],
              }
            : storedMessage
        ),
      };
    },
    setExecuteResult(
      next: Awaited<ReturnType<EvryArtifactLifecycleBoundaries["execute"]>>
    ) {
      executeResult = next;
    },
    setExecuteError(error: unknown) {
      executeError = error;
    },
    setExecuteOverride(override: EvryArtifactLifecycleBoundaries["execute"]) {
      executeOverride = override;
    },
    setTrustedStepIds(stepIds: readonly string[]) {
      trustedConfirmation = {
        ...trustedConfirmation,
        steps: trustedConfirmation.steps.map((step, index) => ({
          ...step,
          stepId: stepIds[index] ?? step.stepId,
        })),
      };
    },
    setTrustedConfirmation(
      confirmation: typeof EVRY_CONFIRMATION_FIXTURES.meeting
    ) {
      trustedConfirmation = confirmation;
    },
  };
}

function request(
  action: "cancel" | "edit" | "execute" | "retry",
  requestKey = REQUEST_KEY
) {
  return {
    actor: ACTOR,
    conversationId: CONVERSATION_ID,
    request: {
      action,
      requestKey,
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

test("receipt survives cleanup failure and replay retries cleanup without a second effect", async () => {
  const fake = harness();
  let cleanupCalls = 0;
  const run = createEvryArtifactLifecycle({
    ...fake.boundaries,
    cleanupPlanResources: async () => ({
      failed: cleanupCalls++ === 0 ? 1 : 0,
    }),
  });

  await assert.rejects(
    run(request("execute")),
    /terminal resource cleanup remains incomplete/
  );
  assert.equal(fake.calls.filter((call) => call === "execute").length, 1);
  assert.equal(
    fake
      .conversation()
      .messages.flatMap(({ artifacts }) => artifacts)
      .some(({ document }) => document.kind === "result"),
    true
  );

  const replay = await run(request("execute"));
  assert.equal(replay.status, "already_finished");
  assert.equal(fake.calls.filter((call) => call === "execute").length, 1);
  assert.equal(cleanupCalls, 2);
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

test("terminal lifecycle states clean exact plan resources while safe retry preserves them", async () => {
  for (const action of ["cancel", "edit", "execute"] as const) {
    const fake = harness();
    const cleaned: unknown[] = [];
    const result = await createEvryArtifactLifecycle({
      ...fake.boundaries,
      cleanupPlanResources: async (input) => void cleaned.push(input),
    })(request(action));
    assert.equal(
      result.status,
      action === "cancel"
        ? "cancelled"
        : action === "edit"
          ? "editing"
          : "executed"
    );
    assert.deepEqual(cleaned, [
      {
        actor: ACTOR,
        plan: EVRY_CONFIRMATION_FIXTURES.meeting.plan,
      },
    ]);
  }

  const fake = harness();
  fake.setExecuteResult({
    status: "retryable",
    correlationId: "a0000000-0000-4000-8000-000000000003",
    steps: EVRY_CONFIRMATION_FIXTURES.meeting.steps.map((step) => ({
      stepId: step.stepId,
      capabilityIdentity: "fixture.effect",
      status: "retryable",
      durable: false,
      affectedCount: 0,
      excludedCount: 0,
    })),
  });
  let cleanupCalls = 0;
  const retryable = await createEvryArtifactLifecycle({
    ...fake.boundaries,
    cleanupPlanResources: async () => void cleanupCalls++,
  })(request("execute"));
  assert.equal(retryable.status, "retryable");
  assert.equal(cleanupCalls, 0);
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

test("complete trusted matching rejects destructive downgrades and added disclosure", () => {
  const destructive = EVRY_CONFIRMATION_FIXTURES.destructiveAction;
  const downgraded = buildEvryConfirmationArtifact({
    ...destructive,
    steps: destructive.steps.map((step) => ({
      ...step,
      effectKind: "other" as const,
      reversibility: "reversible" as const,
      beforeAfter: [],
    })),
  });
  assert.equal(
    confirmationMatchesTrustedPlan(downgraded, {
      confirmation: destructive,
    }),
    false
  );

  const expanded = buildEvryConfirmationArtifact({
    ...destructive,
    consequences: [...destructive.consequences, "Also removes another task."],
    steps: destructive.steps.map((step) => ({
      ...step,
      resolvedTargets: [
        ...step.resolvedTargets,
        { label: "Task", value: "Undisclosed second task", sourceLink: null },
      ],
    })),
  });
  assert.equal(
    confirmationMatchesTrustedPlan(expanded, { confirmation: destructive }),
    false
  );
});

test("schema-valid rich disclosure changes fail closed before confirmation", async () => {
  const fake = harness();
  const meeting = EVRY_CONFIRMATION_FIXTURES.meeting;
  const altered = buildEvryConfirmationArtifact({
    ...meeting,
    consequences: [...meeting.consequences, "Also changes another record."],
    steps: meeting.steps.map((step) =>
      step.stepId === "send-invitations"
        ? {
            ...step,
            effectKind: "other" as const,
            reversibility: "reversible" as const,
            resolvedTargets: [
              ...step.resolvedTargets,
              {
                label: "Recipient",
                value: "Undisclosed recipient",
                sourceLink: null,
              },
            ],
            contentPreviews: [],
            beforeAfter: [],
          }
        : step
    ),
  });
  fake.setDisplayedConfirmation(altered);

  const result = await createEvryArtifactLifecycle(fake.boundaries)(
    request("execute")
  );

  assert.equal(result.status, "unavailable");
  assert.deepEqual(fake.calls, ["review"]);
});

test("retryable execution preserves durable statuses in nonterminal progress", () => {
  const confirmation = EVRY_CONFIRMATION_FIXTURES.meeting;
  const statuses = [
    "completed",
    "refused",
    "failed",
    "skipped",
    "retryable",
  ] as const;
  const progress = progressFromRetryableEvryExecution({
    confirmation,
    result: {
      status: "retryable",
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
    progress.steps.map(({ status }) => status),
    ["completed", "refused", "failed", "skipped", "safe_retry"]
  );
  assert.equal(progress.error?.kind, "expected");
});

test("unexpected execution errors remain retryable and persist only server correlation identity", async () => {
  const fake = harness();
  fake.setExecuteError(new Error("provider secret database stack"));
  const result = await createEvryArtifactLifecycle(fake.boundaries)(
    request("execute")
  );
  assert.equal(result.status, "retryable");
  const progress = fake
    .conversation()
    .messages.flatMap(({ artifacts }) => artifacts)
    .map(({ document }) => document)
    .findLast(
      (document) =>
        document.kind === "progress" && "artifactVersion" in document
    );
  assert.ok(
    progress && progress.kind === "progress" && "artifactVersion" in progress
  );
  const serialized = JSON.stringify(progress);
  assert.match(serialized, /80000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(serialized, /provider secret|database|stack/);
  assert.equal(fake.conversation().activePlan?.planId, progress.plan.planId);
  assert.equal(
    progress.steps.some(({ status }) => status === "safe_retry"),
    true
  );
});

test("commit-then-response-loss resumes the same plan without a second effect", async () => {
  const fake = harness();
  const committedEffectKeys = new Set<string>();
  let adapterCalls = 0;
  fake.setExecuteOverride(async (input) => {
    const effectKey = `${input.planId}:${input.fingerprint}:create-meeting`;
    adapterCalls++;
    if (!committedEffectKeys.has(effectKey)) {
      committedEffectKeys.add(effectKey);
      return {
        status: "retryable",
        correlationId: "a0000000-0000-4000-8000-000000000003",
        steps: EVRY_CONFIRMATION_FIXTURES.meeting.steps.map((step) => ({
          stepId: step.stepId,
          capabilityIdentity: "fixture.effect",
          status: "retryable" as const,
          durable: false,
          affectedCount: 0,
          excludedCount: 0,
        })),
      };
    }
    return {
      status: "completed",
      correlationId: "a0000000-0000-4000-8000-000000000003",
      steps: EVRY_CONFIRMATION_FIXTURES.meeting.steps.map((step) => ({
        stepId: step.stepId,
        capabilityIdentity: "fixture.effect",
        status: "completed" as const,
        durable: true,
        affectedCount: 1,
        excludedCount: 0,
      })),
    };
  });
  const run = createEvryArtifactLifecycle(fake.boundaries);

  const uncertain = await run(request("execute"));
  assert.equal(uncertain.status, "retryable");
  assert.equal(fake.conversation().activePlan !== null, true);
  assert.equal(
    fake
      .conversation()
      .messages.flatMap(({ artifacts }) => artifacts)
      .some(({ document }) => document.kind === "result"),
    false
  );

  const ordinarySecondExecution = await run(
    request("execute", "20000000-0000-4000-8000-000000000002")
  );
  assert.equal(ordinarySecondExecution.status, "unavailable");
  assert.equal(adapterCalls, 1);

  const recovered = await run(
    request("retry", "20000000-0000-4000-8000-000000000003")
  );
  assert.equal(recovered.status, "executed");
  assert.equal(adapterCalls, 2);
  assert.equal(committedEffectKeys.size, 1);
  assert.equal(fake.conversation().activePlan, null);
});
