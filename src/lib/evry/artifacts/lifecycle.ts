import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type {
  ExecuteEvryActionPlanResult,
  EvryExecutionCapabilityRegistry,
} from "@/lib/evry/executor";
import type { EvryPlanCapabilityRegistry } from "@/lib/evry/plans";
import type { ConfirmEvryActionPlanResult } from "@/lib/evry/plans/repository";
import {
  evryConversationIdSchema,
  evryConversationMessageIdSchema,
  evryConversationPlanIdentitySchema,
  evryConversationRequestKeySchema,
  type EvryConversationPlanIdentity,
} from "@/lib/evry/conversations/contract";
import type { EvryConversationPlanResumeRevalidator } from "@/lib/evry/conversations/plan-resume";
import type {
  EvryResumedConversation,
  appendTrustedEvryConversationMessage,
  resumeEvryConversation,
} from "@/lib/evry/conversations/service";
import type {
  EvryStoredConversation,
  EvryStoredConversationMessage,
} from "@/lib/evry/conversations/repository";

import {
  buildEvryProgressArtifact,
  evryDetailedConfirmationArtifactDocumentSchema,
  type EvryDetailedConfirmationArtifactDocument,
  type EvryDetailedProgressArtifactDocument,
  type EvryDetailedReceiptArtifactDocument,
} from "./review";
import {
  pendingEvryProgress,
  receiptFromEvryExecution,
  progressFromRetryableEvryExecution,
} from "./execution-result";
import type { EvryTrustedPlanReview } from "./trusted-plan-review";
export type { EvryTrustedPlanReview } from "./trusted-plan-review";

export const evryArtifactLifecycleRequestSchema = z
  .strictObject({
    action: z.enum(["cancel", "edit", "execute", "retry"]),
    requestKey: z.string().uuid(),
    plan: evryConversationPlanIdentitySchema,
  })
  .readonly();

export type EvryArtifactLifecycleRequest = z.infer<
  typeof evryArtifactLifecycleRequestSchema
>;

type ConfirmExactPlan = (input: {
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
  decidedAt: Date;
  registry: EvryPlanCapabilityRegistry;
}) => Promise<ConfirmEvryActionPlanResult>;

type ExecuteExactPlan = (input: {
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
  registry: EvryExecutionCapabilityRegistry;
}) => Promise<ExecuteEvryActionPlanResult>;

type CancelExactPlan = (input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  cancelledAt: Date;
}) => Promise<boolean>;

type ResumeConversation = typeof resumeEvryConversation;
type AppendMessage = typeof appendTrustedEvryConversationMessage;

export type EvryArtifactLifecycleBoundaries = Readonly<{
  planRegistry: EvryPlanCapabilityRegistry;
  executionRegistry: EvryExecutionCapabilityRegistry;
  revalidatePlan: EvryConversationPlanResumeRevalidator;
  resume: ResumeConversation;
  append: AppendMessage;
  confirm: ConfirmExactPlan;
  execute: ExecuteExactPlan;
  cancel: CancelExactPlan;
  reviewPlan(input: {
    actor: EvryPlantActor;
    plan: EvryConversationPlanIdentity;
    registry: EvryPlanCapabilityRegistry;
  }): Promise<EvryTrustedPlanReview | null>;
  reusableRecipeIdentities?: ReadonlySet<string>;
  cleanupPlanResources?(input: {
    actor: EvryPlantActor;
    plan: EvryConversationPlanIdentity;
  }): Promise<void | Readonly<{ failed: number }>>;
  now(): Date;
  correlationId?(): string;
}>;

export type EvryArtifactLifecycleResult =
  | Readonly<{
      status:
        | "cancelled"
        | "editing"
        | "executed"
        | "retryable"
        | "already_finished";
      resumed: EvryResumedConversation;
    }>
  | Readonly<{
      status: "unavailable";
      message: string;
    }>;

const UNAVAILABLE_MESSAGE =
  "This plan is no longer available. Review the conversation before trying another change.";

async function cleanupPlanResources(
  boundaries: EvryArtifactLifecycleBoundaries,
  actor: EvryPlantActor,
  plan: EvryConversationPlanIdentity
) {
  if (!boundaries.cleanupPlanResources) return;
  const result = await boundaries.cleanupPlanResources({ actor, plan });
  if (result && result.failed > 0)
    throw new Error("Evry terminal resource cleanup remains incomplete");
}

function samePlan(
  left: EvryConversationPlanIdentity | null,
  right: EvryConversationPlanIdentity
): boolean {
  return (
    left?.planId === right.planId && left.fingerprint === right.fingerprint
  );
}

function derivedUuid(seed: string, purpose: string): string {
  const bytes = createHash("sha256")
    .update(`evry-artifact-lifecycle:${purpose}:${seed}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  bytes[12] = "4";
  bytes[16] = ((Number.parseInt(bytes[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16
  );
  return `${bytes.slice(0, 8).join("")}-${bytes
    .slice(8, 12)
    .join("")}-${bytes.slice(12, 16).join("")}-${bytes
    .slice(16, 20)
    .join("")}-${bytes.slice(20).join("")}`;
}

function lifecycleRequestKey(
  requestKey: string,
  purpose: string
): ReturnType<typeof evryConversationRequestKeySchema.parse> {
  return evryConversationRequestKeySchema.parse(
    derivedUuid(requestKey, `request:${purpose}`)
  );
}

function lifecycleMessageId(
  requestKey: string,
  purpose: string
): ReturnType<typeof evryConversationMessageIdSchema.parse> {
  return evryConversationMessageIdSchema.parse(
    derivedUuid(requestKey, `message:${purpose}`)
  );
}

function detailedConfirmationFor(
  conversation: EvryStoredConversation,
  plan: EvryConversationPlanIdentity
): EvryDetailedConfirmationArtifactDocument | null {
  for (const message of [...conversation.messages].reverse()) {
    for (const stored of [...message.artifacts].reverse()) {
      if (stored.document.kind !== "confirmation") continue;
      const parsed = evryDetailedConfirmationArtifactDocumentSchema.safeParse(
        stored.document
      );
      if (parsed.success && samePlan(parsed.data.plan, plan))
        return parsed.data;
    }
  }
  return null;
}

function detailedProgressFor(
  conversation: EvryStoredConversation,
  plan: EvryConversationPlanIdentity
): EvryDetailedProgressArtifactDocument | null {
  for (const message of [...conversation.messages].reverse()) {
    for (const stored of [...message.artifacts].reverse()) {
      if (
        stored.document.kind === "progress" &&
        "artifactVersion" in stored.document &&
        samePlan(stored.document.plan, plan)
      ) {
        return stored.document;
      }
    }
  }
  return null;
}

function detailedReceiptFor(
  conversation: EvryStoredConversation,
  plan: EvryConversationPlanIdentity
): EvryDetailedReceiptArtifactDocument | null {
  for (const message of [...conversation.messages].reverse()) {
    for (const stored of [...message.artifacts].reverse()) {
      if (
        stored.document.kind === "result" &&
        "artifactVersion" in stored.document &&
        samePlan(stored.document.plan, plan)
      ) {
        return stored.document;
      }
    }
  }
  return null;
}

function hasRequestKey(
  messages: readonly EvryStoredConversationMessage[],
  requestKey: string
): boolean {
  return messages.some((message) => message.requestKey === requestKey);
}

export function confirmationMatchesTrustedPlan(
  confirmation: EvryDetailedConfirmationArtifactDocument,
  review: EvryTrustedPlanReview
): boolean {
  return isDeepStrictEqual(confirmation, review.confirmation);
}

export {
  pendingEvryProgress,
  receiptFromEvryExecution,
  progressFromRetryableEvryExecution,
} from "./execution-result";

function uncertainEvryProgress(input: {
  confirmation: EvryDetailedConfirmationArtifactDocument;
  progress: EvryDetailedProgressArtifactDocument;
  correlationId: string;
}): EvryDetailedProgressArtifactDocument {
  return buildEvryProgressArtifact({
    kind: "progress",
    artifactVersion: 1,
    plan: input.confirmation.plan,
    title: `Safe retry available: ${input.confirmation.title}`,
    error: { kind: "unexpected", correlationId: input.correlationId },
    steps: input.progress.steps.map((step) => ({
      ...step,
      status:
        step.status === "completed" ||
        step.status === "refused" ||
        step.status === "failed" ||
        step.status === "skipped"
          ? step.status
          : "safe_retry",
    })),
  });
}

function retryRunningProgress(input: {
  confirmation: EvryDetailedConfirmationArtifactDocument;
  progress: EvryDetailedProgressArtifactDocument;
}): EvryDetailedProgressArtifactDocument {
  let activated = false;
  return buildEvryProgressArtifact({
    kind: "progress",
    artifactVersion: 1,
    plan: input.confirmation.plan,
    title: `Retrying: ${input.confirmation.title}`,
    error: null,
    steps: input.progress.steps.map((step) => {
      if (step.status !== "safe_retry") return step;
      if (!activated) {
        activated = true;
        return { ...step, status: "active" as const };
      }
      return { ...step, status: "pending" as const };
    }),
  });
}

function appendLifecycleMessage(input: {
  boundaries: EvryArtifactLifecycleBoundaries;
  actor: EvryPlantActor;
  conversation: EvryStoredConversation;
  originalRequestKey: string;
  purpose: string;
  body: string;
  artifact?:
    | EvryDetailedProgressArtifactDocument
    | EvryDetailedReceiptArtifactDocument;
  clearPlan: boolean;
  now: Date;
}): Promise<EvryStoredConversation> {
  return input.boundaries.append({
    messageId: lifecycleMessageId(input.originalRequestKey, input.purpose),
    actor: input.actor,
    conversationId: evryConversationIdSchema.parse(input.conversation.id),
    requestKey: lifecycleRequestKey(input.originalRequestKey, input.purpose),
    expectedStateVersion: input.conversation.stateVersion,
    state: input.conversation.state,
    author: "assistant",
    body: input.body,
    pageContext: null,
    requestPageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: input.artifact ? [input.artifact] : [],
    idempotencyContext: { status: "none" },
    replayReference: null,
    activePlan: input.clearPlan ? { mode: "clear" } : { mode: "preserve" },
    now: input.now,
  });
}

async function resumeRequired(input: {
  boundaries: EvryArtifactLifecycleBoundaries;
  actor: EvryPlantActor;
  conversationId: string;
  now: Date;
}): Promise<EvryResumedConversation | null> {
  return input.boundaries.resume({
    actor: input.actor,
    conversationId: input.conversationId,
    now: input.now,
    revalidatePlan: input.boundaries.revalidatePlan,
  });
}

/**
 * Coordinate one exact reviewed plan. The conversation receives progress before
 * effects, then a terminal receipt; replays return the persisted outcome.
 */
export function createEvryArtifactLifecycle(
  boundaries: EvryArtifactLifecycleBoundaries
) {
  return async function run(input: {
    actor: EvryPlantActor;
    conversationId: string;
    request: EvryArtifactLifecycleRequest;
  }): Promise<EvryArtifactLifecycleResult> {
    const now = boundaries.now();
    let resumed = await resumeRequired({
      boundaries,
      actor: input.actor,
      conversationId: input.conversationId,
      now,
    });
    if (!resumed)
      return { status: "unavailable", message: UNAVAILABLE_MESSAGE };

    const completionPurpose =
      input.request.action === "execute" || input.request.action === "retry"
        ? `${input.request.action}-receipt`
        : `${input.request.action}-complete`;
    const completionKey = lifecycleRequestKey(
      input.request.requestKey,
      completionPurpose
    );
    const receipt = detailedReceiptFor(
      resumed.conversation,
      input.request.plan
    );
    if (receipt) {
      // The receipt is durable before external-object cleanup. A response loss
      // or cleanup failure re-enters here, retries cleanup idempotently, and
      // never starts the completed effects again.
      await cleanupPlanResources(boundaries, input.actor, input.request.plan);
      return { status: "already_finished", resumed };
    }
    if (hasRequestKey(resumed.conversation.messages, completionKey)) {
      return {
        status:
          input.request.action === "execute" || input.request.action === "retry"
            ? "already_finished"
            : input.request.action === "edit"
              ? "editing"
              : "cancelled",
        resumed,
      };
    }

    const confirmation = detailedConfirmationFor(
      resumed.conversation,
      input.request.plan
    );
    const revalidated = resumed.activePlan;
    const ownsRequestedPlan =
      confirmation !== null &&
      samePlan(resumed.conversation.activePlan, input.request.plan) &&
      revalidated !== null &&
      samePlan(revalidated.identity, input.request.plan);
    if (!ownsRequestedPlan) {
      return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
    }
    if (revalidated.status === "stale" || revalidated.status === "expired") {
      await cleanupPlanResources(boundaries, input.actor, input.request.plan);
      return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
    }

    if (input.request.action === "cancel" || input.request.action === "edit") {
      if (
        revalidated.status !== "awaiting_confirmation" &&
        revalidated.status !== "cancelled"
      ) {
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
      const cancelled = await boundaries.cancel({
        planId: input.request.plan.planId,
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        fingerprint: input.request.plan.fingerprint,
        cancelledAt: now,
      });
      if (!cancelled) {
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
      await cleanupPlanResources(boundaries, input.actor, input.request.plan);
      const edited = input.request.action === "edit";
      await appendLifecycleMessage({
        boundaries,
        actor: input.actor,
        conversation: resumed.conversation,
        originalRequestKey: input.request.requestKey,
        purpose: completionPurpose,
        body: edited
          ? "This confirmation is no longer active. Update the request to create a fresh plan."
          : "This plan was cancelled. No disclosed effect was started.",
        clearPlan: true,
        now,
      });
      resumed = await resumeRequired({
        boundaries,
        actor: input.actor,
        conversationId: input.conversationId,
        now,
      });
      if (!resumed) {
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
      return { status: edited ? "editing" : "cancelled", resumed };
    }

    let progress = detailedProgressFor(
      resumed.conversation,
      input.request.plan
    );
    const trustedReview = await boundaries.reviewPlan({
      actor: input.actor,
      plan: input.request.plan,
      registry: boundaries.planRegistry,
    });
    if (
      !trustedReview ||
      !confirmationMatchesTrustedPlan(confirmation, trustedReview) ||
      (progress &&
        (progress.steps.length !== confirmation.steps.length ||
          !progress.steps.every(
            (step, index) => step.stepId === confirmation.steps[index]?.stepId
          )))
    ) {
      return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
    }

    const progressPurpose =
      input.request.action === "retry" ? "retry-progress" : "execute-progress";
    const sameOperationAlreadyStarted = hasRequestKey(
      resumed.conversation.messages,
      lifecycleRequestKey(input.request.requestKey, progressPurpose)
    );
    const safeRetryAvailable =
      progress?.steps.some(({ status }) => status === "safe_retry") ?? false;

    if (
      (input.request.action === "execute" &&
        progress !== null &&
        !sameOperationAlreadyStarted) ||
      (input.request.action === "retry" &&
        (progress === null ||
          (!sameOperationAlreadyStarted && !safeRetryAvailable)))
    ) {
      return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
    }

    if (!progress) {
      if (
        input.request.action !== "execute" ||
        (revalidated.status !== "awaiting_confirmation" &&
          revalidated.status !== "approved" &&
          revalidated.status !== "executing")
      ) {
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
      if (revalidated.status === "awaiting_confirmation") {
        const confirmed = await boundaries.confirm({
          actor: input.actor,
          planId: input.request.plan.planId,
          fingerprint: input.request.plan.fingerprint,
          decidedAt: now,
          registry: boundaries.planRegistry,
        });
        if (
          confirmed.status !== "approved" &&
          confirmed.status !== "already_approved"
        ) {
          await cleanupPlanResources(
            boundaries,
            input.actor,
            input.request.plan
          );
          return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
        }
      }
      progress = pendingEvryProgress(confirmation);
      const progressConversation = await appendLifecycleMessage({
        boundaries,
        actor: input.actor,
        conversation: resumed.conversation,
        originalRequestKey: input.request.requestKey,
        purpose: progressPurpose,
        body: "Execution started for the exact plan you confirmed.",
        artifact: progress,
        clearPlan: false,
        now,
      });
      resumed = { ...resumed, conversation: progressConversation };
    } else if (
      input.request.action === "retry" &&
      !sameOperationAlreadyStarted
    ) {
      if (
        revalidated.status !== "approved" &&
        revalidated.status !== "executing"
      ) {
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
      progress = retryRunningProgress({ confirmation, progress });
      const progressConversation = await appendLifecycleMessage({
        boundaries,
        actor: input.actor,
        conversation: resumed.conversation,
        originalRequestKey: input.request.requestKey,
        purpose: progressPurpose,
        body: "Safe retry started for the same exact plan and effect keys.",
        artifact: progress,
        clearPlan: false,
        now,
      });
      resumed = { ...resumed, conversation: progressConversation };
    } else if (
      revalidated.status !== "approved" &&
      revalidated.status !== "executing"
    ) {
      return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
    }

    let execution: ExecuteEvryActionPlanResult;
    try {
      execution = await boundaries.execute({
        actor: input.actor,
        planId: input.request.plan.planId,
        fingerprint: input.request.plan.fingerprint,
        registry: boundaries.executionRegistry,
      });
    } catch {
      const retryableProgress = uncertainEvryProgress({
        confirmation,
        progress,
        correlationId: (boundaries.correlationId ?? randomUUID)(),
      });
      await appendLifecycleMessage({
        boundaries,
        actor: input.actor,
        conversation: resumed.conversation,
        originalRequestKey: input.request.requestKey,
        purpose: `${input.request.action}-retryable`,
        body: "Evry could not confirm a durable outcome. Only a safe retry of this exact plan is available.",
        artifact: retryableProgress,
        clearPlan: false,
        now,
      });
      resumed = await resumeRequired({
        boundaries,
        actor: input.actor,
        conversationId: input.conversationId,
        now,
      });
      if (!resumed) {
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
      return { status: "retryable", resumed };
    }

    if (
      execution.status === "retryable" ||
      execution.steps.some(
        ({ durable, status }) => !durable || status === "retryable"
      )
    ) {
      const retryableProgress = progressFromRetryableEvryExecution({
        confirmation,
        result: {
          status: "retryable",
          steps: execution.steps,
        },
      });
      await appendLifecycleMessage({
        boundaries,
        actor: input.actor,
        conversation: resumed.conversation,
        originalRequestKey: input.request.requestKey,
        purpose: `${input.request.action}-retryable`,
        body: "Evry preserved every durable outcome. Retry this exact plan to reconcile the remaining steps safely.",
        artifact: retryableProgress,
        clearPlan: false,
        now,
      });
      resumed = await resumeRequired({
        boundaries,
        actor: input.actor,
        conversationId: input.conversationId,
        now,
      });
      if (!resumed) {
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
      return { status: "retryable", resumed };
    }

    const executionReceipt = receiptFromEvryExecution({
      confirmation,
      result: execution,
      reuse:
        execution.status === "completed" &&
        trustedReview.source.kind === "recipe" &&
        boundaries.reusableRecipeIdentities?.has(trustedReview.source.identity)
          ? {
              recipeIdentity: trustedReview.source.identity,
              label: "Reuse",
            }
          : undefined,
    });
    await appendLifecycleMessage({
      boundaries,
      actor: input.actor,
      conversation: resumed.conversation,
      originalRequestKey: input.request.requestKey,
      purpose: completionPurpose,
      body:
        executionReceipt.status === "completed"
          ? "Execution finished. The receipt records every disclosed step."
          : "Execution stopped. Review the receipt for the recorded outcome.",
      artifact: executionReceipt,
      clearPlan: true,
      now,
    });
    await cleanupPlanResources(boundaries, input.actor, input.request.plan);
    resumed = await resumeRequired({
      boundaries,
      actor: input.actor,
      conversationId: input.conversationId,
      now,
    });
    if (!resumed)
      return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
    return { status: "executed", resumed };
  };
}
