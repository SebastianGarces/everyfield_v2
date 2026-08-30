import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans";
import type { EvryDateTimeResolution } from "@/lib/evry/resolvers/datetime";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { compileEvryRecipe } from "./compiler";

import {
  buildMeetingInvitationConfirmation,
  createMeetingInvitationPlanResolver,
  createMeetingInvitationReferenceResolver,
  MEETING_INVITATION_RECIPE_IDENTITY,
  MEETING_INVITATION_RECIPE_REGISTRY,
  type MeetingInvitationReferenceFacts,
  type MeetingInvitationReferenceRequest,
} from "./meeting-invitation";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;

const DATE_TIME = {
  calendarDate: "2026-08-05",
  localTime: "10:00 AM",
  timeZone: "America/New_York",
  utcOffset: "-04:00",
  instantUtc: "2026-08-05T14:00:00.000Z",
  interpretation: {
    basis: "explicit-calendar-date",
    sourceText: "August 5, 2026 at 10 AM",
    statedCalendarDate: "2026-08-05",
  },
};

const BASE_REQUEST: MeetingInvitationReferenceRequest = {
  sourceText: "August 5, 2026 at 10 AM",
  durationMinutes: 90,
  subject: "You're invited to Vision Meeting",
  body: "Join us for Vision Meeting.",
};

const PEOPLE = [
  person(
    "00000000-0000-4000-8000-000000000001",
    "Alex",
    "core_group",
    "ALEX@example.test"
  ),
  person(
    "00000000-0000-4000-8000-000000000002",
    "Beth",
    "launch_team",
    "beth@example.test"
  ),
  person("00000000-0000-4000-8000-000000000003", "Cam", "leader", null),
  person(
    "00000000-0000-4000-8000-000000000004",
    "Drew",
    "prospect",
    "drew@example.test"
  ),
  person(
    "00000000-0000-4000-8000-000000000005",
    "Eli",
    "prospect",
    "eli@example.test",
    true
  ),
  person(
    "00000000-0000-4000-8000-000000000006",
    "Fran",
    "prospect",
    "alex@example.test"
  ),
  person(
    "00000000-0000-4000-8000-000000000007",
    "Gray",
    "prospect",
    "gray@example.test"
  ),
  person(
    "00000000-0000-4000-8000-000000000008",
    "Hope",
    "attendee",
    "hope@example.test"
  ),
];

function person(
  id: string,
  firstName: string,
  status: string,
  email: string | null,
  attendedVisionMeeting = false
) {
  return {
    id,
    firstName,
    lastName: "Person",
    email,
    status,
    attendedVisionMeeting,
    expectedUpdatedAt: "2026-08-01T12:00:00.000Z",
  };
}

function facts(
  overrides: Partial<MeetingInvitationReferenceFacts> = {}
): MeetingInvitationReferenceFacts {
  return {
    church: {
      id: ACTOR.plantId,
      name: "Riverside",
      streetAddress: "144 Oak Street",
      city: "Albany",
      stateRegion: "NY",
      country: "USA",
    },
    locations: [],
    people: PEOPLE,
    suppressedEmails: new Set(["gray@example.test"]),
    ...overrides,
  };
}

function resolver(input: {
  facts?: MeetingInvitationReferenceFacts | null;
  dateTime?: EvryDateTimeResolution;
}) {
  let factReads = 0;
  const resolve = createMeetingInvitationReferenceResolver({
    async resolveDateTime() {
      return (input.dateTime ?? {
        status: "resolved",
        dateTime: DATE_TIME,
      }) as unknown as EvryDateTimeResolution;
    },
    async loadFacts() {
      factReads += 1;
      return input.facts === undefined ? facts() : input.facts;
    },
  });
  return { resolve, factReads: () => factReads };
}

test("the canonical audience combines core team with unvisited prospects and discloses exact exclusions", async () => {
  const { resolve } = resolver({});
  const result = await resolve({ actor: ACTOR, request: BASE_REQUEST });
  assert.equal(result.kind, "resolved");
  if (result.kind !== "resolved") return;

  assert.deepEqual(
    result.guests.map(({ label, email }) => ({ label, email })),
    [
      { label: "Alex Person", email: "alex@example.test" },
      { label: "Beth Person", email: "beth@example.test" },
      { label: "Drew Person", email: "drew@example.test" },
    ]
  );
  assert.deepEqual(
    result.exclusions.map(({ label, reason }) => ({ label, reason })),
    [
      { label: "Cam Person", reason: "Missing email address" },
      { label: "Eli Person", reason: "Prior Vision Meeting attendance" },
      { label: "Fran Person", reason: "Duplicate email address" },
      { label: "Gray Person", reason: "Suppressed email address" },
    ]
  );
  assert.deepEqual(result.location, {
    id: null,
    name: "Riverside church location",
    address: "144 Oak Street, Albany, NY, USA",
  });
  assert.equal(result.dateTime.timeZone, "America/New_York");

  const artifact = buildMeetingInvitationConfirmation({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: "40000000-0000-4000-8000-000000000001",
      fingerprint: "a".repeat(64),
    }),
    resolved: result,
  });
  assert.equal(artifact.actionLabel, "Create meeting and send 3");
  assert.deepEqual(
    artifact.steps.map(({ stepId }) => stepId),
    ["create-meeting", "add-guests", "send-invitations"]
  );
  assert.deepEqual(artifact.steps[0]?.dateTime, {
    startsAt: DATE_TIME,
    endsAt: {
      calendarDate: "2026-08-05",
      localTime: "11:30 AM",
      timeZone: "America/New_York",
      utcOffset: "-04:00",
      instantUtc: "2026-08-05T15:30:00.000Z",
      interpretation: {
        basis: "explicit-calendar-date",
        sourceText: "90 minutes after August 5, 2026 at 10 AM",
        statedCalendarDate: "2026-08-05",
      },
    },
  });
  assert.equal(artifact.steps[1]?.resolvedTargets.length, 3);
  assert.deepEqual(artifact.steps[1]?.exclusions, [
    { reason: "Missing email address", count: 1 },
    { reason: "Prior Vision Meeting attendance", count: 1 },
    { reason: "Duplicate email address", count: 1 },
    { reason: "Suppressed email address", count: 1 },
  ]);
  assert.deepEqual(artifact.steps[2]?.contentPreviews, [
    { label: "Subject", content: "You're invited to Vision Meeting" },
    { label: "Message", content: "Join us for Vision Meeting." },
  ]);
});

test("missing year and duration return focused clarifications before any fact read", async () => {
  const duration = resolver({});
  const noDuration = await duration.resolve({
    actor: ACTOR,
    request: { ...BASE_REQUEST, durationMinutes: undefined },
  });
  assert.deepEqual(noDuration, {
    kind: "clarification",
    artifact: {
      kind: "clarification",
      mode: "missing",
      entityType: "meeting duration",
      prompt: "How many minutes should the Vision Meeting last?",
    },
  });
  assert.equal(duration.factReads(), 0);

  const year = resolver({
    dateTime: {
      status: "clarification",
      reason: "missing-year",
      sourceText: "August 5 at 10 AM",
      prompt:
        "What absolute calendar date, including the year, should Evry use?",
    },
  });
  const noYear = await year.resolve({
    actor: ACTOR,
    request: { ...BASE_REQUEST, sourceText: "August 5 at 10 AM" },
  });
  assert.equal(noYear.kind, "clarification");
  if (noYear.kind === "clarification") {
    assert.equal(noYear.artifact.mode, "missing");
    assert.match(noYear.artifact.prompt, /including the year/);
  }
  assert.equal(year.factReads(), 0);
});

test("an ambiguous church location returns closed choices and zero resolved effects", async () => {
  const ambiguous = facts({
    church: { ...facts().church, streetAddress: null },
    locations: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        name: "North",
        address: "1 North St",
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        name: "South",
        address: "2 South St",
      },
    ],
  });
  const { resolve } = resolver({ facts: ambiguous });
  const result = await resolve({ actor: ACTOR, request: BASE_REQUEST });
  assert.equal(result.kind, "clarification");
  if (result.kind !== "clarification") return;
  assert.equal(result.artifact.mode, "choice");
  if (result.artifact.mode === "choice") {
    assert.deepEqual(
      result.artifact.choices.map(({ id, label }) => ({ id, label })),
      [
        { id: "30000000-0000-4000-8000-000000000001", label: "North" },
        { id: "30000000-0000-4000-8000-000000000002", label: "South" },
      ]
    );
    assert.equal(result.artifact.defaultChoiceId, null);
  }
});

test("a supplied location is exact and foreign or stale ids are neutral", async () => {
  const available = facts({
    church: { ...facts().church, streetAddress: null },
    locations: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        name: "North",
        address: "1 North St",
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        name: "South",
        address: "2 South St",
      },
    ],
  });
  const { resolve } = resolver({ facts: available });
  const exact = await resolve({
    actor: ACTOR,
    request: { ...BASE_REQUEST, locationId: available.locations[1]!.id! },
  });
  assert.equal(exact.kind, "resolved");
  if (exact.kind === "resolved") assert.equal(exact.location.name, "South");

  assert.deepEqual(
    await resolve({
      actor: ACTOR,
      request: {
        ...BASE_REQUEST,
        locationId: "30000000-0000-4000-8000-000000000099",
      },
    }),
    { kind: "unavailable" }
  );
});

test("the exact planner feeds the future meeting into Communication and refuses audience drift", async () => {
  const resolved = await resolver({}).resolve({
    actor: ACTOR,
    request: BASE_REQUEST,
  });
  assert.equal(resolved.kind, "resolved");
  if (resolved.kind !== "resolved") return;

  const audienceInputs: unknown[] = [];
  const plan = createMeetingInvitationPlanResolver({
    resolveMeeting: async () =>
      ({
        exportName: "createMeetingAction",
        arguments: {
          meetingId: "50000000-0000-4000-8000-000000000001",
          type: "vision_meeting",
          title: "Vision Meeting #1",
          datetime: "2026-08-05T10:00:00.000Z",
          timezone: "America/New_York",
          status: "planning",
          locationId: "60000000-0000-4000-8000-000000000001",
          locationName: "Riverside church location",
          locationAddress: "144 Oak Street, Albany, NY, USA",
          agenda: [],
          savedLocationId: null,
          teamId: null,
          meetingSubtype: null,
          estimatedAttendance: 3,
          actualAttendance: null,
          durationMinutes: 90,
          notes: null,
          meetingNumber: 1,
          checklistItems: [],
          resolvedTeamMemberIds: [],
          attendanceRows: [],
          notificationBaseline: {
            coreGroupUserIds: [],
            reminderUserIds: [],
            activeNotifications: [],
          },
          notificationTargets: [],
          expectedMeetingAbsent: true,
          createdById: ACTOR.userId,
        },
      }) as never,
    resolveGuests: async (input) => ({
      mode: "batch-after-create",
      meetingId: input.create.meetingId,
      dependencyStepId: input.dependencyStepId,
      targets: [...input.targets],
      expectedCoreGroupUserIds: [],
      expectedReminderUserIds: [],
      notificationTargets: [],
    }),
    resolveAudience: async (input) => {
      audienceInputs.push(input);
      return {
        subject: BASE_REQUEST.subject,
        body: BASE_REQUEST.body,
        bodyHtml: `<p>${BASE_REQUEST.body}</p>`,
        channel: "email",
        templateId: null,
        meetingId: "50000000-0000-4000-8000-000000000001",
        messageClass: "transactional_meeting",
        recipients: resolved.guests.map((guest) => ({
          personId: guest.personId,
          label: guest.label,
          email: guest.email,
          subject: BASE_REQUEST.subject,
          bodyHtml: `<p>${BASE_REQUEST.body}</p>`,
          bodyText: BASE_REQUEST.body,
        })),
        exclusions: [],
      };
    },
  });
  const snapshot = await plan({
    actor: ACTOR,
    resolved,
    requestKey: mintEvryPlanRequestKey(),
    now: new Date("2026-08-01T12:00:00.000Z"),
  });
  assert.ok(snapshot);
  assert.equal(snapshot.guests.targets.length, 3);
  assert.deepEqual(
    snapshot.communication.recipientSource.recipientIds,
    resolved.guests.map(({ personId }) => personId)
  );
  assert.equal(
    (audienceInputs[0] as { plannedMeeting: { id: string } }).plannedMeeting.id,
    snapshot.guests.meetingId
  );
  const compiled = await compileEvryRecipe({
    actor: ACTOR,
    registry: MEETING_INVITATION_RECIPE_REGISTRY,
    recipeIdentity: MEETING_INVITATION_RECIPE_IDENTITY,
    inputValues: snapshot,
    eligibleCapabilities: [
      { identity: "meetings.create" },
      { identity: "meetings.add-guests" },
      { identity: "communication.messages.send" },
    ],
  });
  assert.deepEqual(
    compiled.document.steps.map(({ id, dependsOn }) => [id, dependsOn]),
    [
      ["create-meeting", []],
      ["add-guests", ["create-meeting"]],
      ["send-invitations", ["add-guests"]],
    ]
  );
  assert.deepEqual(
    compiled.document.steps[1]?.arguments.targets,
    snapshot.guests.targets
  );

  const drifted = createMeetingInvitationPlanResolver({
    resolveMeeting: async () =>
      ({
        exportName: "createMeetingAction",
        arguments: snapshot.meeting,
      }) as never,
    resolveGuests: async () => snapshot.guests,
    resolveAudience: async () => ({
      ...snapshot.communication.audience,
      recipients: snapshot.communication.audience.recipients.slice(1),
    }),
  });
  assert.equal(
    await drifted({
      actor: ACTOR,
      resolved,
      requestKey: mintEvryPlanRequestKey(),
      now: new Date("2026-08-01T12:00:00.000Z"),
    }),
    null
  );
});
