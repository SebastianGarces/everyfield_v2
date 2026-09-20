import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";
import { revalidateProductionEvryConversationPlan } from "@/lib/evry/conversations/plan-resume";
import { trustedEvryPlanReview } from "@/lib/evry/artifacts/trusted-plan-review";
import {
  progressFromRetryableEvryExecution,
  receiptFromEvryExecution,
} from "@/lib/evry/artifacts/lifecycle";
import { findEvryExecutionSnapshot } from "@/lib/evry/executor/repository";
import {
  PRODUCTION_EVRY_PLAN_REGISTRY,
  PRODUCTION_EVRY_REVIEW_REGISTRY,
} from "@/lib/evry/capabilities/execution";

/** Read durable results without restarting an executor on a GET request. */
export async function readEvePlanReview(
  actor: EvryPlantActor,
  identity: EvryConversationPlanIdentity
) {
  const [plan, review, snapshot] = await Promise.all([
    revalidateProductionEvryConversationPlan({
      actor,
      identity,
      checkedAt: new Date(),
    }),
    trustedEvryPlanReview({
      actor,
      plan: identity,
      registry: PRODUCTION_EVRY_PLAN_REGISTRY,
      reviewRegistry: PRODUCTION_EVRY_REVIEW_REGISTRY,
    }),
    findEvryExecutionSnapshot({
      ...identity,
      actorUserId: actor.userId,
      plantId: actor.plantId,
    }),
  ]);
  if (!review || plan.status === "stale") return null;
  if (!snapshot)
    return {
      status: "available" as const,
      plan,
      artifact: review.confirmation,
    };
  const result = {
    correlationId: snapshot.attempt.correlationId,
    steps: snapshot.steps.map(
      ({
        stepId,
        capabilityIdentity,
        status,
        affectedCount,
        excludedCount,
      }) => ({
        stepId,
        capabilityIdentity,
        status,
        affectedCount,
        excludedCount,
        durable: true,
      })
    ),
  };
  const artifact = snapshot.terminalStatus
    ? receiptFromEvryExecution({
        confirmation: review.confirmation,
        result: { ...result, status: snapshot.terminalStatus },
      })
    : progressFromRetryableEvryExecution({
        confirmation: review.confirmation,
        result: { ...result, status: "retryable" },
      });
  return { status: "available" as const, plan, artifact };
}
