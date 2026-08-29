import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  appendTrustedEvryConversationMessage,
  createEvryConversation,
  continueEvryConversation,
  resumeEvryConversation,
} from "@/lib/evry/conversations/service";
import {
  evryConversationMessageIdSchema,
  evryConversationRequestKeySchema,
} from "@/lib/evry/conversations/contract";
import {
  createEvryPlanCapabilityRegistry,
  defineEvryPlanCapability,
} from "@/lib/evry/plans/registry";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans/schema";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans/request-key";
import {
  confirmExactEvryActionPlan,
  createEvryActionPlanRecord,
} from "@/lib/evry/plans/repository";
import {
  findEvryExecutionSnapshot,
  finishEvryExecution,
  recordEvryStepOutcome,
  startOrResumeEvryExecution,
  countEvryExecutionAttempts,
} from "@/lib/evry/executor/repository";
import { executionEffectKey } from "@/lib/evry/audit/identity";

import {
  fingerprintEvryActiveRunRequest,
  type EvryActiveRunRecord,
} from "./contract";
import { evryActiveRunStore, type EvryActiveRunStore } from "./repository";
import type { EvryRunRecoveryPreviewProof } from "./preview-fixture-contract";

const FIXTURE_CAPABILITY_IDENTITY = "preview.evry.run-recovery-effect@1";
const FIXTURE_STEP_ID = "durable_fixture_effect";
const BASELINE_MESSAGE = "Preview-only active-run recovery proof.";
const READ_RESULT_MESSAGE =
  "The deterministic read run completed after a full-page reload.";
const EXECUTION_RESULT_MESSAGE =
  "The deterministic execution effect committed exactly once.";

const fixturePlanCapability = defineEvryPlanCapability({
  identity: FIXTURE_CAPABILITY_IDENTITY,
  effectClass: "database_write",
  arguments: {
    conversationId: z.string().uuid(),
  },
});
const fixturePlanRegistry = createEvryPlanCapabilityRegistry([
  fixturePlanCapability,
]);

export type EvryRunRecoveryPreviewFixtureBoundaries = Readonly<{
  runs: Pick<
    EvryActiveRunStore,
    "claim" | "find" | "countForRequest" | "advance" | "complete"
  >;
  createConversation: typeof createEvryConversation;
  continueConversation: typeof continueEvryConversation;
  resumeConversation: typeof resumeEvryConversation;
  append: typeof appendTrustedEvryConversationMessage;
  createPlan: typeof createEvryActionPlanRecord;
  confirmPlan: typeof confirmExactEvryActionPlan;
  findExecution: typeof findEvryExecutionSnapshot;
  countExecutionAttempts: typeof countEvryExecutionAttempts;
  startExecution: typeof startOrResumeEvryExecution;
  recordStep: typeof recordEvryStepOutcome;
  finishExecution: typeof finishEvryExecution;
  now(): Date;
  uuid(): string;
}>;

const productionBoundaries: EvryRunRecoveryPreviewFixtureBoundaries =
  Object.freeze({
    runs: evryActiveRunStore,
    createConversation: createEvryConversation,
    continueConversation: continueEvryConversation,
    resumeConversation: resumeEvryConversation,
    append: appendTrustedEvryConversationMessage,
    createPlan: createEvryActionPlanRecord,
    confirmPlan: confirmExactEvryActionPlan,
    findExecution: findEvryExecutionSnapshot,
    countExecutionAttempts: countEvryExecutionAttempts,
    startExecution: startOrResumeEvryExecution,
    recordStep: recordEvryStepOutcome,
    finishExecution: finishEvryExecution,
    now: () => new Date(),
    uuid: randomUUID,
  });

function derivedUuid(label: string, requestId: string): string {
  const bytes = createHash("sha256")
    .update(`evry-preview-recovery:${label}:${requestId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  bytes[12] = "4";
  bytes[16] = ((Number.parseInt(bytes[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16
  );
  return `${bytes.slice(0, 8).join("")}-${bytes.slice(8, 12).join("")}-${bytes
    .slice(12, 16)
    .join("")}-${bytes.slice(16, 20).join("")}-${bytes.slice(20).join("")}`;
}

async function baselineConversation(input: {
  actor: EvryPlantActor;
  boundaries: EvryRunRecoveryPreviewFixtureBoundaries;
}) {
  return input.boundaries.createConversation({
    actor: input.actor,
    requestKey: input.boundaries.uuid(),
    message: BASELINE_MESSAGE,
    pageContext: null,
    requestPageContext: null,
    now: input.boundaries.now(),
  });
}

async function previewProof(input: {
  actor: EvryPlantActor;
  requestId: string;
  boundaries: EvryRunRecoveryPreviewFixtureBoundaries;
}): Promise<EvryRunRecoveryPreviewProof | null> {
  const run = await input.boundaries.runs.find({
    actor: input.actor,
    requestKey: input.requestId,
  });
  if (!run?.conversationId) return null;
  const execution =
    run.kind === "execution" && run.planId && run.planFingerprint
      ? await input.boundaries.findExecution({
          planId: run.planId,
          actorUserId: input.actor.userId,
          plantId: input.actor.plantId,
          fingerprint: run.planFingerprint,
        })
      : null;
  const starts =
    run.kind === "execution" && run.planId && run.planFingerprint
      ? await input.boundaries.countExecutionAttempts({
          planId: run.planId,
          actorUserId: input.actor.userId,
          plantId: input.actor.plantId,
          fingerprint: run.planFingerprint,
        })
      : await input.boundaries.runs.countForRequest({
          actor: input.actor,
          requestKey: run.requestKey,
        });
  return {
    kind: run.kind === "execution" ? "execution" : "read",
    requestId: run.requestKey,
    runId: run.id,
    conversationId: run.conversationId,
    planId: run.planId,
    attemptId: execution?.attempt.id ?? null,
    starts,
    effectCount:
      execution?.steps.filter(({ status }) => status === "completed").length ??
      0,
    stage:
      run.status === "active"
        ? run.stage
        : run.status === "completed"
          ? "complete"
          : "failed",
    result:
      run.status === "active"
        ? "active"
        : run.status === "completed"
          ? "completed"
          : "failed",
  };
}

async function createFixturePlan(input: {
  actor: EvryPlantActor;
  conversationId: string;
  boundaries: EvryRunRecoveryPreviewFixtureBoundaries;
}) {
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: FIXTURE_STEP_ID,
          capabilityIdentity: FIXTURE_CAPABILITY_IDENTITY,
          arguments: { conversationId: input.conversationId },
          dependsOn: [],
        },
      ],
    },
    registry: fixturePlanRegistry,
    eligibleCapabilities: [{ identity: FIXTURE_CAPABILITY_IDENTITY }],
  });
  const plan = await input.boundaries.createPlan({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey: mintEvryPlanRequestKey(),
    document,
  });
  const confirmation = await input.boundaries.confirmPlan({
    planId: plan.id,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: plan.fingerprint,
    decidedAt: input.boundaries.now(),
  });
  if (
    confirmation.status !== "approved" &&
    confirmation.status !== "already_approved"
  ) {
    throw new Error("Preview recovery plan could not be approved");
  }
  return plan;
}

export async function startEvryRunRecoveryPreviewFixture(input: {
  actor: EvryPlantActor;
  kind: "read" | "execution";
  boundaries?: EvryRunRecoveryPreviewFixtureBoundaries;
}): Promise<EvryRunRecoveryPreviewProof> {
  const boundaries = input.boundaries ?? productionBoundaries;
  const baseline = await baselineConversation({
    actor: input.actor,
    boundaries,
  });
  const requestId = evryConversationRequestKeySchema.parse(boundaries.uuid());
  const startedAt = boundaries.now();
  let run: EvryActiveRunRecord;
  if (input.kind === "read") {
    const claim = await boundaries.runs.claim({
      actor: input.actor,
      requestKey: requestId,
      requestFingerprint: fingerprintEvryActiveRunRequest({
        version: 1,
        fixture: "stream-reconnect",
        operation: "continue",
        conversationId: baseline.conversation.id,
        message: READ_RESULT_MESSAGE,
      }),
      identity: {
        kind: "conversation",
        operation: "continue",
        conversationId: baseline.conversation.id,
        planId: null,
        planFingerprint: null,
      },
      startedAt,
    });
    run = claim.run;
  } else {
    const plan = await createFixturePlan({
      actor: input.actor,
      conversationId: baseline.conversation.id,
      boundaries,
    });
    const claim = await boundaries.runs.claim({
      actor: input.actor,
      requestKey: requestId,
      requestFingerprint: fingerprintEvryActiveRunRequest({
        version: 1,
        fixture: "stream-reconnect",
        action: "execute",
        conversationId: baseline.conversation.id,
        plan: { planId: plan.id, fingerprint: plan.fingerprint },
      }),
      identity: {
        kind: "execution",
        operation: "execute",
        conversationId: baseline.conversation.id,
        planId: plan.id,
        planFingerprint: plan.fingerprint,
      },
      startedAt,
    });
    run = claim.run;
    const execution = await boundaries.startExecution({
      planId: plan.id,
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      fingerprint: plan.fingerprint,
      startedAt,
    });
    if (!execution) {
      throw new Error("Preview recovery execution attempt did not persist");
    }
  }
  const proof = await previewProof({
    actor: input.actor,
    requestId,
    boundaries,
  });
  if (!proof || proof.runId !== run.id) {
    throw new Error("Preview recovery run did not persist");
  }
  return proof;
}

async function completeReadFixture(input: {
  actor: EvryPlantActor;
  run: EvryActiveRunRecord;
  boundaries: EvryRunRecoveryPreviewFixtureBoundaries;
}): Promise<void> {
  if (!input.run.conversationId)
    throw new Error("Read fixture lost its conversation");
  const continued = await input.boundaries.continueConversation({
    actor: input.actor,
    conversationId: input.run.conversationId,
    requestKey: input.run.requestKey,
    message: READ_RESULT_MESSAGE,
    pageContext: null,
    requestPageContext: null,
    now: input.boundaries.now(),
  });
  if (!continued) throw new Error("Read fixture could not persist its result");
  await input.boundaries.runs.complete({
    actor: input.actor,
    requestKey: input.run.requestKey,
    conversationId: continued.resumed.conversation.id,
    completedAt: input.boundaries.now(),
  });
}

async function completeExecutionFixture(input: {
  actor: EvryPlantActor;
  run: EvryActiveRunRecord;
  boundaries: EvryRunRecoveryPreviewFixtureBoundaries;
}): Promise<void> {
  if (
    !input.run.conversationId ||
    !input.run.planId ||
    !input.run.planFingerprint
  ) {
    throw new Error("Execution fixture lost its exact identity");
  }
  let snapshot = await input.boundaries.startExecution({
    planId: input.run.planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: input.run.planFingerprint,
    startedAt: input.boundaries.now(),
  });
  if (!snapshot)
    throw new Error("Execution fixture could not start its attempt");
  if (!snapshot.steps.some(({ stepId }) => stepId === FIXTURE_STEP_ID)) {
    const resumed = await input.boundaries.resumeConversation({
      actor: input.actor,
      conversationId: input.run.conversationId,
      now: input.boundaries.now(),
    });
    if (!resumed) throw new Error("Execution fixture conversation disappeared");
    await input.boundaries.append({
      messageId: evryConversationMessageIdSchema.parse(
        derivedUuid("message", input.run.requestKey)
      ),
      actor: input.actor,
      conversationId: resumed.conversation.id,
      requestKey: evryConversationRequestKeySchema.parse(
        derivedUuid("effect", input.run.requestKey)
      ),
      expectedStateVersion: resumed.conversation.stateVersion,
      state: resumed.conversation.state,
      author: "assistant",
      body: EXECUTION_RESULT_MESSAGE,
      pageContext: null,
      requestPageContext: null,
      relevanceKeys: [],
      deliveryStatus: "complete",
      artifacts: [],
      idempotencyContext: { status: "none" },
      activePlan: { mode: "preserve" },
      now: input.boundaries.now(),
    });
    await input.boundaries.recordStep({
      attempt: snapshot.attempt,
      stepId: FIXTURE_STEP_ID,
      capabilityIdentity: FIXTURE_CAPABILITY_IDENTITY,
      status: "completed",
      effectKey: executionEffectKey(
        input.run.planId,
        input.run.planFingerprint,
        FIXTURE_STEP_ID
      ),
      affectedCount: 1,
      excludedCount: 0,
      occurredAt: input.boundaries.now(),
    });
    snapshot =
      (await input.boundaries.findExecution({
        planId: input.run.planId,
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        fingerprint: input.run.planFingerprint,
      })) ?? snapshot;
  }
  if (!snapshot.terminalStatus) {
    snapshot = await input.boundaries.finishExecution({
      attempt: snapshot.attempt,
      attemptStatus: "completed",
      planStatus: "completed",
      occurredAt: input.boundaries.now(),
    });
  }
  if (snapshot.terminalStatus !== "completed") {
    throw new Error("Execution fixture did not durably complete");
  }
  await input.boundaries.runs.complete({
    actor: input.actor,
    requestKey: input.run.requestKey,
    conversationId: input.run.conversationId,
    completedAt: input.boundaries.now(),
  });
}

export async function completeEvryRunRecoveryPreviewFixture(input: {
  actor: EvryPlantActor;
  requestId: string;
  boundaries?: EvryRunRecoveryPreviewFixtureBoundaries;
}): Promise<EvryRunRecoveryPreviewProof | null> {
  const boundaries = input.boundaries ?? productionBoundaries;
  const run = await boundaries.runs.find({
    actor: input.actor,
    requestKey: input.requestId,
  });
  if (!run) return null;
  if (run.status === "active") {
    if (run.kind === "conversation") {
      await completeReadFixture({ actor: input.actor, run, boundaries });
    } else {
      await completeExecutionFixture({ actor: input.actor, run, boundaries });
    }
  }
  return previewProof({
    actor: input.actor,
    requestId: input.requestId,
    boundaries,
  });
}

export async function readEvryRunRecoveryPreviewFixture(input: {
  actor: EvryPlantActor;
  requestId: string;
  boundaries?: EvryRunRecoveryPreviewFixtureBoundaries;
}): Promise<EvryRunRecoveryPreviewProof | null> {
  return previewProof({
    actor: input.actor,
    requestId: input.requestId,
    boundaries: input.boundaries ?? productionBoundaries,
  });
}
