import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
import { createEvryExecutionCapabilityRegistry } from "@/lib/evry/executor";

import { continueCommunicationEvryConversation } from "./communication/conversation";
import {
  COMMUNICATION_EVRY_EXECUTIONS,
  COMMUNICATION_EVRY_REVIEWS,
  communicationEvryPlanTargetIsCurrent,
} from "./communication/runtime";
import { composeEvryCapabilityConversationContinuations } from "./conversation";
import { continueLaunchEvryConversation } from "./launch/conversation";
import {
  LAUNCH_EVRY_EXECUTIONS,
  LAUNCH_EVRY_REVIEWS,
  launchEvryPlanTargetIsCurrent,
} from "./launch/runtime";
import { continueTeamsEvryConversation } from "./teams/conversation";
import { TEAMS_ARTIFACT_REVIEWS } from "./teams/review";
import {
  TEAMS_EXECUTION_CAPABILITIES,
  teamsEvryPlanTargetIsCurrent,
} from "./teams/runtime";

/** The one production composition seam capability packs extend. */
export const PRODUCTION_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry([
    ...COMMUNICATION_EVRY_EXECUTIONS,
    ...LAUNCH_EVRY_EXECUTIONS,
    ...TEAMS_EXECUTION_CAPABILITIES,
  ]);
export const PRODUCTION_EVRY_PLAN_REGISTRY =
  PRODUCTION_EVRY_EXECUTION_REGISTRY.planRegistry;
export const PRODUCTION_EVRY_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  [
    ...COMMUNICATION_EVRY_REVIEWS,
    ...LAUNCH_EVRY_REVIEWS,
    ...TEAMS_ARTIFACT_REVIEWS,
  ]
);
export const continueProductionEvryCapabilityConversation =
  composeEvryCapabilityConversationContinuations([
    continueCommunicationEvryConversation,
    continueLaunchEvryConversation,
    continueTeamsEvryConversation,
  ]);
export const productionEvryPlanTargetIsCurrent = async (
  input: Parameters<typeof communicationEvryPlanTargetIsCurrent>[0]
) =>
  input.step.capabilityIdentity.startsWith("launch.")
    ? launchEvryPlanTargetIsCurrent(input)
    : input.step.capabilityIdentity.startsWith("teams.")
      ? teamsEvryPlanTargetIsCurrent(input)
      : communicationEvryPlanTargetIsCurrent(input);
