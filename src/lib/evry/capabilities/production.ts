import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
import { createEvryExecutionCapabilityRegistry } from "@/lib/evry/executor";
import { createEvryPlanCapabilityRegistry } from "@/lib/evry/plans";

import { composeEvryCapabilityConversationContinuations } from "./conversation";

/** The one production composition seam capability packs extend. */
export const PRODUCTION_EVRY_PLAN_REGISTRY = createEvryPlanCapabilityRegistry(
  []
);
export const PRODUCTION_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry([]);
export const PRODUCTION_EVRY_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  []
);
export const continueProductionEvryCapabilityConversation =
  composeEvryCapabilityConversationContinuations([]);
export const productionEvryPlanTargetIsCurrent = async () => false;
