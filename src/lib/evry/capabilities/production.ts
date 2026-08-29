import { composeEvryCapabilityConversationContinuations } from "./conversation";
import { continueCommunicationEvryConversation } from "./communication/conversation";
import {
  COMMUNICATION_EVRY_EXECUTION_REGISTRY,
  COMMUNICATION_EVRY_PLAN_REGISTRY,
  COMMUNICATION_EVRY_REVIEW_REGISTRY,
  communicationEvryPlanTargetIsCurrent,
} from "./communication/runtime";

/** The one production composition seam capability packs extend. */
export const PRODUCTION_EVRY_PLAN_REGISTRY = COMMUNICATION_EVRY_PLAN_REGISTRY;
export const PRODUCTION_EVRY_EXECUTION_REGISTRY =
  COMMUNICATION_EVRY_EXECUTION_REGISTRY;
export const PRODUCTION_EVRY_REVIEW_REGISTRY =
  COMMUNICATION_EVRY_REVIEW_REGISTRY;
export const continueProductionEvryCapabilityConversation =
  composeEvryCapabilityConversationContinuations([
    continueCommunicationEvryConversation,
  ]);
export const productionEvryPlanTargetIsCurrent =
  communicationEvryPlanTargetIsCurrent;
