import { UnauthorizedError } from "@/lib/auth/unauthorized";
import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewerForSession,
} from "@/lib/evry/eligibility/viewer";
import { readEvePlanReview } from "./plan-review";
import { evryReviewState } from "./review-state";
import { getEveSession } from "./session-store";
import type { EveRuntimeScope } from "./scope";

const unavailable = { status: "unavailable" as const };
type Review = NonNullable<Awaited<ReturnType<typeof readEvePlanReview>>>;

/** Only existing public lifecycle evidence crosses to the model, never plan arguments or identities. */
export function projectEveActionStatus(review: Review) {
  const { artifact, plan } = review;
  const common = {
    status: "available" as const,
    lifecycle: plan.status,
    title: artifact.title,
    evidence: artifact.kind,
    scope: "current_conversation_review" as const,
    deliveryEvidence:
      "Execution completion does not establish email delivery." as const,
  };
  if (artifact.kind === "confirmation")
    return {
      ...common,
      plannedSteps: artifact.steps.map((step) => ({
        label: step.title,
        counts: step.counts.map(({ label, count }) => ({ label, count })),
      })),
    };
  return {
    ...common,
    ...(artifact.kind === "result" ? { outcome: artifact.status } : {}),
    steps: artifact.steps.map((step) => ({
      label: step.label,
      status: step.status,
      recordedAffectedCount: [
        "completed",
        "failed",
        "refused",
        "skipped",
      ].includes(step.status)
        ? step.affectedCount
        : null,
      recordedExcludedCount: [
        "completed",
        "failed",
        "refused",
        "skipped",
      ].includes(step.status)
        ? step.excludedCount
        : null,
    })),
  };
}

const production = {
  refreshActor: requireEvryPlantViewerForSession,
  findSession: getEveSession,
  currentReview: () => evryReviewState.get(),
  readReview: readEvePlanReview,
};

/** Each dispatch reauthenticates, including queued code-mode calls. No model-selected plan lookup. */
export function createEveActionStatusReader(
  scope: EveRuntimeScope,
  boundaries = production,
  observeAuthorization?: (authorized: boolean) => void
) {
  return async ({ signal }: { signal?: AbortSignal } = {}) => {
    signal?.throwIfAborted();
    let actor;
    try {
      actor = await boundaries.refreshActor(scope.appSessionId);
    } catch (error) {
      if (
        error instanceof UnauthorizedError ||
        error instanceof EvryPlantViewerRefusalError
      ) {
        observeAuthorization?.(false);
        return unavailable;
      }
      throw error;
    }
    if (
      actor.userId !== scope.actor.userId ||
      actor.plantId !== scope.actor.plantId
    ) {
      observeAuthorization?.(false);
      return unavailable;
    }
    const session = await boundaries.findSession(scope.eveSessionId, actor);
    if (!session || session.conversationId !== scope.conversationId) {
      observeAuthorization?.(false);
      return unavailable;
    }
    observeAuthorization?.(true);
    signal?.throwIfAborted();
    const current = boundaries.currentReview();
    if (!current) return unavailable;
    const review = await boundaries.readReview(actor, current.plan);
    signal?.throwIfAborted();
    const latest = boundaries.currentReview();
    if (
      !review ||
      review.plan.status === "stale" ||
      !latest ||
      latest.callId !== current.callId ||
      latest.plan.planId !== current.plan.planId ||
      latest.plan.fingerprint !== current.plan.fingerprint ||
      review.plan.identity.planId !== current.plan.planId ||
      review.plan.identity.fingerprint !== current.plan.fingerprint ||
      review.artifact.plan.planId !== current.plan.planId ||
      review.artifact.plan.fingerprint !== current.plan.fingerprint
    )
      return unavailable;
    return projectEveActionStatus(review);
  };
}
