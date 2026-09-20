import { continuePlatformEvryConversation } from "./platform/conversation";
import { PRODUCTION_PEOPLE_EFFECT_EXECUTIONS } from "./execution";
import { PEOPLE_QUERY_READS } from "./queries/people";
import { OPERATIONS_QUERY_READS } from "./queries/operations";
import { CONTENT_QUERY_READS } from "./queries/content";
import { EVRY_READ_WORKFLOWS } from "@/lib/evry/recipes/read-workflows";
import { MEETING_INVITATION_MODEL_PREPARATION } from "@/lib/evry/recipes/meeting-invitation-preparation";
import { PEOPLE_MODEL_PREPARATIONS } from "./preparations/people";
import { OPERATIONS_MODEL_PREPARATIONS } from "./preparations/operations";
import { CONTENT_MODEL_PREPARATIONS } from "./preparations/content";
import {
  PLATFORM_READ_CONTRACTS,
  continuePlatformEvryRead,
} from "./platform/reads";
import { TEAMS_READ_CONTRACTS, executeTeamsRead } from "./teams/reads";
import { continuePlantIntelligenceEvryConversation } from "./plant-intelligence/conversation";
import { PLANT_INTELLIGENCE_READ_REGISTRATIONS } from "./plant-intelligence/reads";
import { continueMeetingInvitationConversation } from "@/lib/evry/recipes/meeting-invitation-conversation";
import { continueCommunicationEvryConversation } from "./communication/conversation";
import {
  createModelEvryConversation,
  type EvryModelRead,
} from "./model-conversation";
import { executeAuthorizedEvryRead } from "@/lib/evry/reads/contract";
import { COMMUNICATION_EVRY_READ_REGISTRATIONS } from "./communication/reads";
import { LAUNCH_READ_REGISTRATIONS } from "./launch/reads";
import { TASK_EVRY_READ_REGISTRATIONS } from "./tasks/reads";
import { MEETINGS_READ_CONTRACTS, executeMeetingsRead } from "./meetings/reads";
import { continueLaunchEvryConversation } from "./launch/conversation";
import { continueMeetingsEvryConversation } from "./meetings/conversation";
import { continuePeopleCoreConversation } from "./people/core-conversation";
import { continueDocumentsWikiEffectConversation } from "./documents-wiki/effect-conversation";
import { continueDocumentsWikiReadConversation } from "./documents-wiki/read-conversation";
import { DOCUMENTS_WIKI_READ_REGISTRATIONS } from "./documents-wiki/reads";
import { continuePeopleEvryConversation } from "./people/conversation";
import { continuePeopleFileReadConversation } from "./people/file-read-conversation";
import { PEOPLE_FILE_READ_REGISTRATIONS } from "./people/file-reads";
import { continuePeopleHouseholdConversation } from "./people/household-conversation";
import { continuePeopleMilestoneConversation } from "./people/milestone-conversation";
import { continuePeopleDomainReadConversation } from "./people/read-conversation";
import { PEOPLE_DOMAIN_READ_REGISTRATIONS } from "./people/reads";
import {
  PEOPLE_EVRY_ACTIVITIES_READ,
  PEOPLE_EVRY_LIST_READ,
  PEOPLE_EVRY_MORE_ACTIVITIES_READ,
} from "./people/runtime";
import { continuePeopleTaxonomyConversation } from "./people/taxonomy-conversation";
import { continueTaskEvryConversation } from "./tasks/conversation";
import { continueTeamsEvryConversation } from "./teams/conversation";

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
  continueDocumentsWikiReadConversation,
  continueDocumentsWikiEffectConversation,
  continuePlantIntelligenceEvryConversation,
  continuePlatformEvryConversation,
  continueTaskEvryConversation,
  continueTeamsEvryConversation,
]);

const PRODUCTION_PEOPLE_READ_REGISTRATIONS = Object.freeze([
  PEOPLE_EVRY_LIST_READ,
  PEOPLE_EVRY_ACTIVITIES_READ,
  PEOPLE_EVRY_MORE_ACTIVITIES_READ,
  ...PEOPLE_DOMAIN_READ_REGISTRATIONS,
  ...PEOPLE_FILE_READ_REGISTRATIONS,
]);

export const PRODUCTION_EVRY_READ_REGISTRATIONS = Object.freeze([
  ...PRODUCTION_PEOPLE_READ_REGISTRATIONS,
  ...PLANT_INTELLIGENCE_READ_REGISTRATIONS,
  ...DOCUMENTS_WIKI_READ_REGISTRATIONS,
]);

export const PRODUCTION_EVRY_PEOPLE_CAPABILITY_IDENTITIES = Object.freeze(
  [
    ...PRODUCTION_PEOPLE_EFFECT_EXECUTIONS.map(
      ({ planCapability }) => planCapability.identity
    ),
    ...PRODUCTION_PEOPLE_READ_REGISTRATIONS.map(
      ({ capabilityIdentity }) => capabilityIdentity
    ),
  ].toSorted()
);

export const PRODUCTION_EVRY_MODEL_READS: readonly EvryModelRead[] =
  Object.freeze([
    ...[
      ...PRODUCTION_EVRY_READ_REGISTRATIONS,
      ...COMMUNICATION_EVRY_READ_REGISTRATIONS,
      ...LAUNCH_READ_REGISTRATIONS,
      ...TASK_EVRY_READ_REGISTRATIONS,
      ...PEOPLE_QUERY_READS,
      ...OPERATIONS_QUERY_READS,
      ...CONTENT_QUERY_READS,
    ]
      .filter(
        (read) =>
          read.id !== "wiki.search" ||
          CONTENT_QUERY_READS.some((entry) => entry === read)
      )
      .map(
        (read): EvryModelRead => ({
          id: read.id,
          capabilityIdentity: read.capabilityIdentity,
          inputSchema: read.inputSchema,
          run: (authorization, input, argumentsValue) =>
            executeAuthorizedEvryRead(
              read,
              authorization,
              {
                literalUserText: input.literalUserText,
                pageContext: input.requestPageContext,
                now: input.now,
              },
              argumentsValue
            ),
        })
      ),
    ...MEETINGS_READ_CONTRACTS.map(
      (read): EvryModelRead => ({
        id: read.identity,
        capabilityIdentity: read.identity,
        inputSchema: read.inputSchema,
        run: (authorization, _input, untrustedInput) =>
          executeMeetingsRead({ authorization, untrustedInput }),
      })
    ),
    ...TEAMS_READ_CONTRACTS.map(
      (read): EvryModelRead => ({
        id: read.identity,
        capabilityIdentity: read.identity,
        inputSchema: read.inputSchema,
        run: (authorization, _input, untrustedInput) =>
          executeTeamsRead({ authorization, untrustedInput }),
      })
    ),
    ...PLATFORM_READ_CONTRACTS.map(
      (read): EvryModelRead => ({
        id: read.identity,
        capabilityIdentity: read.identity,
        inputSchema: read.inputSchema,
        run: async (authorization, _input, untrustedInput) => {
          const parsed = read.inputSchema.safeParse(untrustedInput);
          return parsed.success
            ? continuePlatformEvryRead({
                actor: authorization.actor,
                selection: parsed.data,
              })
            : null;
        },
      })
    ),
  ]);

export const PRODUCTION_EVRY_MODEL_PREPARATIONS = [
  ...PEOPLE_MODEL_PREPARATIONS,
  ...OPERATIONS_MODEL_PREPARATIONS,
  ...CONTENT_MODEL_PREPARATIONS,
  MEETING_INVITATION_MODEL_PREPARATION,
] as const;

export const continueProductionEvryCapabilityConversation =
  createModelEvryConversation({
    continuations: PRODUCTION_EVRY_CAPABILITY_CONTINUATIONS,
    reads: PRODUCTION_EVRY_MODEL_READS,
    recipes: EVRY_READ_WORKFLOWS,
    preparations: PRODUCTION_EVRY_MODEL_PREPARATIONS,
  });
