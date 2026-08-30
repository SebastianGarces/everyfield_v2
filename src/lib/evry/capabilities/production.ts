import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
import { createEvryExecutionCapabilityRegistry } from "@/lib/evry/executor";
import { createEvryPlanCapabilityRegistry } from "@/lib/evry/plans";

import { continueCommunicationEvryConversation } from "./communication/conversation";
import {
  COMMUNICATION_MESSAGE_EXECUTIONS,
  COMMUNICATION_MESSAGE_REVIEWS,
  communicationEvryMessageTargetIsCurrent,
} from "./communication/messages";
import {
  COMMUNICATION_TEMPLATE_EXECUTIONS,
  COMMUNICATION_TEMPLATE_REVIEWS,
  communicationEvryTemplateTargetIsCurrent,
} from "./communication/templates";
import { composeEvryCapabilityConversationContinuations } from "./conversation";
import { continuePeopleCoreConversation } from "./people/core-conversation";
import {
  PEOPLE_CORE_EXECUTIONS,
  PEOPLE_CORE_IDENTITIES,
  PEOPLE_CORE_REVIEWS,
  peopleCoreTargetIsCurrent,
} from "./people/core";
import { continuePeopleEvryConversation } from "./people/conversation";
import { continuePeopleDomainReadConversation } from "./people/read-conversation";
import { PEOPLE_DOMAIN_READ_REGISTRATIONS } from "./people/reads";
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
import {
  PEOPLE_EVRY_ADD_NOTE_EXECUTION,
  PEOPLE_EVRY_ADD_NOTE_IDENTITY,
  PEOPLE_EVRY_DELETE_NOTE_EXECUTION,
  PEOPLE_EVRY_DELETE_NOTE_IDENTITY,
  PEOPLE_EVRY_EDIT_NOTE_EXECUTION,
  PEOPLE_EVRY_EDIT_NOTE_IDENTITY,
  PEOPLE_EVRY_REVIEWS,
  PEOPLE_EVRY_ACTIVITIES_READ,
  PEOPLE_EVRY_LIST_READ,
  PEOPLE_EVRY_MORE_ACTIVITIES_READ,
  peopleEvryPlanTargetIsCurrent,
} from "./people/runtime";
import { continuePeopleTaxonomyConversation } from "./people/taxonomy-conversation";
import {
  TAXONOMY_EXECUTIONS,
  TAXONOMY_IDENTITIES,
  TAXONOMY_REVIEWS,
  taxonomyTargetIsCurrent,
} from "./people/taxonomies";

/** The one production composition seam capability packs extend. */
const PRODUCTION_PEOPLE_EFFECT_EXECUTIONS = [
  PEOPLE_EVRY_ADD_NOTE_EXECUTION,
  PEOPLE_EVRY_EDIT_NOTE_EXECUTION,
  PEOPLE_EVRY_DELETE_NOTE_EXECUTION,
  ...PEOPLE_CORE_EXECUTIONS,
  ...TAXONOMY_EXECUTIONS,
  ...HOUSEHOLD_EXECUTIONS,
  ...MILESTONE_EXECUTIONS,
  ...PEOPLE_FILE_EXECUTIONS,
] as const;

export const PRODUCTION_EVRY_PLAN_REGISTRY = createEvryPlanCapabilityRegistry([
  ...COMMUNICATION_MESSAGE_EXECUTIONS.map(
    ({ planCapability }) => planCapability
  ),
  ...COMMUNICATION_TEMPLATE_EXECUTIONS.map(
    ({ planCapability }) => planCapability
  ),
  ...PRODUCTION_PEOPLE_EFFECT_EXECUTIONS.map(
    ({ planCapability }) => planCapability
  ),
]);
export const PRODUCTION_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry([
    ...COMMUNICATION_MESSAGE_EXECUTIONS,
    ...COMMUNICATION_TEMPLATE_EXECUTIONS,
    ...PRODUCTION_PEOPLE_EFFECT_EXECUTIONS,
  ]);
export const PRODUCTION_EVRY_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  [
    ...COMMUNICATION_MESSAGE_REVIEWS,
    ...COMMUNICATION_TEMPLATE_REVIEWS,
    ...PEOPLE_EVRY_REVIEWS,
    ...PEOPLE_CORE_REVIEWS,
    ...TAXONOMY_REVIEWS,
    ...HOUSEHOLD_REVIEWS,
    ...MILESTONE_REVIEWS,
    ...PEOPLE_FILE_REVIEWS,
  ]
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
  composeEvryCapabilityConversationContinuations([
    continueCommunicationEvryConversation,
    continuePeopleEvryConversation,
    continuePeopleDomainReadConversation,
    continuePeopleFileReadConversation,
    continuePeopleCoreConversation,
    continuePeopleTaxonomyConversation,
    continuePeopleHouseholdConversation,
    continuePeopleMilestoneConversation,
  ]);

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

export async function productionEvryPlanTargetIsCurrent(
  input: Parameters<typeof peopleCoreTargetIsCurrent>[0]
) {
  const identity = input.step.capabilityIdentity;
  if (identity.startsWith("communication.templates.")) {
    return communicationEvryTemplateTargetIsCurrent(input);
  }
  if (
    identity === "communication.messages.send" ||
    identity === "communication.resends.send-to-non-openers"
  ) {
    return communicationEvryMessageTargetIsCurrent(input);
  }
  if (NOTE_IDENTITIES.has(identity))
    return peopleEvryPlanTargetIsCurrent(input);
  if (CORE_IDENTITIES.has(identity)) return peopleCoreTargetIsCurrent(input);
  if (TAXONOMY_IDENTITY_SET.has(identity))
    return taxonomyTargetIsCurrent(input);
  if (HOUSEHOLD_IDENTITY_SET.has(identity))
    return householdTargetIsCurrent(input);
  if (MILESTONE_IDENTITY_SET.has(identity))
    return milestoneTargetIsCurrent(input);
  if (FILE_IDENTITY_SET.has(identity)) return peopleFileTargetIsCurrent(input);
  return false;
}
