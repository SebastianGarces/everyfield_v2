import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
import type { EvryConversationPlanTargetValidator } from "@/lib/evry/conversations/plan-resume";
import { createEvryExecutionCapabilityRegistry } from "@/lib/evry/executor";

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
import { composeEvryCapabilityConversationContinuations } from "./conversation";
import { continueMeetingsEvryConversation } from "./meetings/conversation";
import { MEETINGS_ARTIFACT_REVIEWS } from "./meetings/review";
import {
  MEETINGS_EXECUTION_CAPABILITIES,
  meetingsPlanTargetIsCurrent,
} from "./meetings/runtime";
import { continuePeopleCoreConversation } from "./people/core-conversation";
import {
  PEOPLE_CORE_EXECUTIONS,
  PEOPLE_CORE_IDENTITIES,
  PEOPLE_CORE_REVIEWS,
  peopleCoreTargetIsCurrent,
} from "./people/core";
import { continuePeopleEvryConversation } from "./people/conversation";
import { continuePeopleFileReadConversation } from "./people/file-read-conversation";
import { PEOPLE_FILE_READ_REGISTRATIONS } from "./people/file-reads";
import {
  PEOPLE_FILE_EXECUTIONS,
  PEOPLE_FILE_IDENTITIES,
  PEOPLE_FILE_REVIEWS,
  peopleFileTargetIsCurrent,
} from "./people/files";
import { continuePeopleHouseholdConversation } from "./people/household-conversation";
import {
  HOUSEHOLD_EXECUTIONS,
  HOUSEHOLD_IDENTITIES,
  HOUSEHOLD_REVIEWS,
  householdTargetIsCurrent,
} from "./people/households";
import { continuePeopleMilestoneConversation } from "./people/milestone-conversation";
import {
  MILESTONE_EXECUTIONS,
  MILESTONE_IDENTITIES,
  MILESTONE_REVIEWS,
  milestoneTargetIsCurrent,
} from "./people/milestones";
import { continuePeopleDomainReadConversation } from "./people/read-conversation";
import { PEOPLE_DOMAIN_READ_REGISTRATIONS } from "./people/reads";
import {
  PEOPLE_EVRY_ACTIVITIES_READ,
  PEOPLE_EVRY_ADD_NOTE_EXECUTION,
  PEOPLE_EVRY_ADD_NOTE_IDENTITY,
  PEOPLE_EVRY_DELETE_NOTE_EXECUTION,
  PEOPLE_EVRY_DELETE_NOTE_IDENTITY,
  PEOPLE_EVRY_EDIT_NOTE_EXECUTION,
  PEOPLE_EVRY_EDIT_NOTE_IDENTITY,
  PEOPLE_EVRY_LIST_READ,
  PEOPLE_EVRY_MORE_ACTIVITIES_READ,
  PEOPLE_EVRY_REVIEWS,
  peopleEvryPlanTargetIsCurrent,
} from "./people/runtime";
import { continuePeopleTaxonomyConversation } from "./people/taxonomy-conversation";
import {
  TAXONOMY_EXECUTIONS,
  TAXONOMY_IDENTITIES,
  TAXONOMY_REVIEWS,
  taxonomyTargetIsCurrent,
} from "./people/taxonomies";

const PRODUCTION_COMMUNICATION_EXECUTIONS = Object.freeze([
  ...COMMUNICATION_MESSAGE_EXECUTIONS,
  ...COMMUNICATION_TEMPLATE_EXECUTIONS,
]);

const PRODUCTION_PEOPLE_EFFECT_EXECUTIONS = Object.freeze([
  PEOPLE_EVRY_ADD_NOTE_EXECUTION,
  PEOPLE_EVRY_EDIT_NOTE_EXECUTION,
  PEOPLE_EVRY_DELETE_NOTE_EXECUTION,
  ...PEOPLE_CORE_EXECUTIONS,
  ...TAXONOMY_EXECUTIONS,
  ...HOUSEHOLD_EXECUTIONS,
  ...MILESTONE_EXECUTIONS,
  ...PEOPLE_FILE_EXECUTIONS,
]);

export const PRODUCTION_EVRY_ARTIFACT_REVIEWS = Object.freeze([
  ...COMMUNICATION_MESSAGE_REVIEWS,
  ...COMMUNICATION_TEMPLATE_REVIEWS,
  ...MEETINGS_ARTIFACT_REVIEWS,
  ...PEOPLE_EVRY_REVIEWS,
  ...PEOPLE_CORE_REVIEWS,
  ...TAXONOMY_REVIEWS,
  ...HOUSEHOLD_REVIEWS,
  ...MILESTONE_REVIEWS,
  ...PEOPLE_FILE_REVIEWS,
]);

export const PRODUCTION_EVRY_CAPABILITY_CONTINUATIONS = Object.freeze([
  continueCommunicationEvryConversation,
  continueMeetingsEvryConversation,
  continuePeopleEvryConversation,
  continuePeopleDomainReadConversation,
  continuePeopleFileReadConversation,
  continuePeopleCoreConversation,
  continuePeopleTaxonomyConversation,
  continuePeopleHouseholdConversation,
  continuePeopleMilestoneConversation,
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
    ...PRODUCTION_PEOPLE_EFFECT_EXECUTIONS,
  ]);
export const PRODUCTION_EVRY_PLAN_REGISTRY =
  PRODUCTION_EVRY_EXECUTION_REGISTRY.planRegistry;
export const PRODUCTION_EVRY_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  PRODUCTION_EVRY_ARTIFACT_REVIEWS
);
export const PRODUCTION_EVRY_READ_REGISTRATIONS = Object.freeze([
  PEOPLE_EVRY_LIST_READ,
  PEOPLE_EVRY_ACTIVITIES_READ,
  PEOPLE_EVRY_MORE_ACTIVITIES_READ,
  ...PEOPLE_DOMAIN_READ_REGISTRATIONS,
  ...PEOPLE_FILE_READ_REGISTRATIONS,
]);
export const PRODUCTION_EVRY_PEOPLE_CAPABILITY_IDENTITIES = Object.freeze(
  [
    ...PRODUCTION_PEOPLE_EFFECT_EXECUTIONS.map(
      ({ planCapability }) => planCapability.identity
    ),
    ...PRODUCTION_EVRY_READ_REGISTRATIONS.map(
      ({ capabilityIdentity }) => capabilityIdentity
    ),
  ].toSorted()
);
export const continueProductionEvryCapabilityConversation =
  composeEvryCapabilityConversationContinuations(
    PRODUCTION_EVRY_CAPABILITY_CONTINUATIONS
  );

type ProductionTargetValidatorDependencies = Readonly<{
  communication: EvryConversationPlanTargetValidator;
  meetings: EvryConversationPlanTargetValidator;
}>;

/** Closed dispatch for the Communication and Meetings capability families. */
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

const communicationMeetingsTargetIsCurrent =
  createProductionEvryPlanTargetValidator();
const NOTE_IDENTITIES = new Set([
  PEOPLE_EVRY_ADD_NOTE_IDENTITY,
  PEOPLE_EVRY_EDIT_NOTE_IDENTITY,
  PEOPLE_EVRY_DELETE_NOTE_IDENTITY,
]);
const CORE_IDENTITIES = new Set<string>(Object.values(PEOPLE_CORE_IDENTITIES));
const TAXONOMY_IDENTITY_SET = new Set<string>(
  Object.values(TAXONOMY_IDENTITIES)
);
const HOUSEHOLD_IDENTITY_SET = new Set<string>(
  Object.values(HOUSEHOLD_IDENTITIES)
);
const MILESTONE_IDENTITY_SET = new Set<string>(
  Object.values(MILESTONE_IDENTITIES)
);
const FILE_IDENTITY_SET = new Set<string>(
  Object.values(PEOPLE_FILE_IDENTITIES)
);

type PeopleTargetValidationInput = Parameters<
  typeof peopleCoreTargetIsCurrent
>[0];

function hasPersistedPlanContext(
  input: PeopleTargetValidationInput
): input is Parameters<EvryConversationPlanTargetValidator>[0] {
  return "plan" in input && "checkedAt" in input;
}

/** Closed production dispatch across every installed capability family. */
export async function productionEvryPlanTargetIsCurrent(
  input: PeopleTargetValidationInput
): Promise<boolean> {
  const identity = input.step.capabilityIdentity;
  if (NOTE_IDENTITIES.has(identity)) {
    return peopleEvryPlanTargetIsCurrent(input);
  }
  if (CORE_IDENTITIES.has(identity)) return peopleCoreTargetIsCurrent(input);
  if (TAXONOMY_IDENTITY_SET.has(identity)) {
    return taxonomyTargetIsCurrent(input);
  }
  if (HOUSEHOLD_IDENTITY_SET.has(identity)) {
    return householdTargetIsCurrent(input);
  }
  if (MILESTONE_IDENTITY_SET.has(identity)) {
    return milestoneTargetIsCurrent(input);
  }
  if (FILE_IDENTITY_SET.has(identity)) return peopleFileTargetIsCurrent(input);
  if (!hasPersistedPlanContext(input)) return false;
  return communicationMeetingsTargetIsCurrent(input);
}
