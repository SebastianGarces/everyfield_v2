import {
  createEvryArtifactLifecycle,
  type EvryArtifactLifecycleRequest,
  type EvryArtifactLifecycleResult,
} from "@/lib/evry/artifacts/lifecycle";
import {
  createEvryArtifactReviewRegistry,
  trustedEvryPlanReview,
} from "@/lib/evry/artifacts/trusted-plan-review";
import { revalidateProductionEvryConversationPlan } from "@/lib/evry/conversations/plan-resume";
import {
  appendTrustedEvryConversationMessage,
  resumeEvryConversation,
} from "@/lib/evry/conversations/service";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  createEvryExecutionCapabilityRegistry,
  executeEvryActionPlan,
} from "@/lib/evry/executor";
import {
  confirmEvryActionPlan,
  createEvryPlanCapabilityRegistry,
} from "@/lib/evry/plans";
import { cancelExactEvryActionPlan } from "@/lib/evry/plans/repository";

export type RunEvryProductionArtifactLifecycle = (input: {
  actor: EvryPlantActor;
  conversationId: string;
  request: EvryArtifactLifecycleRequest;
}) => Promise<EvryArtifactLifecycleResult>;

// Capability packs compose these closed registries in their integration wave.
// Until then a persisted plan cannot become confirmable or executable.
const productionPlanRegistry = createEvryPlanCapabilityRegistry([]);
const productionExecutionRegistry = createEvryExecutionCapabilityRegistry([]);
const productionReviewRegistry = createEvryArtifactReviewRegistry([]);

export const runEvryProductionArtifactLifecycle = createEvryArtifactLifecycle({
  planRegistry: productionPlanRegistry,
  executionRegistry: productionExecutionRegistry,
  revalidatePlan: revalidateProductionEvryConversationPlan,
  resume: resumeEvryConversation,
  append: appendTrustedEvryConversationMessage,
  confirm: confirmEvryActionPlan,
  execute: executeEvryActionPlan,
  cancel: cancelExactEvryActionPlan,
  reviewPlan: (input) =>
    trustedEvryPlanReview({
      ...input,
      reviewRegistry: productionReviewRegistry,
    }),
  now: () => new Date(),
});
