import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  locations,
  meetingAttendance,
  persons,
} from "@/db/schema";
import {
  instantsAtZonedTime,
  toCalendarDate,
  utcOffsetForZonedTime,
} from "@/lib/datetime";
import {
  resolveEvryCommunicationAudience,
  type EvryPlannedCommunicationMeeting,
} from "@/lib/communication/evry-send";
import { communicationEvryEffectUuid } from "@/lib/communication/evry-effect";
import {
  buildEvryConfirmationArtifact,
  type EvryDetailedConfirmationArtifactDocument,
} from "@/lib/evry/artifacts/review";
import {
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
  type EvryArtifactReviewRegistration,
} from "@/lib/evry/artifacts/trusted-plan-review";
import {
  trustedEvryApplicationSourceLink,
  type EvryConfirmationDateTimeDocument,
} from "@/lib/evry/artifacts/types";
import type { EvryClarificationArtifact } from "@/lib/evry/artifacts/types";
import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";
import { resolveMeetingsEvryEffect } from "@/lib/evry/capabilities/meetings/resolver";
import { resolveMeetingGuestBatchAfterCreate } from "@/lib/evry/capabilities/meetings/resolver";
import { MEETING_GUEST_BATCH_ARGUMENT_SCHEMA } from "@/lib/evry/capabilities/meetings/dependency-output";
import { MEETINGS_EFFECT_ARGUMENT_SCHEMAS } from "@/lib/evry/capabilities/meetings/effect-contracts";
import {
  MEETINGS_EXECUTION_CAPABILITIES,
  meetingsPlanTargetIsCurrent,
} from "@/lib/evry/capabilities/meetings/runtime";
import {
  COMMUNICATION_MESSAGE_SEND_ARGUMENT_SCHEMA,
  COMMUNICATION_MESSAGE_SEND_EXECUTION,
} from "@/lib/evry/capabilities/communication/messages";
import type {
  EvryActionPlanDocument,
  EvryActionStep,
  EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { parseStoredEvryActionPlan } from "@/lib/evry/plans";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  EVRY_PEOPLE_READ_PROBE_IDENTITY,
  type EvryReadCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import {
  createEvryExecutionCapabilityRegistry,
  type EvryExecutionCapabilityRegistration,
} from "@/lib/evry/executor";
import {
  createEvryRecipeRegistry,
  defineEvryRecipeResolver,
  type EvryRecipeResolverRegistration,
} from "./schema";
import { storedDocumentMatchesEvryRecipe } from "./contract";
import {
  resolveEvryPlantDateTimeRequest,
  type EvryDateTimeResolution,
  type EvryResolvedPlantDateTime,
} from "@/lib/evry/resolvers/datetime";
import {
  loadSuppressedAddresses,
  normalizeEmailAddress,
} from "@/lib/notifications/channels/suppression";

export const MEETING_INVITATION_RECIPE_IDENTITY =
  "meeting.invitation.reference";
export const MEETING_INVITATION_CAPABILITY_IDENTITY = "meetings.create";
export const MEETING_INVITATION_ADD_GUESTS_IDENTITY = "meetings.add-guests";
export const MEETING_INVITATION_SEND_IDENTITY = "communication.messages.send";
export const MEETING_INVITATION_PLAN_RESOLVER_IDENTITY =
  "meeting.invitation.plan.resolve";

const CORE_TEAM_STATUSES = new Set(["core_group", "launch_team", "leader"]);

export type MeetingInvitationReferenceRequest = Readonly<{
  sourceText: string;
  durationMinutes?: number;
  locationId?: string;
  locationQuery?: string;
  subject: string;
  body: string;
}>;

export type MeetingInvitationLocation = Readonly<{
  id: string | null;
  name: string;
  address: string;
}>;

export type MeetingInvitationPersonFact = Readonly<{
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  status: string;
  attendedVisionMeeting: boolean;
  expectedUpdatedAt: string;
}>;

export type MeetingInvitationReferenceFacts = Readonly<{
  church: Readonly<{
    id: string;
    name: string;
    streetAddress: string | null;
    city: string | null;
    stateRegion: string | null;
    country: string | null;
  }>;
  locations: readonly MeetingInvitationLocation[];
  people: readonly MeetingInvitationPersonFact[];
  suppressedEmails: ReadonlySet<string>;
}>;

export type MeetingInvitationGuest = Readonly<{
  personId: string;
  label: string;
  email: string;
  expectedPersonUpdatedAt: string;
}>;

export type MeetingInvitationExclusion = Readonly<{
  personId: string;
  label: string;
  reason:
    | "Prior Vision Meeting attendance"
    | "Missing email address"
    | "Suppressed email address"
    | "Duplicate email address";
}>;

export type ResolvedMeetingInvitationReference = Readonly<{
  kind: "resolved";
  meetingType: "vision_meeting";
  dateTime: EvryResolvedPlantDateTime;
  durationMinutes: number;
  location: MeetingInvitationLocation;
  guests: readonly MeetingInvitationGuest[];
  exclusions: readonly MeetingInvitationExclusion[];
  subject: string;
  body: string;
}>;

export type MeetingInvitationReferenceResolution =
  | ResolvedMeetingInvitationReference
  | Readonly<{ kind: "clarification"; artifact: EvryClarificationArtifact }>
  | Readonly<{ kind: "unavailable" }>;

export const MEETING_INVITATION_PLAN_SNAPSHOT_SCHEMA = z.strictObject({
  meeting: MEETINGS_EFFECT_ARGUMENT_SCHEMAS.createMeetingAction,
  guests: MEETING_GUEST_BATCH_ARGUMENT_SCHEMA,
  communication: COMMUNICATION_MESSAGE_SEND_ARGUMENT_SCHEMA,
});
export type MeetingInvitationPlanSnapshot = Readonly<
  z.infer<typeof MEETING_INVITATION_PLAN_SNAPSHOT_SCHEMA>
>;

const meetingInvitationRequestSchema = z.strictObject({
  sourceText: z.string().trim().min(1).max(4_000),
  durationMinutes: z.number().int().min(1).max(1_440).optional(),
  locationId: z.string().uuid().optional(),
  locationQuery: z.string().trim().min(1).max(500).optional(),
  subject: z.string().trim().min(1).max(998),
  body: z.string().trim().min(1).max(200_000),
});

export const MEETING_INVITATION_PLAN_RESOLVER_INPUT_SCHEMA = z.strictObject({
  request: meetingInvitationRequestSchema,
  requestKey: z.string().uuid(),
  now: z.string().datetime({ offset: true }),
});
export type MeetingInvitationPlanResolverInput = z.infer<
  typeof MEETING_INVITATION_PLAN_RESOLVER_INPUT_SCHEMA
>;

type MeetingInvitationPlanDependencies = Readonly<{
  resolveMeeting: typeof resolveMeetingsEvryEffect;
  resolveGuests: typeof resolveMeetingGuestBatchAfterCreate;
  resolveAudience: typeof resolveEvryCommunicationAudience;
}>;

function pinnedMeetingDateTime(dateTime: EvryResolvedPlantDateTime): string {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(dateTime.localTime);
  if (!match) throw new Error("Meeting invitation start time is invalid");
  const hour = (Number(match[1]) % 12) + (match[3] === "PM" ? 12 : 0);
  return `${dateTime.calendarDate}T${String(hour).padStart(2, "0")}:${match[2]}:00.000Z`;
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/** Resolve the real Meetings and Communication arguments before persistence. */
export function createMeetingInvitationPlanResolver(
  dependencies: MeetingInvitationPlanDependencies
) {
  return async function plan(input: {
    actor: EvryPlantActor;
    resolved: ResolvedMeetingInvitationReference;
    requestKey: EvryPlanRequestKey;
    now: Date;
  }): Promise<MeetingInvitationPlanSnapshot | null> {
    const location = input.resolved.location;
    const meeting = await dependencies.resolveMeeting({
      actor: input.actor,
      selection: {
        kind: "effect",
        exportName: "createMeetingAction",
        values: {
          type: "vision_meeting",
          datetime: pinnedMeetingDateTime(input.resolved.dateTime),
          timezone: input.resolved.dateTime.timeZone,
          title: null,
          locationId: location.id,
          locationName: location.id ? null : location.name,
          locationAddress: location.id ? null : location.address,
          teamId: null,
          meetingSubtype: null,
          estimatedAttendance: input.resolved.guests.length,
          durationMinutes: input.resolved.durationMinutes,
          notes: null,
        },
      },
      pageContext: null,
      requestKey: input.requestKey,
      now: input.now,
    });
    if (!meeting || meeting.exportName !== "createMeetingAction") return null;
    const meetingArguments = meeting.arguments;
    const plannedMeeting: EvryPlannedCommunicationMeeting = {
      id: meetingArguments.meetingId,
      title: meetingArguments.title,
      type: meetingArguments.type,
      datetime: new Date(meetingArguments.datetime),
      locationName: meetingArguments.locationName,
      locationAddress: meetingArguments.locationAddress,
      agenda: meetingArguments.agenda,
    };
    const recipientIds = input.resolved.guests.map(({ personId }) => personId);
    const audience = await dependencies.resolveAudience({
      churchId: input.actor.plantId,
      recipientIds,
      subject: input.resolved.subject,
      body: input.resolved.body,
      channel: "email",
      templateId: null,
      meetingId: meetingArguments.meetingId,
      plannedMeeting,
    });
    if (
      !audience ||
      !sameIds(
        audience.recipients.map(({ personId }) => personId).toSorted(),
        [...recipientIds].toSorted()
      )
    ) {
      return null;
    }
    const guestTargets = input.resolved.guests.map((guest) =>
      Object.freeze({
        attendanceId: communicationEvryEffectUuid(
          input.requestKey,
          `meeting-guest:${guest.personId}`
        ),
        personId: guest.personId,
        label: guest.label,
        email: guest.email,
        expectedPersonUpdatedAt: guest.expectedPersonUpdatedAt,
        expectedAttendanceAbsent: true as const,
      })
    );
    const guests = await dependencies.resolveGuests({
      actor: input.actor,
      create: meetingArguments,
      dependencyStepId: "create-meeting",
      targets: guestTargets,
      exclusions: [...input.resolved.exclusions],
      requestKey: input.requestKey,
      now: input.now,
    });
    if (!guests) return null;
    return MEETING_INVITATION_PLAN_SNAPSHOT_SCHEMA.parse({
      meeting: meetingArguments,
      guests,
      communication: {
        communicationId: communicationEvryEffectUuid(
          input.requestKey,
          "communication"
        ),
        recipientSource: {
          kind: "people" as const,
          recipientIds: [...recipientIds],
        },
        audience,
      },
    });
  };
}

export const resolveMeetingInvitationPlan = createMeetingInvitationPlanResolver(
  {
    resolveMeeting: resolveMeetingsEvryEffect,
    resolveGuests: resolveMeetingGuestBatchAfterCreate,
    resolveAudience: resolveEvryCommunicationAudience,
  }
);

function inputBindings(
  keys: readonly string[],
  inputKey: string,
  prefix: readonly string[] = []
) {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      { kind: "input_path" as const, inputKey, path: [...prefix, key] },
    ])
  );
}

function disclosureItems(keys: readonly string[]) {
  return keys.map((key) => ({
    label: key,
    value: { kind: "argument_summary" as const, argumentKey: key },
  }));
}

const GUEST_BATCH_KEYS = [
  "mode",
  "meetingId",
  "dependencyStepId",
  "targets",
  "exclusions",
  "expectedCoreGroupUserIds",
  "expectedReminderUserIds",
  "notificationTargets",
] as const;
const COMMUNICATION_KEYS = [
  "communicationId",
  "recipientSource",
  "audience",
] as const;

/** Canonical EV-019 execution graph; all target IDs live in these inputs. */
export function meetingInvitationRecipeDefinition() {
  const meetingKeys = Object.keys(
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS.createMeetingAction.shape
  );
  return {
    identity: MEETING_INVITATION_RECIPE_IDENTITY,
    requiredInputs: [
      {
        key: "plan",
        schema: MEETING_INVITATION_PLAN_SNAPSHOT_SCHEMA,
      },
    ],
    optionalInputs: [],
    recordResolvers: [
      {
        inputKey: "plan",
        resolverIdentity: MEETING_INVITATION_PLAN_RESOLVER_IDENTITY,
      },
    ],
    preconditions: [],
    eligibleCapabilities: [
      MEETING_INVITATION_CAPABILITY_IDENTITY,
      MEETING_INVITATION_ADD_GUESTS_IDENTITY,
      MEETING_INVITATION_SEND_IDENTITY,
    ],
    confirmation: {
      title: "Create Vision Meeting and send invitations",
      actionLabel: "Create meeting and send invitations",
    },
    steps: [
      {
        id: "create-meeting",
        capabilityIdentity: MEETING_INVITATION_CAPABILITY_IDENTITY,
        arguments: inputBindings(meetingKeys, "plan", ["meeting"]),
        dependsOn: [],
        disclosure: {
          title: "Create Vision Meeting",
          items: disclosureItems(meetingKeys),
          consequences: [
            "Creates one Vision Meeting in the plant calendar.",
            "Schedules the exact meeting notifications shown in this review.",
          ],
        },
        failurePolicy: { retry: "same_plan" },
      },
      {
        id: "add-guests",
        capabilityIdentity: MEETING_INVITATION_ADD_GUESTS_IDENTITY,
        arguments: inputBindings(GUEST_BATCH_KEYS, "plan", ["guests"]),
        dependsOn: ["create-meeting"],
        disclosure: {
          title: "Add resolved guests",
          items: disclosureItems(GUEST_BATCH_KEYS),
          consequences: [
            "Adds the exact resolved people to the guest list.",
            "Schedules the exact guest notifications shown in this review.",
          ],
        },
        failurePolicy: { retry: "same_plan" },
      },
      {
        id: "send-invitations",
        capabilityIdentity: MEETING_INVITATION_SEND_IDENTITY,
        arguments: inputBindings(COMMUNICATION_KEYS, "plan", ["communication"]),
        dependsOn: ["add-guests"],
        disclosure: {
          title: "Send the invitation",
          items: disclosureItems(COMMUNICATION_KEYS),
          consequences: ["Sends the approved invitation emails immediately."],
        },
        failurePolicy: { retry: "same_plan" },
      },
    ],
  };
}

const invitationMeetingsExecutions = MEETINGS_EXECUTION_CAPABILITIES.filter(
  ({ planCapability }) =>
    planCapability.identity === MEETING_INVITATION_CAPABILITY_IDENTITY ||
    planCapability.identity === MEETING_INVITATION_ADD_GUESTS_IDENTITY
);

export function createMeetingInvitationRecipeRegistry(
  overrides: Readonly<{
    addGuests?: EvryExecutionCapabilityRegistration;
    send?: EvryExecutionCapabilityRegistration;
    planResolver?: EvryRecipeResolverRegistration;
  }> = {}
) {
  const createExecution = invitationMeetingsExecutions.find(
    ({ planCapability }) =>
      planCapability.identity === MEETING_INVITATION_CAPABILITY_IDENTITY
  );
  const addGuests =
    overrides.addGuests ??
    invitationMeetingsExecutions.find(
      ({ planCapability }) =>
        planCapability.identity === MEETING_INVITATION_ADD_GUESTS_IDENTITY
    );
  const send = overrides.send ?? COMMUNICATION_MESSAGE_SEND_EXECUTION;
  if (
    !createExecution ||
    !addGuests ||
    addGuests.planCapability.identity !==
      MEETING_INVITATION_ADD_GUESTS_IDENTITY ||
    send.planCapability.identity !== MEETING_INVITATION_SEND_IDENTITY
  ) {
    throw new Error(
      "Meeting invitation registry requires the exact send effect"
    );
  }
  return createEvryRecipeRegistry({
    executionRegistry: createEvryExecutionCapabilityRegistry([
      createExecution,
      addGuests,
      send,
    ]),
    resolvers: [
      overrides.planResolver ?? meetingInvitationPlanResolverRegistration(),
    ],
    preconditions: [],
    definitions: [meetingInvitationRecipeDefinition()],
  });
}

export const MEETING_INVITATION_RECIPE_REGISTRY =
  createMeetingInvitationRecipeRegistry();

function localTimeAt(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

function endDateTime(
  start: EvryConfirmationDateTimeDocument,
  durationMinutes: number
): EvryConfirmationDateTimeDocument {
  const instant = new Date(
    new Date(start.instantUtc).getTime() + durationMinutes * 60_000
  );
  const calendarDate = toCalendarDate(instant, start.timeZone);
  const localTime = localTimeAt(instant, start.timeZone);
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(localTime);
  if (!match) throw new Error("Meeting invitation end time is invalid");
  const hour = (Number(match[1]) % 12) + (match[3] === "PM" ? 12 : 0);
  return {
    calendarDate,
    localTime,
    timeZone: start.timeZone,
    utcOffset: utcOffsetForZonedTime(
      calendarDate,
      hour,
      Number(match[2]),
      instant
    ),
    instantUtc: instant.toISOString(),
    interpretation: {
      basis: "explicit-calendar-date",
      sourceText: `${durationMinutes} minutes after ${start.interpretation.sourceText}`,
      statedCalendarDate: calendarDate,
    },
  };
}

function exclusionCounts(exclusions: readonly Readonly<{ reason: string }>[]) {
  const counts = new Map<string, number>();
  for (const { reason } of exclusions) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, count]) => ({ reason, count }));
}

function persistedTargets(step: EvryActionStep) {
  if (!step.disclosure) throw new Error("Recipe step disclosure is missing");
  return step.disclosure.items.map(({ label, value }) => ({
    label,
    value,
    sourceLink: null,
  }));
}

function persistedMeetingDateTime(
  meeting: z.infer<typeof MEETINGS_EFFECT_ARGUMENT_SCHEMAS.createMeetingAction>
) {
  const pinnedWallClock = new Date(meeting.datetime);
  if (Number.isNaN(pinnedWallClock.getTime())) {
    throw new Error("Meeting invitation start time is invalid");
  }
  const calendarDate = pinnedWallClock.toISOString().slice(0, 10);
  const hour = pinnedWallClock.getUTCHours();
  const minute = pinnedWallClock.getUTCMinutes();
  const candidates = instantsAtZonedTime(
    calendarDate,
    hour,
    minute,
    meeting.timezone
  );
  if (candidates.length !== 1) {
    throw new Error("Meeting invitation start time is invalid");
  }
  const instant = candidates[0];
  const localTime = localTimeAt(instant, meeting.timezone);
  const startsAt: EvryConfirmationDateTimeDocument = {
    calendarDate,
    localTime,
    timeZone: meeting.timezone,
    utcOffset: utcOffsetForZonedTime(calendarDate, hour, minute, instant),
    instantUtc: instant.toISOString(),
    interpretation: {
      basis: "explicit-calendar-date",
      sourceText: `${calendarDate} ${localTime} ${meeting.timezone}`,
      statedCalendarDate: calendarDate,
    },
  };
  return {
    startsAt,
    endsAt:
      meeting.durationMinutes === null
        ? null
        : endDateTime(startsAt, meeting.durationMinutes),
  };
}

/** Build the review solely from the fingerprinted persisted recipe steps. */
export function buildMeetingInvitationConfirmation(input: {
  plan: EvryConversationPlanIdentity;
  document: EvryActionPlanDocument;
}): EvryDetailedConfirmationArtifactDocument {
  const [createStep, guestStep, sendStep] = input.document.steps;
  if (
    !createStep ||
    !guestStep ||
    !sendStep ||
    input.document.steps.length !== 3
  ) {
    throw new Error("Meeting invitation review requires its exact three steps");
  }
  const meeting = MEETINGS_EFFECT_ARGUMENT_SCHEMAS.createMeetingAction.parse(
    createStep.arguments
  );
  const guests = MEETING_GUEST_BATCH_ARGUMENT_SCHEMA.parse(guestStep.arguments);
  const communication = COMMUNICATION_MESSAGE_SEND_ARGUMENT_SCHEMA.parse(
    sendStep.arguments
  );
  return buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: input.plan,
    title: input.document.confirmation?.title ?? "",
    actionLabel: input.document.confirmation?.actionLabel ?? "",
    steps: [
      {
        stepId: createStep.id,
        title: createStep.disclosure?.title ?? "",
        effectKind: "meeting",
        reversibility: "reversible",
        resolvedTargets: persistedTargets(createStep),
        counts: [
          { label: "Meetings created", count: 1 },
          {
            label: "Meeting notifications scheduled",
            count: meeting.notificationTargets.length,
          },
        ],
        exclusions: [],
        dateTime: persistedMeetingDateTime(meeting),
        contentPreviews: meeting.notificationTargets.map(
          (notification, index) => ({
            label: `Meeting notification ${index + 1}`,
            content: JSON.stringify(notification),
          })
        ),
        beforeAfter: [],
      },
      {
        stepId: guestStep.id,
        title: guestStep.disclosure?.title ?? "",
        effectKind: "other",
        reversibility: "reversible",
        resolvedTargets: persistedTargets(guestStep),
        counts: [
          { label: "Guests added", count: guests.targets.length },
          {
            label: "Guest notifications scheduled",
            count: guests.notificationTargets.length,
          },
        ],
        exclusions: exclusionCounts(guests.exclusions),
        dateTime: null,
        contentPreviews: [
          ...guests.targets.map((target, index) => ({
            label: `Guest ${index + 1}`,
            content: JSON.stringify(target),
          })),
          ...guests.notificationTargets.map((notification, index) => ({
            label: `Guest notification ${index + 1}`,
            content: JSON.stringify(notification),
          })),
        ],
        beforeAfter: [],
      },
      {
        stepId: sendStep.id,
        title: sendStep.disclosure?.title ?? "",
        effectKind: "communication",
        reversibility: "irreversible",
        resolvedTargets: persistedTargets(sendStep),
        counts: [
          {
            label: "Invitation emails sent",
            count: communication.audience.recipients.length,
          },
        ],
        exclusions: communication.audience.exclusions,
        dateTime: null,
        contentPreviews: communication.audience.recipients.flatMap(
          (recipient) => [
            {
              label: `${recipient.label} recipient`,
              content: JSON.stringify({
                personId: recipient.personId,
                label: recipient.label,
                email: recipient.email,
              }),
            },
            {
              label: `${recipient.label} subject`,
              content: recipient.subject,
            },
            {
              label: `${recipient.label} message`,
              content: recipient.bodyText,
            },
          ]
        ),
        beforeAfter: [
          {
            label: "Invitation delivery",
            before: "Not sent",
            after: "Sent immediately",
            count: communication.audience.recipients.length,
          },
        ],
      },
    ],
    consequences: input.document.steps.flatMap(
      (step) => step.disclosure?.consequences ?? []
    ),
  });
}

export const MEETING_INVITATION_ARTIFACT_REVIEW: EvryArtifactReviewRegistration =
  defineEvryArtifactReview({
    source: {
      kind: "recipe",
      identity: MEETING_INVITATION_RECIPE_IDENTITY,
      registry: MEETING_INVITATION_RECIPE_REGISTRY,
    },
    build: buildMeetingInvitationConfirmation,
  });

export const MEETING_INVITATION_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry([MEETING_INVITATION_ARTIFACT_REVIEW]);

/** Revalidate the whole pre-create recipe against its planned future meeting. */
export async function meetingInvitationPlanTargetsAreCurrent(input: {
  actor: EvryPlantActor;
  plan: { document: unknown };
  checkedAt: Date;
}): Promise<boolean> {
  try {
    const document = parseStoredEvryActionPlan({
      document: input.plan.document,
      registry:
        MEETING_INVITATION_RECIPE_REGISTRY.executionRegistry.planRegistry,
    });
    if (document.recipe?.identity !== MEETING_INVITATION_RECIPE_IDENTITY) {
      return false;
    }
    const definition = MEETING_INVITATION_RECIPE_REGISTRY.registrationFor(
      MEETING_INVITATION_RECIPE_IDENTITY
    );
    if (
      !definition ||
      !storedDocumentMatchesEvryRecipe({ definition, document })
    ) {
      return false;
    }
    const [createStep, guestStep, sendStep] = document.steps;
    if (!createStep || !guestStep || !sendStep || document.steps.length !== 3) {
      return false;
    }
    if (
      !(await meetingsPlanTargetIsCurrent({
        ...input,
        step: createStep,
      })) ||
      !(await meetingsPlanTargetIsCurrent({
        ...input,
        step: guestStep,
      }))
    ) {
      return false;
    }
    const meeting = MEETINGS_EFFECT_ARGUMENT_SCHEMAS.createMeetingAction.parse(
      createStep.arguments
    );
    const communication = COMMUNICATION_MESSAGE_SEND_ARGUMENT_SCHEMA.parse(
      sendStep.arguments
    );
    if (
      communication.recipientSource.kind !== "people" ||
      communication.audience.meetingId !== meeting.meetingId
    ) {
      return false;
    }
    const currentAudience = await resolveEvryCommunicationAudience({
      churchId: input.actor.plantId,
      recipientIds: communication.recipientSource.recipientIds,
      subject: communication.audience.subject,
      body: communication.audience.body,
      channel: "email",
      templateId: communication.audience.templateId,
      meetingId: meeting.meetingId,
      plannedMeeting: {
        id: meeting.meetingId,
        title: meeting.title,
        type: meeting.type,
        datetime: new Date(meeting.datetime),
        locationName: meeting.locationName,
        locationAddress: meeting.locationAddress,
        agenda: meeting.agenda,
      },
    });
    return (
      currentAudience !== null &&
      JSON.stringify(currentAudience) === JSON.stringify(communication.audience)
    );
  } catch {
    return false;
  }
}

export type MeetingInvitationReferenceResolverDependencies = Readonly<{
  resolveDateTime(request: unknown): Promise<EvryDateTimeResolution>;
  loadFacts(
    actor: EvryPlantActor
  ): Promise<MeetingInvitationReferenceFacts | null>;
}>;

function personLabel(
  person: Pick<MeetingInvitationPersonFact, "firstName" | "lastName">
) {
  return (
    [person.firstName, person.lastName].filter(Boolean).join(" ") || "Person"
  );
}

function missing(entityType: string, prompt: string) {
  return Object.freeze({
    kind: "clarification" as const,
    artifact: Object.freeze({
      kind: "clarification" as const,
      mode: "missing" as const,
      entityType,
      prompt,
    }),
  });
}

function churchAddress(facts: MeetingInvitationReferenceFacts) {
  const { church } = facts;
  if (!church.streetAddress?.trim()) return null;
  return [church.streetAddress, church.city, church.stateRegion, church.country]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(", ");
}

function resolveLocation(
  facts: MeetingInvitationReferenceFacts,
  requestedId: string | undefined,
  requestedQuery: string | undefined
): MeetingInvitationLocation | MeetingInvitationReferenceResolution {
  if (requestedId && requestedQuery) return { kind: "unavailable" };
  if (requestedId) {
    return (
      facts.locations.find(({ id }) => id === requestedId) ?? {
        kind: "unavailable" as const,
      }
    );
  }

  if (requestedQuery) {
    const query = requestedQuery.normalize("NFKC").trim().toLowerCase();
    const matches = facts.locations.filter(
      ({ name, address }) =>
        name.normalize("NFKC").trim().toLowerCase() === query ||
        address.normalize("NFKC").trim().toLowerCase() === query
    );
    if (matches.length === 1) return matches[0]!;
    return missing(
      "meeting_location",
      "Reply with one exact location name or address from Meetings."
    );
  }

  const profileAddress = churchAddress(facts);
  if (profileAddress) {
    return Object.freeze({
      id: null,
      name: `${facts.church.name} church location`,
      address: profileAddress,
    });
  }
  if (facts.locations.length === 0) {
    return missing(
      "meeting_location",
      "Which exact church location should Evry use for this meeting?"
    );
  }
  if (facts.locations.length === 1) return facts.locations[0]!;
  if (facts.locations.length > 8) {
    return missing(
      "meeting_location",
      "There are more than eight active locations. Reply with one exact location name or address from Meetings."
    );
  }

  return Object.freeze({
    kind: "clarification" as const,
    artifact: Object.freeze({
      kind: "clarification" as const,
      mode: "choice" as const,
      entityType: "meeting_location",
      prompt: "Which exact church location should Evry use?",
      choices: facts.locations.map(locationChoice) as [
        ReturnType<typeof locationChoice>,
        ReturnType<typeof locationChoice>,
        ...ReturnType<typeof locationChoice>[],
      ],
      defaultChoiceId: null,
    }),
  });
}

function locationChoice(location: MeetingInvitationLocation) {
  return Object.freeze({
    entityType: "meeting_location",
    id: location.id!,
    label: location.name,
    distinguishingFacts: Object.freeze([
      Object.freeze({ label: "Address", value: location.address }),
    ]),
    sourceLink: trustedEvryApplicationSourceLink({
      label: `Open ${location.name}`,
      href: "/meetings",
    }),
  });
}

function resolveAudience(facts: MeetingInvitationReferenceFacts) {
  const eligible = facts.people
    .filter(
      (person) =>
        CORE_TEAM_STATUSES.has(person.status) || person.status === "prospect"
    )
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const guests: MeetingInvitationGuest[] = [];
  const exclusions: MeetingInvitationExclusion[] = [];
  const emails = new Set<string>();

  for (const person of eligible) {
    const label = personLabel(person);
    if (person.status === "prospect" && person.attendedVisionMeeting) {
      exclusions.push({
        personId: person.id,
        label,
        reason: "Prior Vision Meeting attendance",
      });
      continue;
    }
    if (!person.email?.trim()) {
      exclusions.push({
        personId: person.id,
        label,
        reason: "Missing email address",
      });
      continue;
    }
    const email = normalizeEmailAddress(person.email);
    if (facts.suppressedEmails.has(email)) {
      exclusions.push({
        personId: person.id,
        label,
        reason: "Suppressed email address",
      });
      continue;
    }
    if (emails.has(email)) {
      exclusions.push({
        personId: person.id,
        label,
        reason: "Duplicate email address",
      });
      continue;
    }
    emails.add(email);
    guests.push(
      Object.freeze({
        personId: person.id,
        label,
        email,
        expectedPersonUpdatedAt: person.expectedUpdatedAt,
      })
    );
  }
  return Object.freeze({
    guests: Object.freeze(guests),
    exclusions: Object.freeze(exclusions),
  });
}

export function createMeetingInvitationReferenceResolver(
  dependencies: MeetingInvitationReferenceResolverDependencies
) {
  return async function resolve(input: {
    actor: EvryPlantActor;
    request: MeetingInvitationReferenceRequest;
  }): Promise<MeetingInvitationReferenceResolution> {
    if (!input.request.durationMinutes) {
      return missing(
        "meeting_duration",
        "How many minutes should the Vision Meeting last?"
      );
    }
    if (
      !Number.isInteger(input.request.durationMinutes) ||
      input.request.durationMinutes < 1 ||
      input.request.durationMinutes > 1_440
    ) {
      return { kind: "unavailable" };
    }
    const dateTime = await dependencies.resolveDateTime({
      capabilityIdentity: MEETING_INVITATION_CAPABILITY_IDENTITY,
      sourceText: input.request.sourceText,
    });
    if (dateTime.status === "clarification") {
      return missing("meeting_datetime", dateTime.prompt);
    }
    if (dateTime.status !== "resolved") return { kind: "unavailable" };

    const facts = await dependencies.loadFacts(input.actor);
    if (!facts || facts.church.id !== input.actor.plantId) {
      return { kind: "unavailable" };
    }
    const location = resolveLocation(
      facts,
      input.request.locationId,
      input.request.locationQuery
    );
    if ("kind" in location) return location;
    const audience = resolveAudience(facts);
    if (audience.guests.length === 0) return { kind: "unavailable" };

    return Object.freeze({
      kind: "resolved" as const,
      meetingType: "vision_meeting" as const,
      dateTime: dateTime.dateTime,
      durationMinutes: input.request.durationMinutes,
      location,
      ...audience,
      subject: input.request.subject,
      body: input.request.body,
    });
  };
}

async function loadProductionFacts(
  actor: EvryPlantActor
): Promise<MeetingInvitationReferenceFacts | null> {
  const [[church], locationRows, peopleRows, priorRows] = await Promise.all([
    db
      .select({
        id: churches.id,
        name: churches.name,
        streetAddress: churches.streetAddress,
        city: churches.city,
        stateRegion: churches.stateRegion,
        country: churches.country,
      })
      .from(churches)
      .where(eq(churches.id, actor.plantId))
      .limit(1),
    db
      .select({
        id: locations.id,
        name: locations.name,
        address: locations.address,
      })
      .from(locations)
      .where(
        and(eq(locations.churchId, actor.plantId), eq(locations.isActive, true))
      ),
    db
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
        email: persons.email,
        status: persons.status,
        expectedUpdatedAt: persons.updatedAt,
      })
      .from(persons)
      .where(
        and(
          eq(persons.churchId, actor.plantId),
          inArray(persons.status, [
            "prospect",
            "core_group",
            "launch_team",
            "leader",
          ]),
          isNull(persons.deletedAt)
        )
      ),
    db
      .select({ personId: meetingAttendance.personId })
      .from(meetingAttendance)
      .innerJoin(
        churchMeetings,
        and(
          eq(churchMeetings.id, meetingAttendance.meetingId),
          eq(churchMeetings.churchId, meetingAttendance.churchId)
        )
      )
      .where(
        and(
          eq(meetingAttendance.churchId, actor.plantId),
          eq(meetingAttendance.status, "attended"),
          eq(churchMeetings.type, "vision_meeting")
        )
      ),
  ]);
  if (!church) return null;
  const prior = new Set(priorRows.map(({ personId }) => personId));
  const addresses = peopleRows.flatMap(({ email }) => (email ? [email] : []));
  return Object.freeze({
    church,
    locations: Object.freeze(locationRows),
    people: Object.freeze(
      peopleRows.map((person) =>
        Object.freeze({
          ...person,
          expectedUpdatedAt: person.expectedUpdatedAt.toISOString(),
          attendedVisionMeeting: prior.has(person.id),
        })
      )
    ),
    suppressedEmails: new Set(await loadSuppressedAddresses(addresses)),
  });
}

const productionReferenceResolver = createMeetingInvitationReferenceResolver({
  resolveDateTime: resolveEvryPlantDateTimeRequest,
  loadFacts: loadProductionFacts,
});

export type AuthorizedMeetingInvitationResolution =
  | MeetingInvitationReferenceResolution
  | Readonly<{
      kind: "planned";
      snapshot: MeetingInvitationPlanSnapshot;
    }>;

/**
 * Production fact lookup is reachable only through a freshly authorized,
 * inventory-backed People read. The compiler obtains the same authorization
 * again immediately before it resolves and fingerprints the persisted plan.
 */
export async function resolveAuthorizedMeetingInvitationRequest(input: {
  authorization: EvryReadCapabilityAuthorization;
  request: MeetingInvitationReferenceRequest;
  requestKey: EvryPlanRequestKey;
  now: Date;
}): Promise<AuthorizedMeetingInvitationResolution> {
  if (
    input.authorization.registration.identity !==
    EVRY_PEOPLE_READ_PROBE_IDENTITY
  ) {
    return { kind: "unavailable" };
  }
  const resolved = await productionReferenceResolver({
    actor: input.authorization.actor,
    request: input.request,
  });
  if (resolved.kind !== "resolved") return resolved;
  const snapshot = await resolveMeetingInvitationPlan({
    actor: input.authorization.actor,
    resolved,
    requestKey: input.requestKey,
    now: input.now,
  });
  return snapshot
    ? Object.freeze({ kind: "planned" as const, snapshot })
    : { kind: "unavailable" };
}

export function meetingInvitationPlanResolverRegistration(
  input: {
    resolveAuthorized?: typeof resolveAuthorizedMeetingInvitationRequest;
  } = {}
): EvryRecipeResolverRegistration {
  const resolveAuthorized =
    input.resolveAuthorized ?? resolveAuthorizedMeetingInvitationRequest;
  return defineEvryRecipeResolver({
    identity: MEETING_INVITATION_PLAN_RESOLVER_IDENTITY,
    readCapabilityIdentity: EVRY_PEOPLE_READ_PROBE_IDENTITY,
    async resolve({ authorization, rawValue }) {
      const parsed =
        MEETING_INVITATION_PLAN_RESOLVER_INPUT_SCHEMA.parse(rawValue);
      const result = await resolveAuthorized({
        authorization,
        request: parsed.request,
        requestKey: parsed.requestKey as EvryPlanRequestKey,
        now: new Date(parsed.now),
      });
      return result.kind === "planned" ? result.snapshot : null;
    },
  });
}
