import {
  evryConversationPlanIdentitySchema,
  type EvryConversationPlanIdentity,
} from "@/lib/evry/conversations/contract";

import {
  buildEvryConfirmationArtifact,
  buildEvryProgressArtifact,
  buildEvryReceiptArtifact,
  type EvryDetailedConfirmationArtifactDocument,
  type EvryDetailedProgressArtifactDocument,
  type EvryDetailedReceiptArtifactDocument,
} from "./review";

const PLAN_IDS = {
  meeting: "10000000-0000-4000-8000-000000000001",
  bulkStage: "10000000-0000-4000-8000-000000000003",
  fileImport: "10000000-0000-4000-8000-000000000004",
  destructive: "10000000-0000-4000-8000-000000000005",
  communication: "10000000-0000-4000-8000-000000000006",
} as const;

function plan(
  planId: string,
  fingerprintCharacter: string
): EvryConversationPlanIdentity {
  return evryConversationPlanIdentitySchema.parse({
    planId,
    fingerprint: fingerprintCharacter.repeat(64),
  });
}

function planIdFromFingerprint(fingerprint: string): string {
  const characters = fingerprint.slice(0, 32).split("");
  characters[12] = "4";
  characters[16] = "8";
  return `${characters.slice(0, 8).join("")}-${characters
    .slice(8, 12)
    .join("")}-${characters.slice(12, 16).join("")}-${characters
    .slice(16, 20)
    .join("")}-${characters.slice(20).join("")}`;
}

async function editedMeetingPlan(
  recipient: string
): Promise<EvryConversationPlanIdentity> {
  const input = new TextEncoder().encode(
    JSON.stringify({ fixture: "edited-meeting", recipient })
  );
  const digest = await crypto.subtle.digest("SHA-256", input);
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return evryConversationPlanIdentitySchema.parse({
    planId: planIdFromFingerprint(fingerprint),
    fingerprint,
  });
}

const MEETING_START = {
  calendarDate: "2026-09-02",
  localTime: "10:00 AM",
  timeZone: "America/New_York",
  utcOffset: "-04:00",
  instantUtc: "2026-09-02T14:00:00.000Z",
  interpretation: {
    basis: "explicit-calendar-date" as const,
    sourceText: "September 2, 2026 at 10:00 AM",
    statedCalendarDate: "2026-09-02",
  },
} as const;

const MEETING_END = {
  calendarDate: "2026-09-02",
  localTime: "11:30 AM",
  timeZone: "America/New_York",
  utcOffset: "-04:00",
  instantUtc: "2026-09-02T15:30:00.000Z",
  interpretation: {
    basis: "explicit-calendar-date" as const,
    sourceText: "September 2, 2026 at 11:30 AM",
    statedCalendarDate: "2026-09-02",
  },
} as const;

function meetingConfirmation(
  exactPlan: EvryConversationPlanIdentity,
  editedRecipient: string
): EvryDetailedConfirmationArtifactDocument {
  return buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: exactPlan,
    title: "Create Vision Meeting and send invitations",
    actionLabel: "Create meeting and send 4",
    steps: [
      {
        stepId: "create-meeting",
        title: "Create Vision Meeting",
        effectKind: "meeting",
        reversibility: "reversible",
        resolvedTargets: [
          {
            label: "Meeting",
            value: "Vision Meeting",
            sourceLink: null,
          },
          {
            label: "Location",
            value: "Church location · 144 Oak Street",
            sourceLink: null,
          },
        ],
        counts: [{ label: "Meetings created", count: 1 }],
        exclusions: [],
        dateTime: { startsAt: MEETING_START, endsAt: MEETING_END },
        contentPreviews: [],
        beforeAfter: [],
      },
      {
        stepId: "add-guests",
        title: "Add resolved guests",
        effectKind: "other",
        reversibility: "reversible",
        resolvedTargets: [
          {
            label: "Guest",
            value: "Alex Rivera · alex@example.test",
            sourceLink: { label: "Alex Rivera", href: "/people/alex" },
          },
          {
            label: "Guest",
            value: "Jordan Lee · jordan@example.test",
            sourceLink: { label: "Jordan Lee", href: "/people/jordan" },
          },
          {
            label: "Guest",
            value: "Morgan Chen · morgan@example.test",
            sourceLink: { label: "Morgan Chen", href: "/people/morgan" },
          },
          {
            label: "Guest",
            value: editedRecipient,
            sourceLink: null,
          },
        ],
        counts: [{ label: "Guests added", count: 4 }],
        exclusions: [
          { reason: "Missing an email address", count: 2 },
          { reason: "Duplicate recipient", count: 1 },
        ],
        dateTime: null,
        contentPreviews: [],
        beforeAfter: [],
      },
      {
        stepId: "send-invitations",
        title: "Send the invitation",
        effectKind: "communication",
        reversibility: "irreversible",
        resolvedTargets: [
          {
            label: "Recipients",
            value: "The 4 resolved guests above",
            sourceLink: null,
          },
        ],
        counts: [{ label: "Emails sent", count: 4 }],
        exclusions: [
          { reason: "Missing an email address", count: 2 },
          { reason: "Duplicate recipient", count: 1 },
        ],
        dateTime: null,
        contentPreviews: [
          { label: "Subject", content: "You're invited to Vision Meeting" },
          {
            label: "Message",
            content:
              "Join us on September 2 at 10:00 AM at 144 Oak Street. Reply to let us know whether you can attend.",
          },
        ],
        beforeAfter: [
          {
            label: "Invitation delivery",
            before: "Not sent",
            after: "Sent immediately",
            count: 4,
          },
        ],
      },
      {
        stepId: "verify-permission",
        title: "Verify follow-up permission",
        effectKind: "other",
        reversibility: "reversible",
        resolvedTargets: [
          {
            label: "Follow-up",
            value: "Record responses after Vision Meeting",
            sourceLink: null,
          },
        ],
        counts: [{ label: "Permissions checked", count: 1 }],
        exclusions: [],
        dateTime: null,
        contentPreviews: [],
        beforeAfter: [],
      },
      {
        stepId: "record-follow-up",
        title: "Record a follow-up task",
        effectKind: "other",
        reversibility: "reversible",
        resolvedTargets: [
          {
            label: "Task",
            value: "Review Vision Meeting responses",
            sourceLink: null,
          },
        ],
        counts: [{ label: "Tasks created", count: 1 }],
        exclusions: [],
        dateTime: null,
        contentPreviews: [],
        beforeAfter: [],
      },
    ],
    consequences: [
      "Creates one meeting in the plant calendar.",
      "Adds 4 guests and sends 4 emails immediately.",
      "Creates one follow-up task only if the current seat remains allowed.",
    ],
  });
}

export const INITIAL_MEETING_CONFIRMATION = meetingConfirmation(
  plan(PLAN_IDS.meeting, "a"),
  "Taylor Brooks · taylor@example.test"
);

export async function editedMeetingConfirmation(
  recipient: string
): Promise<EvryDetailedConfirmationArtifactDocument> {
  return meetingConfirmation(await editedMeetingPlan(recipient), recipient);
}

const BULK_STAGE_CONFIRMATION = buildEvryConfirmationArtifact({
  kind: "confirmation",
  artifactVersion: 1,
  plan: plan(PLAN_IDS.bulkStage, "c"),
  title: "Move 3 people to Core Group",
  actionLabel: "Move 3 people",
  steps: [
    {
      stepId: "move-people",
      title: "Update people stages",
      effectKind: "bulk_change",
      reversibility: "reversible",
      resolvedTargets: [
        { label: "Person", value: "Alex Rivera", sourceLink: null },
        { label: "Person", value: "Jordan Lee", sourceLink: null },
        { label: "Person", value: "Morgan Chen", sourceLink: null },
      ],
      counts: [{ label: "People changed", count: 3 }],
      exclusions: [{ reason: "Already in Core Group", count: 1 }],
      dateTime: null,
      contentPreviews: [],
      beforeAfter: [
        {
          label: "Prospect → Core Group",
          before: "Prospect",
          after: "Core Group",
          count: 2,
        },
        {
          label: "Attendee → Core Group",
          before: "Attendee",
          after: "Core Group",
          count: 1,
        },
      ],
    },
  ],
  consequences: ["Changes the People pipeline stage for 3 records."],
});

const FILE_IMPORT_CONFIRMATION = buildEvryConfirmationArtifact({
  kind: "confirmation",
  artifactVersion: 1,
  plan: plan(PLAN_IDS.fileImport, "d"),
  title: "Import people from people-import.csv",
  actionLabel: "Import 18 people",
  steps: [
    {
      stepId: "import-people",
      title: "Store 18 parsed people records",
      effectKind: "file_import",
      reversibility: "difficult_to_reverse",
      resolvedTargets: [
        { label: "File", value: "people-import.csv · 24 KB", sourceLink: null },
        { label: "Destination", value: "People directory", sourceLink: null },
      ],
      counts: [
        { label: "Rows parsed", count: 21 },
        { label: "People imported", count: 18 },
      ],
      exclusions: [
        { reason: "Invalid email address", count: 2 },
        { reason: "Duplicate row", count: 1 },
      ],
      dateTime: null,
      contentPreviews: [],
      beforeAfter: [
        {
          label: "People records from this file",
          before: "0 imported records",
          after: "18 imported records",
          count: 18,
        },
      ],
    },
  ],
  consequences: [
    "Creates 18 people records; the source file is not imported by itself.",
  ],
});

const DESTRUCTIVE_CONFIRMATION = buildEvryConfirmationArtifact({
  kind: "confirmation",
  artifactVersion: 1,
  plan: plan(PLAN_IDS.destructive, "e"),
  title: "Delete the duplicate launch task",
  actionLabel: "Delete duplicate task",
  steps: [
    {
      stepId: "delete-task",
      title: "Delete one task",
      effectKind: "destructive",
      reversibility: "irreversible",
      resolvedTargets: [
        {
          label: "Task",
          value: "Confirm launch facility · due September 8",
          sourceLink: {
            label: "Confirm launch facility",
            href: "/tasks/task-1",
          },
        },
      ],
      counts: [{ label: "Tasks deleted", count: 1 }],
      exclusions: [],
      dateTime: null,
      contentPreviews: [],
      beforeAfter: [
        {
          label: "Task state",
          before: "Open task",
          after: "Deleted",
          count: 1,
        },
      ],
    },
  ],
  consequences: [
    "Removes the task and its checklist from the active task list.",
  ],
});

const COMMUNICATION_CONFIRMATION = buildEvryConfirmationArtifact({
  kind: "confirmation",
  artifactVersion: 1,
  plan: plan(PLAN_IDS.communication, "f"),
  title: "Send a launch update",
  actionLabel: "Send update to 3",
  steps: [
    {
      stepId: "send-update",
      title: "Send the launch update",
      effectKind: "communication",
      reversibility: "irreversible",
      resolvedTargets: [
        {
          label: "Recipient",
          value: "Alex Rivera · alex@example.test",
          sourceLink: null,
        },
        {
          label: "Recipient",
          value: "Jordan Lee · jordan@example.test",
          sourceLink: null,
        },
        {
          label: "Recipient",
          value: "Morgan Chen · morgan@example.test",
          sourceLink: null,
        },
      ],
      counts: [{ label: "Emails sent", count: 3 }],
      exclusions: [{ reason: "Unsubscribed", count: 1 }],
      dateTime: null,
      contentPreviews: [
        { label: "Subject", content: "Launch update" },
        {
          label: "Message",
          content:
            "Launch Sunday is September 13. Here is what to expect next.",
        },
      ],
      beforeAfter: [
        {
          label: "Launch update delivery",
          before: "Not sent",
          after: "Sent immediately",
          count: 3,
        },
      ],
    },
  ],
  consequences: ["Sends 3 outbound emails immediately."],
});

export const EVRY_CONFIRMATION_FIXTURES = Object.freeze({
  meeting: INITIAL_MEETING_CONFIRMATION,
  bulkStageChange: BULK_STAGE_CONFIRMATION,
  fileImport: FILE_IMPORT_CONFIRMATION,
  destructiveAction: DESTRUCTIVE_CONFIRMATION,
  communication: COMMUNICATION_CONFIRMATION,
});

export function meetingProgressFixture(
  exactPlan: EvryConversationPlanIdentity
): EvryDetailedProgressArtifactDocument {
  return buildEvryProgressArtifact({
    kind: "progress",
    artifactVersion: 1,
    plan: exactPlan,
    title: "Creating the meeting and sending invitations",
    steps: [
      {
        stepId: "create-meeting",
        label: "Create meeting",
        status: "completed",
        affectedCount: 1,
        excludedCount: 0,
      },
      {
        stepId: "add-guests",
        label: "Add guests",
        status: "completed",
        affectedCount: 4,
        excludedCount: 3,
      },
      {
        stepId: "send-invitations",
        label: "Send invitations",
        status: "active",
        affectedCount: 0,
        excludedCount: 0,
      },
      {
        stepId: "verify-permission",
        label: "Verify follow-up permission",
        status: "pending",
        affectedCount: 0,
        excludedCount: 0,
      },
      {
        stepId: "record-follow-up",
        label: "Record follow-up",
        status: "pending",
        affectedCount: 0,
        excludedCount: 0,
      },
    ],
  });
}

export function partialMeetingReceiptFixture(
  exactPlan: EvryConversationPlanIdentity
): EvryDetailedReceiptArtifactDocument {
  return buildEvryReceiptArtifact({
    kind: "result",
    artifactVersion: 1,
    plan: exactPlan,
    title: "Meeting created; invitations need attention",
    status: "partially_failed",
    steps: [
      {
        stepId: "create-meeting",
        label: "Create meeting",
        status: "completed",
        resultCode: "effect_completed",
        affectedCount: 1,
        excludedCount: 0,
        sourceLinks: [{ label: "Vision Meeting", href: "/meetings/meeting-1" }],
        retry: { status: "unavailable" },
        error: null,
      },
      {
        stepId: "add-guests",
        label: "Add guests",
        status: "completed",
        resultCode: "effect_completed",
        affectedCount: 4,
        excludedCount: 3,
        sourceLinks: [],
        retry: { status: "unavailable" },
        error: null,
      },
      {
        stepId: "send-invitations",
        label: "Send invitations",
        status: "failed",
        resultCode: "effect_failed",
        affectedCount: 0,
        excludedCount: 0,
        sourceLinks: [],
        retry: { status: "safe_retry", label: "Retry sending 4 invitations" },
        error: {
          kind: "expected",
          message:
            "Email delivery could not begin. Review the recipients and try the safe retry.",
        },
      },
      {
        stepId: "verify-permission",
        label: "Verify follow-up permission",
        status: "refused",
        resultCode: "precondition_refused",
        affectedCount: 0,
        excludedCount: 1,
        sourceLinks: [],
        retry: { status: "unavailable" },
        error: {
          kind: "expected",
          message: "Your current seat cannot add the follow-up task.",
        },
      },
      {
        stepId: "record-follow-up",
        label: "Record follow-up",
        status: "skipped",
        resultCode: "dependency_skipped",
        affectedCount: 0,
        excludedCount: 0,
        sourceLinks: [],
        retry: { status: "unavailable" },
        error: null,
      },
    ],
  });
}

export const UNEXPECTED_ERROR_RECEIPT = buildEvryReceiptArtifact({
  kind: "result",
  artifactVersion: 1,
  plan: plan(PLAN_IDS.communication, "9"),
  title: "The update could not be sent",
  status: "failed",
  steps: [
    {
      stepId: "send-update",
      label: "Send launch update",
      status: "failed",
      resultCode: "effect_failed",
      affectedCount: 0,
      excludedCount: 0,
      sourceLinks: [],
      retry: { status: "unavailable" },
      error: {
        kind: "unexpected",
        correlationId: "90000000-0000-4000-8000-000000000001",
      },
    },
  ],
});
