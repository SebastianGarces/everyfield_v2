import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  hydrateStoredEvryConversationArtifact,
  storedEvryClarificationArtifactDocument,
  type StoredEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import {
  evryConversationIdSchema,
  evryConversationMessageIdSchema,
  evryConversationPlanIdentitySchema,
  evryConversationRequestKeySchema,
  initialEvryConversationState,
} from "@/lib/evry/conversations/contract";
import type {
  EvryStoredConversation,
  EvryStoredConversationArtifact,
  EvryStoredConversationMessage,
} from "@/lib/evry/conversations/repository";
import { trustedEvryApplicationSourceLink } from "@/lib/evry/artifacts/types";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryDateTimeResolution } from "@/lib/evry/resolvers/datetime";

import { meetingInvitationReuseDraft } from "./meeting-invitation-reuse";
import { selectMeetingInvitationReferenceRequest } from "./meeting-invitation-selection";
import { createMeetingInvitationConversationContinuation } from "./meeting-invitation-conversation";
import {
  createMeetingInvitationReferenceResolver,
  type MeetingInvitationReferenceFacts,
} from "./meeting-invitation";

const PLAN = evryConversationPlanIdentitySchema.parse({
  planId: "10000000-0000-4000-8000-000000000001",
  fingerprint: "a".repeat(64),
});
const NOW = new Date("2026-08-30T12:00:00.000Z");
const ACTOR = {
  userId: "60000000-0000-4000-8000-000000000001",
  plantId: "70000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;

const confirmation = buildEvryConfirmationArtifact({
  kind: "confirmation",
  artifactVersion: 1,
  plan: PLAN,
  title: "Create Vision Meeting and send invitations",
  actionLabel: "Create meeting and send invitations",
  steps: [
    {
      stepId: "create-meeting",
      title: "Create Vision Meeting",
      effectKind: "other",
      reversibility: "reversible",
      resolvedTargets: [
        { label: "Meeting", value: "Vision Meeting", sourceLink: null },
      ],
      counts: [{ label: "Meetings", count: 1 }],
      exclusions: [],
      dateTime: null,
      contentPreviews: [],
      beforeAfter: [],
    },
  ],
  consequences: ["Creates a fresh meeting."],
});

function artifact(
  document: StoredEvryConversationArtifactDocument,
  ordinal: number
): EvryStoredConversationArtifact {
  return {
    id: `20000000-0000-4000-8000-${String(ordinal + 1).padStart(12, "0")}`,
    ordinal,
    kind: document.kind,
    document,
    artifact: hydrateStoredEvryConversationArtifact(document),
  };
}

function message(input: {
  sequence: number;
  author: "user" | "assistant";
  body: string;
  artifacts?: readonly StoredEvryConversationArtifactDocument[];
}): EvryStoredConversationMessage {
  return {
    id: evryConversationMessageIdSchema.parse(
      `30000000-0000-4000-8000-${String(input.sequence + 1).padStart(12, "0")}`
    ),
    requestKey: evryConversationRequestKeySchema.parse(
      `40000000-0000-4000-8000-${String(input.sequence + 1).padStart(12, "0")}`
    ),
    sequence: input.sequence,
    author: input.author,
    body: input.body,
    pageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    createdAt: new Date(NOW.getTime() + input.sequence),
    artifacts: (input.artifacts ?? []).map((document, index) =>
      artifact(document, input.sequence * 4 + index)
    ),
  };
}

function conversation(
  messages: readonly EvryStoredConversationMessage[]
): EvryStoredConversation {
  return {
    id: evryConversationIdSchema.parse("50000000-0000-4000-8000-000000000001"),
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    title: "Meeting invitation",
    createdAt: NOW,
    lastActivityAt: NOW,
    activePlan: null,
    stateVersion: messages.length - 1,
    state: initialEvryConversationState(),
    messages,
  };
}

const request = (date: string) =>
  `Create a meeting for ${date} at the church location, lasting 90 minutes. ` +
  "Invite the core team and add prospects who have not visited a Vision Meeting. " +
  "Draft an email invitation and send it to them.";

test("reuse keeps the visible relative date intent and enters closed selection", () => {
  const draft = meetingInvitationReuseDraft({
    conversation: conversation([
      message({
        sequence: 0,
        author: "user",
        body: request("next Friday at 10 AM"),
      }),
      message({
        sequence: 1,
        author: "assistant",
        body: "Review this exact plan.",
        artifacts: [confirmation],
      }),
    ]),
    plan: PLAN,
  });
  assert.ok(draft);
  assert.match(draft.message, /next Friday at 10 AM/);
  assert.match(draft.message, /Resolve the church location again/);
  assert.deepEqual(selectMeetingInvitationReferenceRequest(draft.message), {
    sourceText: "next Friday at 10 AM",
    durationMinutes: 90,
    subject: "You're invited to Vision Meeting",
    body: "Hi {{first_name}},\n\nJoin us for Vision Meeting at our church location. We look forward to seeing you.",
  });
  assert.equal(draft.message.includes(PLAN.planId), false);
  assert.equal(draft.message.includes(PLAN.fingerprint), false);
});

test("reuse converts a persisted location choice into visible resolvable intent", () => {
  const northId = "80000000-0000-4000-8000-000000000001";
  const southId = "80000000-0000-4000-8000-000000000002";
  const southName = "South Campus";
  const clarification = storedEvryClarificationArtifactDocument({
    kind: "clarification",
    mode: "choice",
    entityType: "meeting_location",
    prompt: "Which exact church location should Evry use?",
    choices: [
      {
        entityType: "meeting_location",
        id: northId,
        label: "Location 1",
        distinguishingFacts: [
          { label: "Name", value: "North Campus" },
          { label: "Address", value: "1 North Street" },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: "Open Meetings",
          href: "/meetings",
        }),
      },
      {
        entityType: "meeting_location",
        id: southId,
        label: "Location 2",
        distinguishingFacts: [
          { label: "Name", value: southName },
          { label: "Address", value: "2 South Street" },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: "Open Meetings",
          href: "/meetings",
        }),
      },
    ],
    defaultChoiceId: null,
  });
  const draft = meetingInvitationReuseDraft({
    conversation: conversation([
      message({
        sequence: 0,
        author: "user",
        body: request("September 5 at 6 PM"),
      }),
      message({
        sequence: 1,
        author: "assistant",
        body: "Choose a location.",
        artifacts: [clarification],
      }),
      message({ sequence: 2, author: "user", body: "Location 2" }),
      message({
        sequence: 3,
        author: "assistant",
        body: "Review this exact plan.",
        artifacts: [confirmation],
      }),
    ]),
    plan: PLAN,
  });
  assert.ok(draft);
  assert.match(draft.message, /Location choice: "South Campus"/);
  assert.equal(draft.message.includes(southId), false);
  assert.deepEqual(selectMeetingInvitationReferenceRequest(draft.message), {
    sourceText: "September 5 at 6 PM",
    durationMinutes: 90,
    locationQuery: southName,
    subject: "You're invited to Vision Meeting",
    body: "Hi {{first_name}},\n\nJoin us for Vision Meeting at our church location. We look forward to seeing you.",
  });
});

function currentFacts(
  input: {
    locations?: MeetingInvitationReferenceFacts["locations"];
    people?: MeetingInvitationReferenceFacts["people"];
  } = {}
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
    locations: input.locations ?? [],
    people: input.people ?? [
      {
        id: "90000000-0000-4000-8000-000000000001",
        firstName: "Alex",
        lastName: "Person",
        email: "alex@example.test",
        status: "core_group",
        attendedVisionMeeting: false,
        expectedUpdatedAt: "2026-08-30T10:00:00.000Z",
      },
    ],
    suppressedEmails: new Set(),
  };
}

function resolvedDate(
  calendarDate: string,
  instantUtc: string
): EvryDateTimeResolution {
  return {
    status: "resolved",
    dateTime: {
      calendarDate,
      localTime: "10:00 AM",
      timeZone: "America/New_York",
      utcOffset: "-04:00",
      instantUtc,
      interpretation: {
        basis: "relative-time",
        sourceText: "next Friday at 10 AM",
        statedCalendarDate: null,
      },
    },
  } as unknown as EvryDateTimeResolution;
}

test("reuse resolves the same visible intent against the new clock and recipient facts", async () => {
  const draft = meetingInvitationReuseDraft({
    conversation: conversation([
      message({
        sequence: 0,
        author: "user",
        body: request("next Friday at 10 AM"),
      }),
      message({
        sequence: 1,
        author: "assistant",
        body: "Review this exact plan.",
        artifacts: [confirmation],
      }),
    ]),
    plan: PLAN,
  });
  assert.ok(draft);
  const copied = selectMeetingInvitationReferenceRequest(draft.message);
  assert.ok(copied);

  const initial = createMeetingInvitationReferenceResolver({
    async resolveDateTime() {
      return resolvedDate("2026-09-04", "2026-09-04T14:00:00.000Z");
    },
    async loadFacts() {
      return currentFacts();
    },
  });
  const changedRecipient = {
    id: "90000000-0000-4000-8000-000000000002",
    firstName: "Beth",
    lastName: "Person",
    email: "beth@example.test",
    status: "launch_team",
    attendedVisionMeeting: false,
    expectedUpdatedAt: "2026-09-05T10:00:00.000Z",
  };
  const current = createMeetingInvitationReferenceResolver({
    async resolveDateTime(input) {
      assert.equal(
        (input as { sourceText: string }).sourceText,
        "next Friday at 10 AM"
      );
      return resolvedDate("2026-09-11", "2026-09-11T14:00:00.000Z");
    },
    async loadFacts() {
      const baseline = currentFacts();
      return currentFacts({ people: [...baseline.people, changedRecipient] });
    },
  });
  const originalResolution = await initial({ actor: ACTOR, request: copied });
  const currentResolution = await current({ actor: ACTOR, request: copied });
  assert.equal(originalResolution.kind, "resolved");
  assert.equal(currentResolution.kind, "resolved");
  if (
    originalResolution.kind !== "resolved" ||
    currentResolution.kind !== "resolved"
  ) {
    return;
  }
  assert.equal(originalResolution.dateTime.calendarDate, "2026-09-04");
  assert.equal(currentResolution.dateTime.calendarDate, "2026-09-11");
  assert.deepEqual(
    originalResolution.guests.map(({ personId }) => personId),
    ["90000000-0000-4000-8000-000000000001"]
  );
  assert.deepEqual(
    currentResolution.guests.map(({ personId }) => personId),
    [
      "90000000-0000-4000-8000-000000000001",
      "90000000-0000-4000-8000-000000000002",
    ]
  );
});

test("reuse refuses a deleted explicit location and permission loss before resolution", async () => {
  const southId = "80000000-0000-4000-8000-000000000002";
  const clarification = storedEvryClarificationArtifactDocument({
    kind: "clarification",
    mode: "choice",
    entityType: "meeting_location",
    prompt: "Which exact church location should Evry use?",
    choices: [
      {
        entityType: "meeting_location",
        id: "80000000-0000-4000-8000-000000000001",
        label: "Location 1",
        distinguishingFacts: [
          { label: "Name", value: "North Campus" },
          { label: "Address", value: "1 North Street" },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: "Open Meetings",
          href: "/meetings",
        }),
      },
      {
        entityType: "meeting_location",
        id: southId,
        label: "Location 2",
        distinguishingFacts: [
          { label: "Name", value: "South Campus" },
          { label: "Address", value: "2 South Street" },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: "Open Meetings",
          href: "/meetings",
        }),
      },
    ],
    defaultChoiceId: null,
  });
  const draft = meetingInvitationReuseDraft({
    conversation: conversation([
      message({
        sequence: 0,
        author: "user",
        body: request("September 5 at 6 PM"),
      }),
      message({
        sequence: 1,
        author: "assistant",
        body: "Choose a location.",
        artifacts: [clarification],
      }),
      message({ sequence: 2, author: "user", body: "Location 2" }),
      message({
        sequence: 3,
        author: "assistant",
        body: "Review this exact plan.",
        artifacts: [confirmation],
      }),
    ]),
    plan: PLAN,
  });
  assert.ok(draft);
  const copied = selectMeetingInvitationReferenceRequest(draft.message);
  assert.ok(copied);
  const afterDelete = createMeetingInvitationReferenceResolver({
    async resolveDateTime() {
      return resolvedDate("2026-09-05", "2026-09-05T22:00:00.000Z");
    },
    async loadFacts() {
      return currentFacts({
        locations: [
          {
            id: "80000000-0000-4000-8000-000000000001",
            name: "North Campus",
            address: "1 North Street",
          },
        ],
      });
    },
  });
  const deleted = await afterDelete({ actor: ACTOR, request: copied });
  assert.equal(deleted.kind, "clarification");
  if (deleted.kind === "clarification") {
    assert.equal(deleted.artifact.entityType, "meeting_location");
  }

  let resolveCalls = 0;
  let createCalls = 0;
  const continuation = createMeetingInvitationConversationContinuation({
    async findPlan() {
      return null;
    },
    async authorizeRead() {
      return null;
    },
    async resolveAuthorized() {
      resolveCalls++;
      return { kind: "unavailable" as const };
    },
    async createPlan() {
      createCalls++;
      throw new Error("permission loss must stop before persistence");
    },
  } as never);
  const denied = await continuation.continue({
    actor: ACTOR,
    conversation: {
      id: "50000000-0000-4000-8000-000000000002",
      activePlan: null,
      messages: [],
    } as never,
    userRequestKey: "reuse-permission-loss",
    literalUserText: draft.message,
    pageContext: null,
    requestPageContext: null,
    now: NOW,
  });
  assert.equal(denied, null);
  assert.equal(resolveCalls, 0);
  assert.equal(createCalls, 0);
});
