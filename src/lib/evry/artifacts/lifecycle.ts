import { createHash, randomUUID } from "node:crypto";

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
  evryConversationResultCodeFor,
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
  buildEvryReceiptArtifact,
  evryDetailedConfirmationArtifactDocumentSchema,
  type EvryDetailedConfirmationArtifactDocument,
  type EvryDetailedProgressArtifactDocument,
  type EvryDetailedReceiptArtifactDocument,
} from "./review";

export const evryArtifactLifecycleRequestSchema = z
  .strictObject({
    action: z.enum(["cancel", "edit", "execute"]),
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
  now(): Date;
  correlationId?(): string;
}>;

export type EvryArtifactLifecycleResult =
  | Readonly<{
      status: "cancelled" | "editing" | "executed" | "already_finished";
      resumed: EvryResumedConversation;
    }>
  | Readonly<{
      status: "unavailable";
      message: string;
    }>;

const UNAVAILABLE_MESSAGE =
  "This plan is no longer available. Review the conversation before trying another change.";

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

export function pendingEvryProgress(
  confirmation: EvryDetailedConfirmationArtifactDocument
): EvryDetailedProgressArtifactDocument {
  return buildEvryProgressArtifact({
    kind: "progress",
    artifactVersion: 1,
    plan: confirmation.plan,
    title: `Running: ${confirmation.title}`,
    steps: confirmation.steps.map((step, index) => ({
      stepId: step.stepId,
      label: step.title,
      status: index === 0 ? "active" : "pending",
      affectedCount: 0,
      excludedCount: 0,
    })),
  });
}

function receiptStatus(
  steps: EvryDetailedReceiptArtifactDocument["steps"]
): EvryDetailedReceiptArtifactDocument["status"] {
  if (steps.every(({ status }) => status === "completed")) return "completed";
  if (steps.some(({ status }) => status === "completed")) {
    return "partially_failed";
  }
  return steps.some(({ status }) => status === "refused")
    ? "refused"
    : "failed";
}

function sourceLinksFor(
  step: EvryDetailedConfirmationArtifactDocument["steps"][number]
) {
  const unique = new Map<string, { label: string; href: string }>();
  for (const target of step.resolvedTargets) {
    if (target.sourceLink)
      unique.set(target.sourceLink.href, target.sourceLink);
  }
  return [...unique.values()];
}

function publicStepError(status: "failed" | "refused") {
  return {
    kind: "expected" as const,
    message:
      status === "refused"
        ? "Your current permissions or the latest record state no longer allow this step."
        : "This step could not be completed. Review its disclosed targets before making another request.",
  };
}

export function receiptFromEvryExecution(input: {
  confirmation: EvryDetailedConfirmationArtifactDocument;
  result: ExecuteEvryActionPlanResult;
  fallbackCorrelationId: string;
}): EvryDetailedReceiptArtifactDocument {
  const byStep = new Map(
    input.result.steps.map((step) => [step.stepId, step] as const)
  );
  const unavailable =
    input.result.status === "unavailable" || input.result.status === "expired";
  const correlationId =
    "correlationId" in input.result
      ? input.result.correlationId
      : input.fallbackCorrelationId;
  const steps = input.confirmation.steps.map((confirmationStep) => {
    const outcome = byStep.get(confirmationStep.stepId);
    const common = {
      stepId: confirmationStep.stepId,
      label: confirmationStep.title,
      sourceLinks: sourceLinksFor(confirmationStep),
    };
    if (outcome?.status === "completed") {
      return {
        ...common,
        status: "completed" as const,
        resultCode: evryConversationResultCodeFor("completed"),
        affectedCount: outcome.affectedCount,
        excludedCount: outcome.excludedCount,
        retry: { status: "unavailable" as const },
        error: null,
      };
    }
    if (outcome?.status === "refused") {
      return {
        ...common,
        status: "refused" as const,
        resultCode: evryConversationResultCodeFor("refused"),
        affectedCount: outcome.affectedCount,
        excludedCount: outcome.excludedCount,
        retry: { status: "unavailable" as const },
        error: publicStepError("refused"),
      };
    }
    if (outcome?.status === "skipped") {
      return {
        ...common,
        status: "skipped" as const,
        resultCode: evryConversationResultCodeFor("skipped"),
        affectedCount: outcome.affectedCount,
        excludedCount: outcome.excludedCount,
        retry: { status: "unavailable" as const },
        error: null,
      };
    }
    if (outcome?.status === "retryable") {
      return {
        ...common,
        status: "failed" as const,
        resultCode: evryConversationResultCodeFor("failed"),
        affectedCount: outcome.affectedCount,
        excludedCount: outcome.excludedCount,
        retry: {
          status: "safe_retry" as const,
          label: "A fresh request may safely retry this step",
        },
        error: {
          kind: "expected" as const,
          message:
            "This step did not return a durable outcome. Review the receipt before requesting a retry.",
        },
      };
    }
    if (outcome?.status === "failed" || unavailable) {
      return {
        ...common,
        status: "failed" as const,
        resultCode: evryConversationResultCodeFor("failed"),
        affectedCount: outcome?.affectedCount ?? 0,
        excludedCount: outcome?.excludedCount ?? 0,
        retry: { status: "unavailable" as const },
        error: unavailable
          ? {
              kind: "expected" as const,
              message: UNAVAILABLE_MESSAGE,
            }
          : publicStepError("failed"),
      };
    }
    return {
      ...common,
      status: "failed" as const,
      resultCode: evryConversationResultCodeFor("failed"),
      affectedCount: 0,
      excludedCount: 0,
      retry: { status: "unavailable" as const },
      error: { kind: "unexpected" as const, correlationId },
    };
  });
  return buildEvryReceiptArtifact({
    kind: "result",
    artifactVersion: 1,
    plan: input.confirmation.plan,
    title: `Receipt: ${input.confirmation.title}`,
    status: receiptStatus(steps),
    steps,
  });
}

export function unexpectedEvryReceipt(input: {
  confirmation: EvryDetailedConfirmationArtifactDocument;
  correlationId: string;
}): EvryDetailedReceiptArtifactDocument {
  return buildEvryReceiptArtifact({
    kind: "result",
    artifactVersion: 1,
    plan: input.confirmation.plan,
    title: `Receipt: ${input.confirmation.title}`,
    status: "failed",
    steps: input.confirmation.steps.map((step) => ({
      stepId: step.stepId,
      label: step.title,
      status: "failed",
      resultCode: evryConversationResultCodeFor("failed"),
      affectedCount: 0,
      excludedCount: 0,
      sourceLinks: sourceLinksFor(step),
      retry: { status: "unavailable" },
      error: { kind: "unexpected", correlationId: input.correlationId },
    })),
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
      input.request.action === "execute"
        ? "execute-receipt"
        : `${input.request.action}-complete`;
    const completionKey = lifecycleRequestKey(
      input.request.requestKey,
      completionPurpose
    );
    if (hasRequestKey(resumed.conversation.messages, completionKey)) {
      return {
        status:
          input.request.action === "execute"
            ? "already_finished"
            : input.request.action === "edit"
              ? "editing"
              : "cancelled",
        resumed,
      };
    }

    const receipt = detailedReceiptFor(
      resumed.conversation,
      input.request.plan
    );
    if (receipt) return { status: "already_finished", resumed };

    const confirmation = detailedConfirmationFor(
      resumed.conversation,
      input.request.plan
    );
    const revalidated = resumed.activePlan;
    if (
      !confirmation ||
      !samePlan(resumed.conversation.activePlan, input.request.plan) ||
      !revalidated ||
      !samePlan(revalidated.identity, input.request.plan) ||
      revalidated.status === "stale" ||
      revalidated.status === "expired"
    ) {
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
    if (!progress) {
      if (
        revalidated.status !== "awaiting_confirmation" &&
        revalidated.status !== "approved" &&
        revalidated.status !== "executing"
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
          return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
        }
      }
      progress = pendingEvryProgress(confirmation);
      const progressConversation = await appendLifecycleMessage({
        boundaries,
        actor: input.actor,
        conversation: resumed.conversation,
        originalRequestKey: input.request.requestKey,
        purpose: "execute-progress",
        body: "Execution started for the exact plan you confirmed.",
        artifact: progress,
        clearPlan: false,
        now,
      });
      resumed = { ...resumed, conversation: progressConversation };
    }

    let executionReceipt: EvryDetailedReceiptArtifactDocument;
    try {
      const execution = await boundaries.execute({
        actor: input.actor,
        planId: input.request.plan.planId,
        fingerprint: input.request.plan.fingerprint,
        registry: boundaries.executionRegistry,
      });
      executionReceipt = receiptFromEvryExecution({
        confirmation,
        result: execution,
        fallbackCorrelationId: (boundaries.correlationId ?? randomUUID)(),
      });
    } catch {
      executionReceipt = unexpectedEvryReceipt({
        confirmation,
        correlationId: (boundaries.correlationId ?? randomUUID)(),
      });
    }

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
