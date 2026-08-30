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
import { continueTeamsEvryConversation } from "./teams/conversation";
import { TEAMS_ARTIFACT_REVIEWS } from "./teams/review";
import {
  TEAMS_EXECUTION_CAPABILITIES,
  teamsEvryPlanTargetIsCurrent,
} from "./teams/runtime";

/** The one production composition seam capability packs extend. */
export const PRODUCTION_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry([
    ...COMMUNICATION_MESSAGE_EXECUTIONS,
    ...COMMUNICATION_TEMPLATE_EXECUTIONS,
    ...TEAMS_EXECUTION_CAPABILITIES,
  ]);
export const PRODUCTION_EVRY_PLAN_REGISTRY =
  PRODUCTION_EVRY_EXECUTION_REGISTRY.planRegistry;
export const PRODUCTION_EVRY_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  [
    ...COMMUNICATION_MESSAGE_REVIEWS,
    ...COMMUNICATION_TEMPLATE_REVIEWS,
    ...TEAMS_ARTIFACT_REVIEWS,
  ]
);
export const continueProductionEvryCapabilityConversation =
  composeEvryCapabilityConversationContinuations([
    continueCommunicationEvryConversation,
    continueTeamsEvryConversation,
  ]);
export const productionEvryPlanTargetIsCurrent = async (
  input: Parameters<typeof communicationEvryPlanTargetIsCurrent>[0]
) =>
  input.step.capabilityIdentity.startsWith("teams.")
    ? teamsEvryPlanTargetIsCurrent(input)
    : communicationEvryPlanTargetIsCurrent(input);
