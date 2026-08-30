import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  locations,
  meetingAttendance,
  persons,
} from "@/db/schema";
import { toCalendarDate, utcOffsetForZonedTime } from "@/lib/datetime";
import {
  buildEvryConfirmationArtifact,
  type EvryDetailedConfirmationArtifactDocument,
} from "@/lib/evry/artifacts/review";
import {
  trustedEvryApplicationSourceLink,
  type EvryConfirmationDateTimeDocument,
} from "@/lib/evry/artifacts/types";
import type { EvryClarificationArtifact } from "@/lib/evry/artifacts/types";
import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
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

const CORE_TEAM_STATUSES = new Set(["core_group", "launch_team", "leader"]);

export type MeetingInvitationReferenceRequest = Readonly<{
  sourceText: string;
  durationMinutes?: number;
  locationId?: string;
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

function localTimeAt(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

function endDateTime(
  start: EvryResolvedPlantDateTime,
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

function exclusionCounts(exclusions: readonly MeetingInvitationExclusion[]) {
  const counts = new Map<string, number>();
  for (const { reason } of exclusions) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, count]) => ({ reason, count }));
}

/** Build the one review artifact solely from the exact resolved recipe data. */
export function buildMeetingInvitationConfirmation(input: {
  plan: EvryConversationPlanIdentity;
  resolved: ResolvedMeetingInvitationReference;
}): EvryDetailedConfirmationArtifactDocument {
  const { resolved } = input;
  const exclusions = exclusionCounts(resolved.exclusions);
  const guestTargets = resolved.guests.map((guest) => ({
    label: "Guest",
    value: `${guest.label} · ${guest.email}`,
    sourceLink: trustedEvryApplicationSourceLink({
      label: `Open ${guest.label}`,
      href: `/people/${guest.personId}`,
    }),
  }));
  return buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: input.plan,
    title: "Create Vision Meeting and send invitations",
    actionLabel: `Create meeting and send ${resolved.guests.length}`,
    steps: [
      {
        stepId: "create-meeting",
        title: "Create Vision Meeting",
        effectKind: "meeting",
        reversibility: "reversible",
        resolvedTargets: [
          { label: "Meeting", value: "Vision Meeting", sourceLink: null },
          {
            label: "Location",
            value: `${resolved.location.name} · ${resolved.location.address}`,
            sourceLink: null,
          },
        ],
        counts: [{ label: "Meetings created", count: 1 }],
        exclusions: [],
        dateTime: {
          startsAt: {
            calendarDate: resolved.dateTime.calendarDate,
            localTime: resolved.dateTime.localTime,
            timeZone: resolved.dateTime.timeZone,
            utcOffset: resolved.dateTime.utcOffset,
            instantUtc: resolved.dateTime.instantUtc,
            interpretation: { ...resolved.dateTime.interpretation },
          },
          endsAt: endDateTime(resolved.dateTime, resolved.durationMinutes),
        },
        contentPreviews: [],
        beforeAfter: [],
      },
      {
        stepId: "add-guests",
        title: "Add resolved guests",
        effectKind: "other",
        reversibility: "reversible",
        resolvedTargets: guestTargets,
        counts: [{ label: "Guests added", count: resolved.guests.length }],
        exclusions,
        dateTime: null,
        contentPreviews: [],
        beforeAfter: [],
      },
      {
        stepId: "send-invitations",
        title: "Send the invitation",
        effectKind: "communication",
        reversibility: "irreversible",
        resolvedTargets: guestTargets.map(({ value, sourceLink }) => ({
          label: "Recipient",
          value,
          sourceLink,
        })),
        counts: [{ label: "Emails sent", count: resolved.guests.length }],
        exclusions,
        dateTime: null,
        contentPreviews: [
          { label: "Subject", content: resolved.subject },
          { label: "Message", content: resolved.body },
        ],
        beforeAfter: [
          {
            label: "Invitation delivery",
            before: "Not sent",
            after: "Sent immediately",
            count: resolved.guests.length,
          },
        ],
      },
    ],
    consequences: [
      "Creates one Vision Meeting in the plant calendar.",
      `Adds ${resolved.guests.length} guests to the meeting.`,
      `Sends ${resolved.guests.length} invitation emails immediately.`,
    ],
  });
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
  requestedId: string | undefined
): MeetingInvitationLocation | MeetingInvitationReferenceResolution {
  if (requestedId) {
    return (
      facts.locations.find(({ id }) => id === requestedId) ?? {
        kind: "unavailable" as const,
      }
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
      "meeting location",
      "Which exact church location should Evry use for this meeting?"
    );
  }
  if (facts.locations.length === 1) return facts.locations[0]!;

  return Object.freeze({
    kind: "clarification" as const,
    artifact: Object.freeze({
      kind: "clarification" as const,
      mode: "choice" as const,
      entityType: "meeting location",
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
    entityType: "meeting location",
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
    guests.push(Object.freeze({ personId: person.id, label, email }));
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
        "meeting duration",
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
      return missing("meeting date and time", dateTime.prompt);
    }
    if (dateTime.status !== "resolved") return { kind: "unavailable" };

    const facts = await dependencies.loadFacts(input.actor);
    if (!facts || facts.church.id !== input.actor.plantId) {
      return { kind: "unavailable" };
    }
    const location = resolveLocation(facts, input.request.locationId);
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
          attendedVisionMeeting: prior.has(person.id),
        })
      )
    ),
    suppressedEmails: new Set(await loadSuppressedAddresses(addresses)),
  });
}

export const resolveMeetingInvitationReference =
  createMeetingInvitationReferenceResolver({
    resolveDateTime: resolveEvryPlantDateTimeRequest,
    loadFacts: loadProductionFacts,
  });
