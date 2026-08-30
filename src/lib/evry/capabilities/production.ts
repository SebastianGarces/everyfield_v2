import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
import type { EvryConversationPlanTargetValidator } from "@/lib/evry/conversations/plan-resume";
import {
  createEvryExecutionCapabilityRegistry,
  executeEvryActionPlan,
  executeEvryRecipePlan,
} from "@/lib/evry/executor";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { findExactEvryActionPlan } from "@/lib/evry/plans/repository";
import { continueMeetingInvitationConversation } from "@/lib/evry/recipes/meeting-invitation-conversation";
import {
  MEETING_INVITATION_ARTIFACT_REVIEW,
  MEETING_INVITATION_RECIPE_IDENTITY,
  MEETING_INVITATION_RECIPE_REGISTRY,
  meetingInvitationPlanTargetsAreCurrent,
} from "@/lib/evry/recipes/meeting-invitation";

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
import { continueTaskEvryConversation } from "./tasks/conversation";
import { TASK_ARTIFACT_REVIEWS } from "./tasks/review";
import {
  TASK_EXECUTION_CAPABILITIES,
  taskEvryPlanTargetIsCurrent,
} from "./tasks/runtime";

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

function recipeIdentityForDocument(document: unknown): unknown {
  return document && typeof document === "object" && "recipe" in document
    ? (document.recipe as { identity?: unknown } | undefined)?.identity
    : null;
}

export const PRODUCTION_EVRY_ARTIFACT_REVIEWS = Object.freeze([
  MEETING_INVITATION_ARTIFACT_REVIEW,
  ...COMMUNICATION_EVRY_REVIEWS,
  ...MEETINGS_ARTIFACT_REVIEWS,
  ...LAUNCH_EVRY_REVIEWS,
  ...PEOPLE_EVRY_REVIEWS,
  ...PEOPLE_CORE_REVIEWS,
  ...TAXONOMY_REVIEWS,
  ...HOUSEHOLD_REVIEWS,
  ...MILESTONE_REVIEWS,
  ...PEOPLE_FILE_REVIEWS,
  ...TASK_ARTIFACT_REVIEWS,
]);

export const PRODUCTION_EVRY_CAPABILITY_CONTINUATIONS = Object.freeze([
  continueMeetingInvitationConversation,
  continueCommunicationEvryConversation,
  continueMeetingsEvryConversation,
  continueLaunchEvryConversation,
  continuePeopleEvryConversation,
  continuePeopleDomainReadConversation,
  continuePeopleFileReadConversation,
  continuePeopleCoreConversation,
  continuePeopleTaxonomyConversation,
  continuePeopleHouseholdConversation,
  continuePeopleMilestoneConversation,
  continueTaskEvryConversation,
]);

const COMMUNICATION_EFFECT_IDENTITIES = new Set(
  COMMUNICATION_EVRY_EXECUTIONS.map(
    ({ planCapability }) => planCapability.identity
  )
);
const MEETINGS_EFFECT_IDENTITIES = new Set(
  MEETINGS_EXECUTION_CAPABILITIES.map(
    ({ planCapability }) => planCapability.identity
  )
);
const LAUNCH_EFFECT_IDENTITIES = new Set(
  LAUNCH_EVRY_EXECUTIONS.map(({ planCapability }) => planCapability.identity)
);
const TASK_EFFECT_IDENTITIES = new Set(
  TASK_EXECUTION_CAPABILITIES.map(
    ({ planCapability }) => planCapability.identity
  )
);

/** The one production composition seam capability packs extend. */
export const PRODUCTION_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry([
    ...COMMUNICATION_EVRY_EXECUTIONS,
    ...MEETINGS_EXECUTION_CAPABILITIES,
    ...LAUNCH_EVRY_EXECUTIONS,
    ...PRODUCTION_PEOPLE_EFFECT_EXECUTIONS,
    ...TASK_EXECUTION_CAPABILITIES,
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

/** Closed dispatch that admits the one installed recipe and no caller registry. */
export async function executeProductionEvryActionPlan(input: {
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
}) {
  const stored = await findExactEvryActionPlan({
    planId: input.planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: input.fingerprint,
  });
  const recipeIdentity = recipeIdentityForDocument(stored?.document);
  if (recipeIdentity === MEETING_INVITATION_RECIPE_IDENTITY) {
    return executeEvryRecipePlan({
      ...input,
      recipeRegistry: MEETING_INVITATION_RECIPE_REGISTRY,
    });
  }
  return executeEvryActionPlan({
    ...input,
    registry: PRODUCTION_EVRY_EXECUTION_REGISTRY,
  });
}

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
  if (
    hasPersistedPlanContext(input) &&
    recipeIdentityForDocument(input.plan.document) ===
      MEETING_INVITATION_RECIPE_IDENTITY
  ) {
    return meetingInvitationPlanTargetsAreCurrent(input);
  }
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
  if (TASK_EFFECT_IDENTITIES.has(identity)) {
    return taskEvryPlanTargetIsCurrent(input);
  }
  if (LAUNCH_EFFECT_IDENTITIES.has(identity)) {
    return launchEvryPlanTargetIsCurrent(input);
  }
  return communicationMeetingsTargetIsCurrent(input);
}
