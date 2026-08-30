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
import { continuePlatformEvryConversation } from "./platform/conversation";
import {
  PLATFORM_ARTIFACT_REVIEWS,
  PLATFORM_EXECUTION_CAPABILITIES,
  platformEvryTargetIsCurrent,
} from "./platform/effects";

/** The one production composition seam capability packs extend. */
export const PRODUCTION_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry([
    ...COMMUNICATION_MESSAGE_EXECUTIONS,
    ...COMMUNICATION_TEMPLATE_EXECUTIONS,
    ...PLATFORM_EXECUTION_CAPABILITIES,
  ]);
export const PRODUCTION_EVRY_PLAN_REGISTRY =
  PRODUCTION_EVRY_EXECUTION_REGISTRY.planRegistry;
export const PRODUCTION_EVRY_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  [
    ...COMMUNICATION_MESSAGE_REVIEWS,
    ...COMMUNICATION_TEMPLATE_REVIEWS,
    ...PLATFORM_ARTIFACT_REVIEWS,
  ]
);
export const continueProductionEvryCapabilityConversation =
  composeEvryCapabilityConversationContinuations([
    continueCommunicationEvryConversation,
    continuePlatformEvryConversation,
  ]);
export const productionEvryPlanTargetIsCurrent = async (
  input: Parameters<typeof communicationEvryPlanTargetIsCurrent>[0]
) =>
  input.step.capabilityIdentity.startsWith("notifications.") ||
  input.step.capabilityIdentity.startsWith("platform.")
    ? platformEvryTargetIsCurrent(input)
    : communicationEvryPlanTargetIsCurrent(input);
