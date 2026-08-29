import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
import { createEvryExecutionCapabilityRegistry } from "@/lib/evry/executor";

import { composeEvryCapabilityConversationContinuations } from "./conversation";
import { continueCommunicationEvryConversation } from "./communication/conversation";
import { communicationEvryPlanTargetIsCurrent } from "./communication/runtime";
import {
  COMMUNICATION_MESSAGE_EXECUTIONS,
  COMMUNICATION_MESSAGE_REVIEWS,
} from "./communication/messages";
import {
  COMMUNICATION_TEMPLATE_EXECUTIONS,
  COMMUNICATION_TEMPLATE_REVIEWS,
} from "./communication/templates";
import { createEvryExecutionCapabilityRegistry } from "@/lib/evry/executor";
import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
import { continuePlantIntelligenceEvryConversation } from "./plant-intelligence/conversation";
import {
  PLANT_INTELLIGENCE_EXECUTIONS,
  PLANT_INTELLIGENCE_REVIEWS,
  plantIntelligenceEvryPlanTargetIsCurrent,
} from "./plant-intelligence/runtime";
import { continueTaskEvryConversation } from "./tasks/conversation";
import { TASK_ARTIFACT_REVIEWS } from "./tasks/review";
import {
  TASK_EXECUTION_CAPABILITIES,
  taskEvryPlanTargetIsCurrent,
} from "./tasks/runtime";

/** The one production composition seam capability packs extend. */
export const PRODUCTION_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry([
    ...COMMUNICATION_MESSAGE_EXECUTIONS,
    ...COMMUNICATION_TEMPLATE_EXECUTIONS,
    ...PLANT_INTELLIGENCE_EXECUTIONS,
    ...TASK_EXECUTION_CAPABILITIES,
  ]);
export const PRODUCTION_EVRY_PLAN_REGISTRY =
  PRODUCTION_EVRY_EXECUTION_REGISTRY.planRegistry;
export const PRODUCTION_EVRY_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  [
    ...COMMUNICATION_MESSAGE_REVIEWS,
    ...COMMUNICATION_TEMPLATE_REVIEWS,
    ...PLANT_INTELLIGENCE_REVIEWS,
    ...TASK_ARTIFACT_REVIEWS,
  ]
);
export const continueProductionEvryCapabilityConversation =
  composeEvryCapabilityConversationContinuations([
    continueCommunicationEvryConversation,
    continuePlantIntelligenceEvryConversation,
    continueTaskEvryConversation,
  ]);
export const productionEvryPlanTargetIsCurrent = async (
  input: Parameters<typeof communicationEvryPlanTargetIsCurrent>[0]
) =>
  input.step.capabilityIdentity.startsWith("tasks.")
    ? taskEvryPlanTargetIsCurrent(input)
    : input.step.capabilityIdentity.startsWith("plant-intelligence.")
      ? plantIntelligenceEvryPlanTargetIsCurrent(input)
    : communicationEvryPlanTargetIsCurrent(input);
