import {
  createEvryArtifactLifecycle,
  type EvryArtifactLifecycleRequest,
  type EvryArtifactLifecycleResult,
} from "@/lib/evry/artifacts/lifecycle";
import { trustedEvryPlanReview } from "@/lib/evry/artifacts/trusted-plan-review";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_PLAN_REGISTRY,
  PRODUCTION_EVRY_REVIEW_REGISTRY,
} from "@/lib/evry/capabilities/production";
import { cleanupEvryPeoplePlanAttachments } from "@/lib/evry/capabilities/people/cleanup";
import { revalidateProductionEvryConversationPlan } from "@/lib/evry/conversations/plan-resume";
import {
  appendTrustedEvryConversationMessage,
  resumeEvryConversation,
} from "@/lib/evry/conversations/service";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { executeEvryActionPlan } from "@/lib/evry/executor";
import { confirmEvryActionPlan } from "@/lib/evry/plans";
import { cancelExactEvryActionPlan } from "@/lib/evry/plans/repository";

export type RunEvryProductionArtifactLifecycle = (input: {
  actor: EvryPlantActor;
  conversationId: string;
  request: EvryArtifactLifecycleRequest;
}) => Promise<EvryArtifactLifecycleResult>;

export const runEvryProductionArtifactLifecycle = createEvryArtifactLifecycle({
  planRegistry: PRODUCTION_EVRY_PLAN_REGISTRY,
  executionRegistry: PRODUCTION_EVRY_EXECUTION_REGISTRY,
  revalidatePlan: revalidateProductionEvryConversationPlan,
  resume: resumeEvryConversation,
  append: appendTrustedEvryConversationMessage,
  confirm: confirmEvryActionPlan,
  execute: executeEvryActionPlan,
  cancel: cancelExactEvryActionPlan,
  cleanupPlanResources: cleanupEvryPeoplePlanAttachments,
  reviewPlan: (input) =>
    trustedEvryPlanReview({
      ...input,
      reviewRegistry: PRODUCTION_EVRY_REVIEW_REGISTRY,
    }),
  now: () => new Date(),
});
