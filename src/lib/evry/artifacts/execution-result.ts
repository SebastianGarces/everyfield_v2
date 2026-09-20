import type {
  ExecuteEvryActionPlanResult,
  EvryExecutionStepResult,
} from "@/lib/evry/executor";
import { evryConversationResultCodeFor } from "@/lib/evry/conversations/contract";
import {
  buildEvryProgressArtifact,
  buildEvryReceiptArtifact,
  type EvryDetailedConfirmationArtifactDocument,
  type EvryDetailedProgressArtifactDocument,
  type EvryDetailedReceiptArtifactDocument,
} from "./review";

const UNAVAILABLE_MESSAGE =
  "This plan is no longer available. Review the conversation before trying another change.";

export function pendingEvryProgress(
  confirmation: EvryDetailedConfirmationArtifactDocument
): EvryDetailedProgressArtifactDocument {
  return buildEvryProgressArtifact({
    kind: "progress",
    artifactVersion: 1,
    plan: confirmation.plan,
    title: `Running: ${confirmation.title}`,
    error: null,
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
  reuse?: EvryDetailedReceiptArtifactDocument["reuse"];
}): EvryDetailedReceiptArtifactDocument {
  if (
    input.result.status === "retryable" ||
    input.result.steps.some(
      ({ durable, status }) => !durable || status === "retryable"
    )
  ) {
    throw new Error("Retryable Evry execution is not a terminal receipt");
  }
  const byStep = new Map(
    input.result.steps.map((step) => [step.stepId, step] as const)
  );
  const unavailable =
    input.result.status === "unavailable" || input.result.status === "expired";
  if (
    !unavailable &&
    (byStep.size !== input.confirmation.steps.length ||
      input.confirmation.steps.some(({ stepId }) => !byStep.has(stepId)))
  ) {
    throw new Error("Evry execution result does not match reviewed plan steps");
  }
  const steps = input.confirmation.steps.map((confirmationStep) => {
    const outcome = byStep.get(confirmationStep.stepId);
    if (!outcome && !unavailable) {
      throw new Error("Evry execution omitted a reviewed plan step");
    }
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
    throw new Error("Evry execution returned a nonterminal step outcome");
  });
  return buildEvryReceiptArtifact({
    kind: "result",
    artifactVersion: 1,
    plan: input.confirmation.plan,
    title: `Receipt: ${input.confirmation.title}`,
    status: receiptStatus(steps),
    ...(input.reuse ? { reuse: input.reuse } : {}),
    steps,
  });
}

const SAFE_RETRY_MESSAGE =
  "Evry could not confirm a durable result for every step. Retry this exact plan to reconcile it safely.";

function retryableStepStatus(
  outcome: EvryExecutionStepResult | undefined
): EvryDetailedProgressArtifactDocument["steps"][number]["status"] {
  return outcome?.durable &&
    (outcome.status === "completed" ||
      outcome.status === "refused" ||
      outcome.status === "failed" ||
      outcome.status === "skipped")
    ? outcome.status
    : "safe_retry";
}

/** Preserve durable outcomes while keeping response-loss recovery nonterminal. */
export function progressFromRetryableEvryExecution(input: {
  confirmation: EvryDetailedConfirmationArtifactDocument;
  result: Readonly<{
    status: "retryable";
    steps: readonly EvryExecutionStepResult[];
  }>;
}): EvryDetailedProgressArtifactDocument {
  const byStep = new Map(
    input.result.steps.map((step) => [step.stepId, step] as const)
  );
  return buildEvryProgressArtifact({
    kind: "progress",
    artifactVersion: 1,
    plan: input.confirmation.plan,
    title: `Safe retry available: ${input.confirmation.title}`,
    error: { kind: "expected", message: SAFE_RETRY_MESSAGE },
    steps: input.confirmation.steps.map((step) => {
      const outcome = byStep.get(step.stepId);
      return {
        stepId: step.stepId,
        label: step.title,
        status: retryableStepStatus(outcome),
        affectedCount: outcome?.durable ? outcome.affectedCount : 0,
        excludedCount: outcome?.durable ? outcome.excludedCount : 0,
      };
    }),
  });
}
