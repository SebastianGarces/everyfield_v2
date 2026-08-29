import { MEETINGS_CAPABILITY_SURFACES } from "./catalog";
import {
  defineEvryCapabilityRegistration,
  type EvryCapabilityRegistration,
} from "@/lib/evry/eligibility/registry";

export type MeetingsOperationRegistration = EvryCapabilityRegistration &
  Readonly<{
    label: string;
    actionLabel: string | null;
    argumentKeys: readonly string[];
    difficultToReverse: boolean;
  }>;

function registration(
  authority: Parameters<typeof defineEvryCapabilityRegistration>[0],
  metadata: Omit<
    MeetingsOperationRegistration,
    keyof EvryCapabilityRegistration
  >
): MeetingsOperationRegistration {
  return Object.freeze({
    ...defineEvryCapabilityRegistration(authority),
    ...metadata,
  });
}

const readCall = (source: string, imported: string) =>
  `read-operation:${source} → ${imported}`;

const MEETING_LIST_READ = registration(
  {
    identity: "meetings.read.list",
    parityCapability: "meetings",
    operationKind: "read",
    applicationCapability: "read",
    surfaceIdentities: [
      "route:/meetings",
      "route:/teams/[teamId]/meetings",
      readCall("src/app/(dashboard)/meetings/page.tsx", "hasMeetingHistory"),
      readCall("src/app/(dashboard)/meetings/page.tsx", "listMeetings"),
      readCall(
        "src/app/(dashboard)/teams/[teamId]/meetings/page.tsx",
        "listMeetings"
      ),
    ],
  },
  {
    label: "List meetings",
    actionLabel: null,
    argumentKeys: Object.freeze(["type", "teamId"]),
    difficultToReverse: false,
  }
);

const MEETING_DETAIL_READ = registration(
  {
    identity: "meetings.read.detail",
    parityCapability: "meetings",
    operationKind: "read",
    applicationCapability: "read",
    surfaceIdentities: [
      "route:/meetings/[id]",
      "route:/meetings/[id]/attendance",
      "route:/meetings/[id]/evaluation",
      "route:/meetings/[id]/invitations",
      "route:/meetings/[id]/logistics",
      "route:/meetings/[id]/outcomes",
      readCall("src/app/(dashboard)/meetings/[id]/layout.tsx", "getMeeting"),
      readCall("src/app/(dashboard)/meetings/[id]/page.tsx", "getMeeting"),
      readCall("src/app/(dashboard)/meetings/[id]/page.tsx", "listLocations"),
      readCall("src/app/(dashboard)/meetings/[id]/page.tsx", "getGuestList"),
      readCall(
        "src/app/(dashboard)/meetings/[id]/page.tsx",
        "getFollowUpCompletion"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/page.tsx",
        "getMeetingCommunications"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/page.tsx",
        "getMeetingContextualTemplates"
      ),
      "read-operation:src/app/(dashboard)/meetings/[id]/page.tsx → churches",
      readCall(
        "src/app/(dashboard)/meetings/[id]/attendance/page.tsx",
        "getMeeting"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/attendance/page.tsx",
        "getAttendanceSummary"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/attendance/page.tsx",
        "listMeetingResponses"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/attendance/page.tsx",
        "getGuestList"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/evaluation/page.tsx",
        "getMeeting"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/evaluation/page.tsx",
        "getEvaluation"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/evaluation/page.tsx",
        "getEvaluationTrend"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/evaluation/page.tsx",
        "listAttendees"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/invitations/page.tsx",
        "getMeeting"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/invitations/page.tsx",
        "getGuestList"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/logistics/page.tsx",
        "getMeeting"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/logistics/page.tsx",
        "getChecklist"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/logistics/page.tsx",
        "getChecklistSummary"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/outcomes/page.tsx",
        "getMeeting"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/outcomes/page.tsx",
        "getMeetingResponseBreakdown"
      ),
    ],
  },
  {
    label: "Review meeting details",
    actionLabel: null,
    argumentKeys: Object.freeze(["meetingId"]),
    difficultToReverse: false,
  }
);

const MEETING_ANALYTICS_READ = registration(
  {
    identity: "meetings.read.analytics",
    parityCapability: "meetings",
    operationKind: "read",
    applicationCapability: "read",
    surfaceIdentities: [
      "route:/meetings/[id]/analytics",
      readCall(
        "src/app/(dashboard)/meetings/[id]/analytics/page.tsx",
        "getMeeting"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/analytics/page.tsx",
        "getAttendanceTrend"
      ),
      readCall(
        "src/app/(dashboard)/meetings/[id]/analytics/page.tsx",
        "getMeetingSummaryStats"
      ),
    ],
  },
  {
    label: "Review meeting analytics",
    actionLabel: null,
    argumentKeys: Object.freeze(["meetingId", "type", "limit"]),
    difficultToReverse: false,
  }
);

const MEETING_SCHEDULING_READ = registration(
  {
    identity: "meetings.read.schedule",
    parityCapability: "meetings",
    operationKind: "read",
    applicationCapability: "meetings.write",
    surfaceIdentities: [
      "route:/meetings/new",
      readCall("src/app/(dashboard)/meetings/new/page.tsx", "listLocations"),
    ],
  },
  {
    label: "Review meeting scheduling options",
    actionLabel: null,
    argumentKeys: Object.freeze([]),
    difficultToReverse: false,
  }
);

const EFFECT_REGISTRATIONS = MEETINGS_CAPABILITY_SURFACES.filter(
  (surface) => surface.operationKind === "effect"
).map(
  (surface): MeetingsOperationRegistration =>
    registration(
      {
        identity: surface.operationId,
        parityCapability: "meetings",
        operationKind: "effect",
        applicationCapability: "meetings.write",
        surfaceIdentities: [surface.identity],
      },
      {
        label: surface.label,
        actionLabel: surface.actionLabel,
        argumentKeys: surface.argumentKeys,
        difficultToReverse: surface.difficultToReverse,
      }
    )
);

export const MEETINGS_OPERATION_REGISTRATIONS: readonly MeetingsOperationRegistration[] =
  Object.freeze([
    MEETING_LIST_READ,
    MEETING_DETAIL_READ,
    MEETING_ANALYTICS_READ,
    MEETING_SCHEDULING_READ,
    ...EFFECT_REGISTRATIONS,
  ]);

export const MEETINGS_READ_OPERATION_IDENTITIES = Object.freeze(
  MEETINGS_OPERATION_REGISTRATIONS.filter(
    ({ operationKind }) => operationKind === "read"
  ).map(({ identity }) => identity)
);

export const MEETINGS_EFFECT_OPERATION_IDENTITIES = Object.freeze(
  MEETINGS_OPERATION_REGISTRATIONS.filter(
    ({ operationKind }) => operationKind === "effect"
  ).map(({ identity }) => identity)
);
