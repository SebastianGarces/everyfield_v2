import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
import type { EvryConversationPlanTargetValidator } from "@/lib/evry/conversations/plan-resume";

import {
  PLATFORM_ARTIFACT_REVIEWS,
  PLATFORM_EXECUTION_REGISTRY,
  platformEvryTargetIsCurrent,
} from "./effects";

export const PLATFORM_EVRY_EXECUTION_REGISTRY = PLATFORM_EXECUTION_REGISTRY;
export const PLATFORM_EVRY_PLAN_REGISTRY =
  PLATFORM_EVRY_EXECUTION_REGISTRY.planRegistry;
export const PLATFORM_EVRY_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  PLATFORM_ARTIFACT_REVIEWS
);

export const platformEvryPlanTargetIsCurrent: EvryConversationPlanTargetValidator =
  platformEvryTargetIsCurrent;
