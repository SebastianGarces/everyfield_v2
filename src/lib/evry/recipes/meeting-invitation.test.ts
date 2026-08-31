import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans";
import type { EvryDateTimeResolution } from "@/lib/evry/resolvers/datetime";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  createEvryRecipeCompiler,
  EvryRecipeCompilationError,
} from "./compiler";

import {
  buildMeetingInvitationConfirmation,
  createMeetingInvitationPlanResolver,
  createMeetingInvitationRecipeRegistry,
  createMeetingInvitationReferenceResolver,
  meetingInvitationPlanResolverRegistration,
  MEETING_INVITATION_PLAN_SNAPSHOT_SCHEMA,
  MEETING_INVITATION_RECIPE_IDENTITY,
  MEETING_INVITATION_REVIEW_REGISTRY,
  type MeetingInvitationReferenceFacts,
  type MeetingInvitationReferenceRequest,
} from "./meeting-invitation";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { storedEvryClarificationArtifactDocument } from "@/lib/evry/conversations/artifacts";
import {
  createMeetingInvitationConversationContinuation,
  meetingInvitationRequestForConversation,
} from "./meeting-invitation-conversation";
import { selectMeetingInvitationReferenceRequest } from "./meeting-invitation-selection";

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

const FRD_REQUEST =
  "Create a meeting for August 5 at 10 AM at the church location. Invite the core team and add prospects who have not visited a Vision Meeting. Draft an email invitation and send it to them.";

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

test("the canonical FRD request enters the ordinary recipe continuation and asks only for missing duration", async () => {
  assert.deepEqual(selectMeetingInvitationReferenceRequest(FRD_REQUEST), {
    sourceText: "August 5 at 10 AM",
    durationMinutes: undefined,
    subject: "You're invited to Vision Meeting",
    body: "Hi {{first_name}},\n\nJoin us for Vision Meeting at our church location. We look forward to seeing you.",
  });
  let createCalls = 0;
  const continuation = createMeetingInvitationConversationContinuation({
    async findPlan() {
      return null;
    },
    async authorizeRead() {
      return {
        actor: ACTOR,
        registration: {
          identity: "people.crm.people.load-more-people",
        },
      } as unknown as EvryReadCapabilityAuthorization;
    },
    async resolveAuthorized() {
      return {
        kind: "clarification" as const,
        artifact: {
          kind: "clarification" as const,
          mode: "missing" as const,
          entityType: "meeting_duration",
          prompt: "How many minutes should the Vision Meeting last?",
        },
      };
    },
    async createPlan() {
      createCalls++;
      throw new Error("clarification must not persist a plan");
    },
  } as never);
  const result = await continuation.continue({
    actor: ACTOR,
    conversation: {
      id: "30000000-0000-4000-8000-000000000001",
    } as never,
    userRequestKey: "canonical-frd-request",
    literalUserText: FRD_REQUEST,
    pageContext: null,
    requestPageContext: null,
    now: new Date("2026-08-30T12:00:00.000Z"),
  });
  assert.equal(
    result?.body,
    "How many minutes should the Vision Meeting last?"
  );
  assert.equal(result?.artifacts[0]?.kind, "clarification");
  assert.equal(createCalls, 0);
});

test("ordinary recipe continuation denies missing and stale read sessions before resolution", async (t) => {
  for (const mode of ["denied", "stale"] as const) {
    await t.test(mode, async () => {
      let resolutionCalls = 0;
      const continuation = createMeetingInvitationConversationContinuation({
        async findPlan() {
          return null;
        },
        async authorizeRead() {
          if (mode === "denied") return null;
          return {
            actor: {
              ...ACTOR,
              plantId: "20000000-0000-4000-8000-000000000099",
            },
            registration: {
              identity: "people.crm.people.load-more-people",
            },
          } as unknown as EvryReadCapabilityAuthorization;
        },
        async resolveAuthorized() {
          resolutionCalls++;
          return { kind: "unavailable" as const };
        },
        async createPlan() {
          throw new Error("denied continuation must not persist");
        },
      } as never);
      assert.equal(
        await continuation.continue({
          actor: ACTOR,
          conversation: {
            id: "30000000-0000-4000-8000-000000000001",
          } as never,
          userRequestKey: `canonical-${mode}`,
          literalUserText: FRD_REQUEST,
          pageContext: null,
          requestPageContext: null,
          now: new Date("2026-08-30T12:00:00.000Z"),
        }),
        null
      );
      assert.equal(resolutionCalls, 0);
    });
  }
});

test("focused duration and year replies continue the original immutable recipe request", () => {
  const request = meetingInvitationRequestForConversation({
    actor: ACTOR,
    conversation: {
      activePlan: null,
      messages: [
        { author: "user", body: FRD_REQUEST, artifacts: [] },
        {
          author: "assistant",
          body: "How long?",
          artifacts: [
            {
              artifact: {
                kind: "clarification",
                mode: "missing",
                entityType: "meeting_duration",
                prompt: "How many minutes?",
              },
            },
          ],
        },
        { author: "user", body: "90 minutes", artifacts: [] },
        {
          author: "assistant",
          body: "Which year?",
          artifacts: [
            {
              artifact: {
                kind: "clarification",
                mode: "missing",
                entityType: "meeting_datetime",
                prompt: "Which year?",
              },
            },
          ],
        },
        { author: "user", body: "2027", artifacts: [] },
      ],
    } as never,
    userRequestKey: "year-answer",
    literalUserText: "2027",
    pageContext: null,
    requestPageContext: null,
    now: new Date("2026-08-30T12:00:00.000Z"),
  });
  assert.equal(request?.durationMinutes, 90);
  assert.equal(request?.sourceText, "August 5, 2027 at 10 AM");
});

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
      entityType: "meeting_duration",
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

test("two maximum-length locations persist bounded durable choices", async () => {
  const northName = "N".repeat(255);
  const southName = "S".repeat(255);
  const northAddress = "A".repeat(500);
  const ambiguous = facts({
    church: { ...facts().church, streetAddress: null },
    locations: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        name: northName,
        address: northAddress,
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        name: southName,
        address: "2 South St",
      },
    ],
  });
  const { resolve } = resolver({ facts: ambiguous });
  const result = await resolve({ actor: ACTOR, request: BASE_REQUEST });
  assert.equal(result.kind, "clarification");
  if (result.kind !== "clarification") return;
  assert.equal(
    storedEvryClarificationArtifactDocument(result.artifact).kind,
    "clarification"
  );
  assert.equal(result.artifact.mode, "choice");
  if (result.artifact.mode === "choice") {
    assert.deepEqual(
      result.artifact.choices.map(({ id, label }) => ({ id, label })),
      [
        {
          id: "30000000-0000-4000-8000-000000000001",
          label: "Location 1",
        },
        {
          id: "30000000-0000-4000-8000-000000000002",
          label: "Location 2",
        },
      ]
    );
    assert.deepEqual(result.artifact.choices[0]?.distinguishingFacts, [
      { label: "Name", value: northName },
      { label: "Address", value: northAddress },
    ]);
    assert.equal(result.artifact.choices[0]?.sourceLink.label, "Open Meetings");
    assert.equal(result.artifact.defaultChoiceId, null);
  }
});

test("nine locations narrow an exact maximum-length name through ordinary continuation", async () => {
  const maxLocationName = "X".repeat(255);
  const locations = Array.from({ length: 9 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: index === 8 ? maxLocationName : `Location ${index + 1}`,
    address: `${index + 1} Main Street`,
  }));
  const manyLocations = resolver({
    facts: facts({
      church: {
        ...facts().church,
        streetAddress: null,
        city: null,
        stateRegion: null,
        country: null,
      },
      locations,
    }),
  }).resolve;
  assert.deepEqual(
    await manyLocations({ actor: ACTOR, request: BASE_REQUEST }),
    {
      kind: "clarification",
      artifact: {
        kind: "clarification",
        mode: "missing",
        entityType: "meeting_location",
        prompt:
          "There are more than eight active locations. Reply with one exact location name or address from Meetings.",
      },
    }
  );

  let selectedLocationId: string | null = null;
  const continuation = createMeetingInvitationConversationContinuation({
    async findPlan() {
      return null;
    },
    async authorizeRead() {
      return {
        actor: ACTOR,
        registration: {
          identity: "people.crm.people.load-more-people",
        },
      } as unknown as EvryReadCapabilityAuthorization;
    },
    async resolveAuthorized(input: {
      request: MeetingInvitationReferenceRequest;
    }) {
      const resolution = await manyLocations({
        actor: ACTOR,
        request: input.request,
      });
      if (resolution.kind === "resolved") {
        selectedLocationId = resolution.location.id;
        return { kind: "unavailable" as const };
      }
      return resolution;
    },
    async createPlan() {
      throw new Error("focused narrowing proof must not persist");
    },
  } as never);
  const requestText =
    "Create a meeting for August 5, 2026 at 10 AM at the church location, lasting 90 minutes. Invite the core team and add prospects who have not visited a Vision Meeting. Draft an email invitation and send it to them.";
  const first = await continuation.continue({
    actor: ACTOR,
    conversation: {
      id: "40000000-0000-4000-8000-000000000001",
      activePlan: null,
      messages: [],
    } as never,
    userRequestKey: "many-locations",
    literalUserText: requestText,
    pageContext: null,
    requestPageContext: null,
    now: new Date("2026-08-01T12:00:00.000Z"),
  });
  assert.equal(first?.artifacts[0]?.kind, "clarification");
  assert.equal(first?.artifacts[0]?.mode, "missing");
  const second = await continuation.continue({
    actor: ACTOR,
    conversation: {
      id: "40000000-0000-4000-8000-000000000001",
      activePlan: null,
      messages: [
        { author: "user", body: requestText, artifacts: [] },
        {
          author: "assistant",
          body: first?.body ?? "",
          artifacts: [{ artifact: first?.artifacts[0] }],
        },
        { author: "user", body: maxLocationName, artifacts: [] },
      ],
    } as never,
    userRequestKey: "location-nine",
    literalUserText: maxLocationName,
    pageContext: null,
    requestPageContext: null,
    now: new Date("2026-08-01T12:00:00.000Z"),
  });
  assert.equal(second, null);
  assert.equal(selectedLocationId, locations[8]!.id);
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

test("foreign-plant facts are neutral even when every record otherwise resolves", async () => {
  const { resolve } = resolver({
    facts: facts({
      church: {
        ...facts().church,
        id: "20000000-0000-4000-8000-000000000099",
      },
    }),
  });
  assert.deepEqual(await resolve({ actor: ACTOR, request: BASE_REQUEST }), {
    kind: "unavailable",
  });
});

test("the registered People resolver denies missing and stale-session authority before facts", async (t) => {
  for (const mode of ["denied", "stale-actor"] as const) {
    await t.test(mode, async () => {
      let resolverCalls = 0;
      const registry = createMeetingInvitationRecipeRegistry({
        planResolver: meetingInvitationPlanResolverRegistration({
          async resolveAuthorized() {
            resolverCalls++;
            throw new Error("resolution must not run");
          },
        }),
      });
      const compile = createEvryRecipeCompiler({
        async authorizeResolver() {
          if (mode === "denied") return null;
          return {
            actor: {
              ...ACTOR,
              userId: "10000000-0000-4000-8000-000000000099",
            },
            registration: {
              identity: "people.crm.people.load-more-people",
            },
          } as unknown as EvryReadCapabilityAuthorization;
        },
      });
      await assert.rejects(
        compile({
          actor: ACTOR,
          registry,
          recipeIdentity: MEETING_INVITATION_RECIPE_IDENTITY,
          inputValues: {
            plan: {
              request: BASE_REQUEST,
              requestKey: mintEvryPlanRequestKey(),
              now: "2026-08-01T12:00:00.000Z",
            },
          },
          eligibleCapabilities: [
            { identity: "meetings.create" },
            { identity: "meetings.add-guests" },
            { identity: "communication.messages.send" },
          ],
        }),
        EvryRecipeCompilationError
      );
      assert.equal(resolverCalls, 0);
    });
  }
});

test("the exact planner reviews the 100-recipient and 511-character-name boundary", async () => {
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
      exclusions: [...input.exclusions],
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
  assert.equal(snapshot.communication.recipientSource.kind, "people");
  if (snapshot.communication.recipientSource.kind === "people") {
    assert.deepEqual(
      snapshot.communication.recipientSource.recipientIds,
      resolved.guests.map(({ personId }) => personId)
    );
  }
  assert.equal(
    (audienceInputs[0] as { plannedMeeting: { id: string } }).plannedMeeting.id,
    snapshot.guests.meetingId
  );
  const registry = createMeetingInvitationRecipeRegistry({
    planResolver: meetingInvitationPlanResolverRegistration({
      async resolveAuthorized() {
        return { kind: "planned", snapshot };
      },
    }),
  });
  const compile = createEvryRecipeCompiler({
    async authorizeResolver() {
      return {
        actor: ACTOR,
        registration: {
          identity: "people.crm.people.load-more-people",
        },
      } as unknown as EvryReadCapabilityAuthorization;
    },
  });
  const compiled = await compile({
    actor: ACTOR,
    registry,
    recipeIdentity: MEETING_INVITATION_RECIPE_IDENTITY,
    inputValues: {
      plan: {
        request: BASE_REQUEST,
        requestKey: mintEvryPlanRequestKey(),
        now: "2026-08-01T12:00:00.000Z",
      },
    },
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
  const planIdentity = evryConversationPlanIdentitySchema.parse({
    planId: "40000000-0000-4000-8000-000000000001",
    fingerprint: "a".repeat(64),
  });
  const artifact = buildMeetingInvitationConfirmation({
    plan: planIdentity,
    document: compiled.document,
  });
  assert.equal(artifact.actionLabel, "Create meeting and send invitations");
  assert.deepEqual(artifact.steps[0]?.dateTime, {
    startsAt: {
      calendarDate: "2026-08-05",
      localTime: "10:00 AM",
      timeZone: "America/New_York",
      utcOffset: "-04:00",
      instantUtc: "2026-08-05T14:00:00.000Z",
      interpretation: {
        basis: "explicit-calendar-date",
        sourceText: "2026-08-05 10:00 AM America/New_York",
        statedCalendarDate: "2026-08-05",
      },
    },
    endsAt: {
      calendarDate: "2026-08-05",
      localTime: "11:30 AM",
      timeZone: "America/New_York",
      utcOffset: "-04:00",
      instantUtc: "2026-08-05T15:30:00.000Z",
      interpretation: {
        basis: "explicit-calendar-date",
        sourceText: "90 minutes after 2026-08-05 10:00 AM America/New_York",
        statedCalendarDate: "2026-08-05",
      },
    },
  });
  assert.deepEqual(
    artifact.steps.map(({ stepId }) => stepId),
    ["create-meeting", "add-guests", "send-invitations"]
  );
  assert.equal(artifact.steps[1]?.counts[0]?.count, 3);
  assert.deepEqual(artifact.steps[1]?.exclusions, [
    { reason: "Missing email address", count: 1 },
    { reason: "Prior Vision Meeting attendance", count: 1 },
    { reason: "Duplicate email address", count: 1 },
    { reason: "Suppressed email address", count: 1 },
  ]);
  assert.ok(
    trustedReviewForEvryPlanDocument({
      plan: planIdentity,
      document: compiled.document,
      reviewRegistry: MEETING_INVITATION_REVIEW_REGISTRY,
    })
  );

  const maxPersonLabel = `${"F".repeat(255)} ${"L".repeat(255)}`;
  const peopleBoundary = Array.from({ length: 100 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return {
      personId: `60000000-0000-4000-8000-${suffix}`,
      attendanceId: `70000000-0000-4000-8000-${suffix}`,
      label: index === 0 ? maxPersonLabel : `Person ${index + 1}`,
      email: `person-${index + 1}@example.test`,
    };
  });
  const boundarySnapshot = MEETING_INVITATION_PLAN_SNAPSHOT_SCHEMA.parse({
    meeting: { ...snapshot.meeting, estimatedAttendance: 100 },
    guests: {
      ...snapshot.guests,
      targets: peopleBoundary.map((person) => ({
        attendanceId: person.attendanceId,
        personId: person.personId,
        label: person.label,
        email: person.email,
        expectedPersonUpdatedAt: "2026-08-01T12:00:00.000Z",
        expectedAttendanceAbsent: true,
      })),
      exclusions: [],
      notificationTargets: [],
    },
    communication: {
      ...snapshot.communication,
      recipientSource: {
        kind: "people",
        recipientIds: peopleBoundary.map(({ personId }) => personId),
      },
      audience: {
        ...snapshot.communication.audience,
        recipients: peopleBoundary.map((person) => ({
          personId: person.personId,
          label: person.label,
          email: person.email,
          subject: BASE_REQUEST.subject,
          bodyHtml: `<p>${BASE_REQUEST.body}</p>`,
          bodyText: BASE_REQUEST.body,
        })),
      },
    },
  });
  const boundaryRegistry = createMeetingInvitationRecipeRegistry({
    planResolver: meetingInvitationPlanResolverRegistration({
      async resolveAuthorized() {
        return { kind: "planned", snapshot: boundarySnapshot };
      },
    }),
  });
  const boundaryCompiled = await compile({
    actor: ACTOR,
    registry: boundaryRegistry,
    recipeIdentity: MEETING_INVITATION_RECIPE_IDENTITY,
    inputValues: {
      plan: {
        request: BASE_REQUEST,
        requestKey: mintEvryPlanRequestKey(),
        now: "2026-08-01T12:00:00.000Z",
      },
    },
    eligibleCapabilities: [
      { identity: "meetings.create" },
      { identity: "meetings.add-guests" },
      { identity: "communication.messages.send" },
    ],
  });
  assert.equal(
    boundaryCompiled.document.steps.every((step) =>
      step.disclosure?.items.every(({ value }) => value.length <= 4_000)
    ),
    true
  );
  const boundaryArtifact = buildMeetingInvitationConfirmation({
    plan: planIdentity,
    document: boundaryCompiled.document,
  });
  assert.equal(boundaryArtifact.steps[1]?.counts[0]?.count, 100);
  assert.deepEqual(boundaryArtifact.steps[1]?.contentPreviews, []);
  assert.deepEqual(boundaryArtifact.steps[2]?.contentPreviews, [
    {
      label: "Subject",
      content: BASE_REQUEST.subject,
    },
    {
      label: "Message",
      content: BASE_REQUEST.body,
    },
  ]);
  assert.ok(
    trustedReviewForEvryPlanDocument({
      plan: planIdentity,
      document: boundaryCompiled.document,
      reviewRegistry: MEETING_INVITATION_REVIEW_REGISTRY,
    })
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
