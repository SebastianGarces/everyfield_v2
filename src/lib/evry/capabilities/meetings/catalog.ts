import inventory from "@/lib/evry/capabilities/inventory.generated.json";

import type { Capability } from "@/lib/auth/seat-rules";

const MEETINGS_ACTION_SOURCE =
  "src/app/(dashboard)/meetings/actions.ts" as const;

export const MEETINGS_ACTION_CONTRACTS = {
  addAttendeeAction: effect("meetings.attendance.add", "Add attendee", [
    "meetingId",
    "attendanceId",
    "personId",
    "attendanceType",
    "status",
    "invitedById",
    "responseStatus",
    "notes",
    "expectedMeetingUpdatedAt",
    "expectedPersonUpdatedAt",
    "expectedAttendanceAbsent",
    "notificationTargets",
  ]),
  addAttendeeNoteAction: effect(
    "meetings.attendance.note",
    "Update attendee note",
    [
      "meetingId",
      "personId",
      "meetingType",
      "note",
      "activityId",
      "expectedMeetingUpdatedAt",
      "expectedPersonUpdatedAt",
    ]
  ),
  addToGuestListAction: effect("meetings.add-guests", "Add meeting guest", [
    "meetingId",
    "attendanceId",
    "personId",
    "expectedMeetingUpdatedAt",
    "expectedPersonUpdatedAt",
    "expectedAttendanceAbsent",
    "notificationTargets",
  ]),
  addWalkInAttendeeAction: effect(
    "meetings.attendance.walk-in.add",
    "Add walk-in attendee",
    [
      "meetingId",
      "attendanceId",
      "personId",
      "attendanceType",
      "expectedMeetingUpdatedAt",
      "expectedPersonUpdatedAt",
      "expectedAttendanceAbsent",
      "notificationTargets",
    ]
  ),
  clearResponseCardAction: effect(
    "meetings.response-card.clear",
    "Clear response card",
    [
      "meetingId",
      "personId",
      "responseId",
      "beforeResponse",
      "expectedAttendanceUpdatedAt",
    ]
  ),
  createEvaluationAction: effect(
    "meetings.evaluation.create",
    "Save meeting evaluation",
    [
      "meetingId",
      "evaluationId",
      "attendanceScore",
      "locationScore",
      "logisticsScore",
      "agendaScore",
      "vibeScore",
      "messageScore",
      "closeScore",
      "nextStepsScore",
      "notes",
      "expectedMeetingUpdatedAt",
      "expectedEvaluationAbsent",
      "evaluationTask",
    ]
  ),
  createLocationAction: effect(
    "meetings.location.create",
    "Create meeting location",
    [
      "locationId",
      "name",
      "address",
      "contactName",
      "contactPhone",
      "contactEmail",
      "cost",
      "capacity",
      "notes",
      "expectedLocationAbsent",
    ]
  ),
  createMeetingAction: effect("meetings.create", "Create meeting", [
    "meetingId",
    "type",
    "title",
    "datetime",
    "timezone",
    "status",
    "locationId",
    "locationName",
    "locationAddress",
    "savedLocationId",
    "teamId",
    "meetingSubtype",
    "estimatedAttendance",
    "actualAttendance",
    "durationMinutes",
    "notes",
    "agenda",
    "meetingNumber",
    "checklistItems",
    "resolvedTeamMemberIds",
    "attendanceRows",
    "notificationTargets",
    "expectedMeetingAbsent",
    "createdById",
  ]),
  deleteMeetingAction: effect(
    "meetings.lifecycle.delete",
    "Delete meeting",
    [
      "meetingId",
      "timezone",
      "expectedUpdatedAt",
      "before",
      "expectedAttendanceIds",
      "expectedChecklistItemIds",
      "expectedResponseIds",
      "expectedEvaluationId",
      "expectedInvitationIds",
      "pendingNotifications",
    ],
    true
  ),
  finalizeAttendanceAction: effect(
    "meetings.attendance.finalize",
    "Finalize meeting attendance",
    [
      "meetingId",
      "meetingType",
      "meetingTitle",
      "meetingDatetime",
      "timezone",
      "expectedMeetingUpdatedAt",
      "expectedActualAttendance",
      "attendees",
      "personStatusChanges",
      "followUpTaskTargets",
      "evaluationTaskTarget",
      "expectedChurchMaterialEventAt",
    ]
  ),
  quickAddAttendeeAction: effect(
    "meetings.attendance.person-create-and-add",
    "Create person and add attendee",
    [
      "meetingId",
      "personId",
      "personActivityId",
      "attendanceId",
      "firstName",
      "lastName",
      "email",
      "phone",
      "attendanceType",
      "invitedById",
      "expectedMeetingUpdatedAt",
      "expectedPersonAbsent",
      "expectedAttendanceAbsent",
      "notificationTargets",
      "expectedChurchMaterialEventAt",
    ]
  ),
  quickAddPersonToGuestListAction: effect(
    "meetings.guests.person-create-and-add",
    "Create person and add meeting guest",
    [
      "meetingId",
      "personId",
      "personActivityId",
      "attendanceId",
      "firstName",
      "lastName",
      "email",
      "phone",
      "expectedMeetingUpdatedAt",
      "expectedPersonAbsent",
      "expectedAttendanceAbsent",
      "notificationTargets",
      "expectedChurchMaterialEventAt",
    ]
  ),
  quickAddWalkInAction: effect(
    "meetings.attendance.person-create-and-walk-in",
    "Create person and add walk-in attendee",
    [
      "meetingId",
      "personId",
      "personActivityId",
      "attendanceId",
      "firstName",
      "lastName",
      "email",
      "phone",
      "attendanceType",
      "expectedMeetingUpdatedAt",
      "expectedPersonAbsent",
      "expectedAttendanceAbsent",
      "notificationTargets",
      "expectedChurchMaterialEventAt",
    ]
  ),
  recordAttendanceBatchAction: effect(
    "meetings.attendance.batch-record",
    "Record meeting attendance",
    ["meetingId", "expectedMeetingUpdatedAt", "records"]
  ),
  recordResponseCardAction: effect(
    "meetings.response-card.record",
    "Record response card",
    [
      "meetingId",
      "personId",
      "responseType",
      "notes",
      "responseId",
      "expectedAttendanceUpdatedAt",
      "beforeResponse",
    ]
  ),
  removeAttendeeAction: effect(
    "meetings.attendance.remove",
    "Remove meeting attendee",
    [
      "meetingId",
      "personId",
      "beforeAttendance",
      "beforeResponse",
      "expectedAttendanceUpdatedAt",
      "expectedResponseUpdatedAt",
      "pendingNotifications",
      "notificationTargets",
    ],
    true
  ),
  removeFromGuestListAction: effect(
    "meetings.guests.remove",
    "Remove meeting guest",
    [
      "meetingId",
      "personId",
      "beforeAttendance",
      "expectedAttendanceUpdatedAt",
      "pendingNotifications",
      "notificationTargets",
    ],
    true
  ),
  saveAgendaAction: effect(
    "meetings.agenda.replace",
    "Replace meeting agenda",
    ["meetingId", "expectedUpdatedAt", "beforeSections", "afterSections"]
  ),
  toggleAttendanceStatusAction: effect(
    "meetings.attendance.toggle",
    "Update attendance status",
    [
      "meetingId",
      "personId",
      "beforeStatus",
      "afterStatus",
      "afterAttendanceType",
      "expectedAttendanceUpdatedAt",
    ]
  ),
  toggleChecklistItemAction: effect(
    "meetings.checklist.toggle",
    "Update checklist item",
    [
      "itemId",
      "meetingId",
      "beforeChecked",
      "afterChecked",
      "expectedUpdatedAt",
    ]
  ),
  updateChecklistItemAction: effect(
    "meetings.checklist.update",
    "Update checklist item details",
    [
      "itemId",
      "meetingId",
      "beforeNotes",
      "afterNotes",
      "beforeAssignedTo",
      "afterAssignedTo",
      "expectedAssignedPersonUpdatedAt",
      "expectedUpdatedAt",
    ]
  ),
  updateLocationAction: effect(
    "meetings.location.update",
    "Update meeting location",
    ["locationId", "expectedUpdatedAt", "before", "after"]
  ),
  updateMeetingAction: effect("meetings.lifecycle.update", "Update meeting", [
    "meetingId",
    "timezone",
    "expectedUpdatedAt",
    "before",
    "after",
    "pendingNotifications",
    "notificationTargets",
  ]),
  updateMeetingStatusAction: effect(
    "meetings.lifecycle.status",
    "Update meeting status",
    [
      "meetingId",
      "beforeStatus",
      "afterStatus",
      "expectedUpdatedAt",
      "pendingNotifications",
      "notificationTargets",
    ]
  ),
  updateRsvpStatusAction: effect(
    "meetings.guests.rsvp",
    "Update meeting RSVP",
    [
      "meetingId",
      "personId",
      "beforeStatus",
      "afterStatus",
      "expectedAttendanceUpdatedAt",
    ]
  ),
} as const;

export type MeetingsActionExport = keyof typeof MEETINGS_ACTION_CONTRACTS;

export type MeetingsEffectContract = Readonly<{
  operationId: string;
  operationKind: "effect";
  label: string;
  actionLabel: string;
  argumentKeys: readonly string[];
  difficultToReverse: boolean;
}>;

function effect(
  operationId: string,
  actionLabel: string,
  argumentKeys: readonly string[],
  difficultToReverse = false
): MeetingsEffectContract {
  return Object.freeze({
    operationId,
    operationKind: "effect",
    label: actionLabel,
    actionLabel,
    argumentKeys: Object.freeze([...argumentKeys]),
    difficultToReverse,
  });
}

export type MeetingsCapabilitySurface = Readonly<{
  identity: string;
  operationId: string;
  operationKind: "read" | "effect";
  applicationCapability: Capability;
  parityCapability: "meetings";
  source: string;
  exportName: string | null;
  label: string;
  actionLabel: string | null;
  argumentKeys: readonly string[];
  difficultToReverse: boolean;
}>;

function buildMeetingsCapabilitySurfaces(): readonly MeetingsCapabilitySurface[] {
  const actions = inventory.entries
    .filter(
      (entry) =>
        entry.kind === "action" && entry.source === MEETINGS_ACTION_SOURCE
    )
    .map((entry) => {
      const exportName = entry.exportName as MeetingsActionExport;
      const contract = MEETINGS_ACTION_CONTRACTS[exportName];
      if (!contract) {
        throw new Error(`Unclassified Meetings action export: ${exportName}`);
      }
      if (
        entry.classification.state !== "supported" ||
        entry.parityCapability !== "meetings" ||
        entry.applicationCapability !== "meetings.write"
      ) {
        throw new Error(
          `Meetings action left the supported plant boundary: ${exportName}`
        );
      }
      return Object.freeze({
        identity: entry.identity,
        operationId: contract.operationId,
        operationKind: contract.operationKind,
        applicationCapability: entry.applicationCapability as Capability,
        parityCapability: "meetings" as const,
        source: entry.source,
        exportName,
        label: contract.label,
        actionLabel: contract.actionLabel,
        argumentKeys: contract.argumentKeys,
        difficultToReverse: contract.difficultToReverse,
      });
    });

  const discoveredExports = new Set(
    actions.map(({ exportName }) => exportName)
  );
  for (const exportName of Object.keys(MEETINGS_ACTION_CONTRACTS)) {
    if (!discoveredExports.has(exportName as MeetingsActionExport)) {
      throw new Error(`Stale Meetings action contract: ${exportName}`);
    }
  }

  const routes = inventory.entries
    .filter(
      (entry) => entry.kind === "route" && entry.parityCapability === "meetings"
    )
    .map((entry) => {
      if (entry.classification.state !== "supported") {
        throw new Error(
          `Meetings route left the supported plant boundary: ${entry.path}`
        );
      }
      return Object.freeze({
        identity: entry.identity,
        operationId: `meetings.read.route:${entry.path}`,
        operationKind: "read" as const,
        applicationCapability: "read" as const,
        parityCapability: "meetings" as const,
        source:
          "sources" in entry && entry.sources ? entry.sources.join(",") : "",
        exportName: null,
        label: `Open ${entry.path}`,
        actionLabel: null,
        argumentKeys: Object.freeze([]),
        difficultToReverse: false,
      });
    });

  const surfaces = [...actions, ...routes].toSorted((left, right) =>
    left.identity.localeCompare(right.identity)
  );
  if (
    new Set(surfaces.map(({ identity }) => identity)).size !== surfaces.length
  ) {
    throw new Error("Duplicate Meetings capability surface identity");
  }
  if (
    new Set(surfaces.map(({ operationId }) => operationId)).size !==
    surfaces.length
  ) {
    throw new Error("Duplicate Meetings operation identity");
  }
  return Object.freeze(surfaces);
}

export const MEETINGS_CAPABILITY_SURFACES = buildMeetingsCapabilitySurfaces();

/** A service operation present in code but intentionally absent from the UI/action inventory. */
export const MEETINGS_EXCLUDED_OPERATIONS = Object.freeze([
  Object.freeze({
    identity: "read-import:src/lib/meetings/locations.ts → getLocation",
    reason:
      "No authenticated Meetings page or action invokes this point read directly.",
  }),
  Object.freeze({
    identity:
      "effect-import:src/lib/meetings/locations.ts → deactivateLocation",
    reason: "No authenticated Meetings action exposes location deactivation.",
  }),
]);
