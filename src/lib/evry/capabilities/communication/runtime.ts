import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
import type { EvryConversationPlanTargetValidator } from "@/lib/evry/conversations/plan-resume";
import { createEvryExecutionCapabilityRegistry } from "@/lib/evry/executor";

import {
  COMMUNICATION_MESSAGE_EXECUTIONS,
  COMMUNICATION_MESSAGE_REVIEWS,
  communicationEvryMessageTargetIsCurrent,
} from "./messages";
import {
  COMMUNICATION_TEMPLATE_EXECUTIONS,
  COMMUNICATION_TEMPLATE_REVIEWS,
  communicationEvryTemplateTargetIsCurrent,
} from "./templates";

/** The closed Communication effect surface installed as one production unit. */
export const COMMUNICATION_EVRY_EXECUTIONS = [
  ...COMMUNICATION_MESSAGE_EXECUTIONS,
  ...COMMUNICATION_TEMPLATE_EXECUTIONS,
] as const;
export const COMMUNICATION_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(COMMUNICATION_EVRY_EXECUTIONS);

export const COMMUNICATION_EVRY_PLAN_REGISTRY =
  COMMUNICATION_EVRY_EXECUTION_REGISTRY.planRegistry;

export const COMMUNICATION_EVRY_REVIEWS = [
  ...COMMUNICATION_MESSAGE_REVIEWS,
  ...COMMUNICATION_TEMPLATE_REVIEWS,
] as const;
export const COMMUNICATION_EVRY_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry(COMMUNICATION_EVRY_REVIEWS);

export const communicationEvryPlanTargetIsCurrent: EvryConversationPlanTargetValidator =
  async (input) => {
    if (input.step.capabilityIdentity.startsWith("communication.templates.")) {
      return communicationEvryTemplateTargetIsCurrent(input);
    }
    if (
      input.step.capabilityIdentity === "communication.messages.send" ||
      input.step.capabilityIdentity ===
        "communication.resends.send-to-non-openers"
    ) {
      return communicationEvryMessageTargetIsCurrent(input);
    }
    return false;
  };
