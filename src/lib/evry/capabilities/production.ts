import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
import type { EvryConversationPlanTargetValidator } from "@/lib/evry/conversations/plan-resume";
import { createEvryExecutionCapabilityRegistry } from "@/lib/evry/executor";

import { composeEvryCapabilityConversationContinuations } from "./conversation";
import { continueCommunicationEvryConversation } from "./communication/conversation";
import {
  COMMUNICATION_MESSAGE_EXECUTIONS,
  COMMUNICATION_MESSAGE_REVIEWS,
} from "./communication/messages";
import { communicationEvryPlanTargetIsCurrent } from "./communication/runtime";
import {
  COMMUNICATION_TEMPLATE_EXECUTIONS,
  COMMUNICATION_TEMPLATE_REVIEWS,
} from "./communication/templates";
import { continueMeetingsEvryConversation } from "./meetings/conversation";
import { MEETINGS_ARTIFACT_REVIEWS } from "./meetings/review";
import {
  MEETINGS_EXECUTION_CAPABILITIES,
  meetingsPlanTargetIsCurrent,
} from "./meetings/runtime";

/** The one production composition seam capability packs extend. */
export const PRODUCTION_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry([
    ...COMMUNICATION_MESSAGE_EXECUTIONS,
    ...COMMUNICATION_TEMPLATE_EXECUTIONS,
    ...MEETINGS_EXECUTION_CAPABILITIES,
  ]);
export const PRODUCTION_EVRY_PLAN_REGISTRY =
  PRODUCTION_EVRY_EXECUTION_REGISTRY.planRegistry;
export const PRODUCTION_EVRY_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  [
    ...COMMUNICATION_MESSAGE_REVIEWS,
    ...COMMUNICATION_TEMPLATE_REVIEWS,
    ...MEETINGS_ARTIFACT_REVIEWS,
  ]
);
export const continueProductionEvryCapabilityConversation =
  composeEvryCapabilityConversationContinuations([
    continueCommunicationEvryConversation,
    continueMeetingsEvryConversation,
  ]);
export const productionEvryPlanTargetIsCurrent: EvryConversationPlanTargetValidator =
  async (input) =>
    input.step.capabilityIdentity.startsWith("meetings.")
      ? meetingsPlanTargetIsCurrent(input)
      : communicationEvryPlanTargetIsCurrent(input);
