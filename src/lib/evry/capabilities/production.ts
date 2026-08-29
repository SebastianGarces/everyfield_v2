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

const PRODUCTION_COMMUNICATION_EXECUTIONS = Object.freeze([
  ...COMMUNICATION_MESSAGE_EXECUTIONS,
  ...COMMUNICATION_TEMPLATE_EXECUTIONS,
]);

export const PRODUCTION_EVRY_ARTIFACT_REVIEWS = Object.freeze([
  ...COMMUNICATION_MESSAGE_REVIEWS,
  ...COMMUNICATION_TEMPLATE_REVIEWS,
  ...MEETINGS_ARTIFACT_REVIEWS,
]);

export const PRODUCTION_EVRY_CAPABILITY_CONTINUATIONS = Object.freeze([
  continueCommunicationEvryConversation,
  continueMeetingsEvryConversation,
]);

const COMMUNICATION_EFFECT_IDENTITIES = new Set(
  PRODUCTION_COMMUNICATION_EXECUTIONS.map(
    ({ planCapability }) => planCapability.identity
  )
);
const MEETINGS_EFFECT_IDENTITIES = new Set(
  MEETINGS_EXECUTION_CAPABILITIES.map(
    ({ planCapability }) => planCapability.identity
  )
);

/** The one production composition seam capability packs extend. */
export const PRODUCTION_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry([
    ...PRODUCTION_COMMUNICATION_EXECUTIONS,
    ...MEETINGS_EXECUTION_CAPABILITIES,
  ]);
export const PRODUCTION_EVRY_PLAN_REGISTRY =
  PRODUCTION_EVRY_EXECUTION_REGISTRY.planRegistry;
export const PRODUCTION_EVRY_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  PRODUCTION_EVRY_ARTIFACT_REVIEWS
);
export const continueProductionEvryCapabilityConversation =
  composeEvryCapabilityConversationContinuations(
    PRODUCTION_EVRY_CAPABILITY_CONTINUATIONS
  );

type ProductionTargetValidatorDependencies = Readonly<{
  communication: EvryConversationPlanTargetValidator;
  meetings: EvryConversationPlanTargetValidator;
}>;

/** Closed dispatch: an unregistered family never falls through to Communication. */
export function createProductionEvryPlanTargetValidator(
  dependencies: ProductionTargetValidatorDependencies = {
    communication: communicationEvryPlanTargetIsCurrent,
    meetings: meetingsPlanTargetIsCurrent,
  }
): EvryConversationPlanTargetValidator {
  return async (input) => {
    const identity = input.step.capabilityIdentity;
    if (MEETINGS_EFFECT_IDENTITIES.has(identity)) {
      return dependencies.meetings(input);
    }
    if (COMMUNICATION_EFFECT_IDENTITIES.has(identity)) {
      return dependencies.communication(input);
    }
    return false;
  };
}

export const productionEvryPlanTargetIsCurrent =
  createProductionEvryPlanTargetValidator();
