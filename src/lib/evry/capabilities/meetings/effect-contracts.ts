import { z } from "zod";

import {
  attendanceStatuses,
  attendanceTypes,
  meetingStatuses,
  meetingSubtypes,
  meetingTypes,
  responseCardTypes,
  responseStatuses,
} from "@/db/schema/meetings";
import {
  MAX_AGENDA_SECTIONS,
  MAX_SECTION_MINUTES,
  MAX_SECTION_TITLE_LENGTH,
} from "@/lib/meetings/agenda";

import {
  MEETINGS_ACTION_CONTRACTS,
  type MeetingsActionExport,
} from "./catalog";

const uuid = z.string().uuid();
const timestamp = z.string().datetime();
const nullableTimestamp = timestamp.nullable();
const nullableUuid = uuid.nullable();
const nullableText = z.string().nullable();
const email = z.string().email().max(255).nullable();
const nonnegativeInt = z.number().int().nonnegative();
const timezone = z.string().trim().min(1).max(128).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Invalid IANA time zone");
const uuidSet = z.array(uuid).max(1_000).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: "IDs must be unique" });
  }
});

const agendaSectionSchema = z.strictObject({
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(MAX_SECTION_TITLE_LENGTH),
  minutes: z.number().int().min(0).max(MAX_SECTION_MINUTES),
});
const agendaSchema = z.array(agendaSectionSchema).max(MAX_AGENDA_SECTIONS);

const locationStateSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  address: z.string().trim().min(1).max(500),
  contactName: z.string().max(255).nullable(),
  contactPhone: z.string().max(50).nullable(),
  contactEmail: email,
  cost: z.string().max(50).nullable(),
  capacity: nonnegativeInt.nullable(),
  notes: nullableText,
  isActive: z.boolean(),
});

const meetingStateSchema = z.strictObject({
  type: z.enum(meetingTypes),
  title: z.string().max(255).nullable(),
  datetime: timestamp,
  status: z.enum(meetingStatuses),
  locationId: nullableUuid,
  locationName: z.string().max(255).nullable(),
  locationAddress: z.string().max(500).nullable(),
  teamId: nullableUuid,
  meetingSubtype: z.enum(meetingSubtypes).nullable(),
  estimatedAttendance: nonnegativeInt.nullable(),
  actualAttendance: nonnegativeInt.nullable(),
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  notes: nullableText,
  agenda: agendaSchema,
});

const personFields = {
  personId: uuid,
  firstName: z.string().trim().min(1).max(255),
  lastName: z.string().trim().min(1).max(255),
  email,
  phone: z.string().max(50).nullable(),
} as const;

const attendanceBaselineSchema = z.strictObject({
  id: nullableUuid,
  exists: z.boolean(),
  status: z.enum(attendanceStatuses).nullable(),
  attendanceType: z.enum(attendanceTypes).nullable(),
  responseStatus: z.enum(responseStatuses).nullable(),
  notes: nullableText,
  updatedAt: nullableTimestamp,
});

const notificationTargetSchema = z.strictObject({
  notificationId: uuid,
  recipientUserId: uuid,
  notificationType: z.string().trim().min(1).max(100),
  scheduledFor: timestamp,
});
const notificationTargetsSchema = z
  .array(notificationTargetSchema)
  .max(1_000)
  .superRefine((targets, context) => {
    const ids = targets.map(({ notificationId }) => notificationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Notification targets must be unique",
      });
    }
  });

const responseBaselineSchema = z.strictObject({
  responseId: uuid,
  responseType: z.enum(responseCardTypes),
  notes: nullableText,
  recordedById: nullableUuid,
  updatedAt: timestamp,
});

const checklistCreationSchema = z.strictObject({
  itemId: uuid,
  itemName: z.string().trim().min(1).max(255),
  category: z.enum(["essential", "materials", "setup", "av", "organization"]),
});

const attendanceCreationSchema = z.strictObject({
  attendanceId: uuid,
  personId: uuid,
  expectedPersonUpdatedAt: timestamp,
});

const attendedTargetSchema = z.strictObject({
  attendanceId: uuid,
  personId: uuid,
  attendanceType: z.enum(attendanceTypes).nullable(),
  expectedUpdatedAt: timestamp,
});

const personStatusChangeSchema = z.strictObject({
  personId: uuid,
  beforeStatus: z.literal("prospect"),
  afterStatus: z.literal("attendee"),
  expectedUpdatedAt: timestamp,
  activityId: uuid,
});

const score = z.number().int().min(1).max(5);
const attendanceRecordChangeSchema = z.strictObject({
  attendanceId: uuid,
  personId: uuid,
  before: attendanceBaselineSchema,
  afterStatus: z.enum(attendanceStatuses),
  afterAttendanceType: z.enum(attendanceTypes).nullable(),
});
const followUpTargetSchema = z.strictObject({
  taskId: uuid,
  personId: uuid,
  title: z.string().trim().min(1).max(500),
  dueDate: z.string().date(),
  assignedToId: uuid,
  expectedTaskAbsent: z.literal(true),
});
const evaluationTaskTargetSchema = z.strictObject({
  taskId: uuid,
  title: z.string().trim().min(1).max(500),
  dueDate: z.string().date(),
  assignedToId: uuid,
  expectedTaskAbsent: z.boolean(),
  beforeStatus: z
    .enum(["not_started", "in_progress", "blocked", "complete"])
    .nullable(),
  expectedUpdatedAt: nullableTimestamp,
});

export const MEETINGS_EFFECT_ARGUMENT_SCHEMAS = {
  addAttendeeAction: z.strictObject({
    meetingId: uuid,
    attendanceId: uuid,
    personId: uuid,
    attendanceType: z.enum(attendanceTypes).nullable(),
    status: z.enum(attendanceStatuses),
    invitedById: nullableUuid,
    responseStatus: z.enum(responseStatuses).nullable(),
    notes: nullableText,
    expectedMeetingUpdatedAt: timestamp,
    expectedPersonUpdatedAt: timestamp,
    expectedAttendanceAbsent: z.literal(true),
    notificationTargets: notificationTargetsSchema,
  }),
  addAttendeeNoteAction: z.strictObject({
    meetingId: uuid,
    personId: uuid,
    meetingType: z.enum(meetingTypes),
    note: z.string().trim().min(1).max(5000),
    activityId: uuid,
    expectedMeetingUpdatedAt: timestamp,
    expectedPersonUpdatedAt: timestamp,
  }),
  addToGuestListAction: z.strictObject({
    meetingId: uuid,
    attendanceId: uuid,
    personId: uuid,
    expectedMeetingUpdatedAt: timestamp,
    expectedPersonUpdatedAt: timestamp,
    expectedAttendanceAbsent: z.literal(true),
    notificationTargets: notificationTargetsSchema,
  }),
  addWalkInAttendeeAction: z.strictObject({
    meetingId: uuid,
    attendanceId: uuid,
    personId: uuid,
    attendanceType: z.enum(attendanceTypes),
    expectedMeetingUpdatedAt: timestamp,
    expectedPersonUpdatedAt: timestamp,
    expectedAttendanceAbsent: z.literal(true),
    notificationTargets: notificationTargetsSchema,
  }),
  clearResponseCardAction: z.strictObject({
    meetingId: uuid,
    personId: uuid,
    responseId: uuid,
    beforeResponse: responseBaselineSchema,
    expectedAttendanceUpdatedAt: timestamp,
  }),
  createEvaluationAction: z.strictObject({
    meetingId: uuid,
    evaluationId: uuid,
    attendanceScore: score,
    locationScore: score,
    logisticsScore: score,
    agendaScore: score,
    vibeScore: score,
    messageScore: score,
    closeScore: score,
    nextStepsScore: score,
    notes: nullableText,
    expectedMeetingUpdatedAt: timestamp,
    expectedEvaluationAbsent: z.literal(true),
    evaluationTask: evaluationTaskTargetSchema.nullable(),
  }),
  createLocationAction: z.strictObject({
    locationId: uuid,
    name: z.string().trim().min(1).max(255),
    address: z.string().trim().min(1).max(500),
    contactName: z.string().max(255).nullable(),
    contactPhone: z.string().max(50).nullable(),
    contactEmail: email,
    cost: z.string().max(50).nullable(),
    capacity: nonnegativeInt.nullable(),
    notes: nullableText,
    expectedLocationAbsent: z.literal(true),
  }),
  createMeetingAction: z.strictObject({
    meetingId: uuid,
    type: z.enum(meetingTypes),
    title: z.string().max(255).nullable(),
    datetime: timestamp,
    timezone,
    locationId: nullableUuid,
    locationName: z.string().max(255).nullable(),
    locationAddress: z.string().max(500).nullable(),
    savedLocationId: nullableUuid,
    teamId: nullableUuid,
    meetingSubtype: z.enum(meetingSubtypes).nullable(),
    estimatedAttendance: nonnegativeInt.nullable(),
    durationMinutes: z.number().int().min(1).max(1440).nullable(),
    notes: nullableText,
    agenda: agendaSchema,
    meetingNumber: nonnegativeInt.nullable(),
    checklistItems: z.array(checklistCreationSchema).max(100),
    resolvedTeamMemberIds: uuidSet,
    attendanceRows: z.array(attendanceCreationSchema).max(1_000),
    notificationTargets: notificationTargetsSchema,
    expectedMeetingAbsent: z.literal(true),
    expectedTeamRosterVersion: timestamp.nullable(),
  }),
  deleteMeetingAction: z.strictObject({
    meetingId: uuid,
    timezone,
    expectedUpdatedAt: timestamp,
    before: meetingStateSchema,
    expectedAttendanceIds: uuidSet,
    expectedChecklistItemIds: uuidSet,
    expectedResponseIds: uuidSet,
    expectedEvaluationId: nullableUuid,
    expectedInvitationIds: uuidSet,
    pendingNotificationIds: uuidSet,
  }),
  finalizeAttendanceAction: z.strictObject({
    meetingId: uuid,
    expectedMeetingUpdatedAt: timestamp,
    expectedActualAttendance: nonnegativeInt.nullable(),
    attendees: z.array(attendedTargetSchema).max(1_000),
    personStatusChanges: z.array(personStatusChangeSchema).max(1_000),
    followUpTaskTargets: z.array(followUpTargetSchema),
    evaluationTaskTarget: evaluationTaskTargetSchema.nullable(),
    expectedChurchMaterialEventAt: nullableTimestamp,
  }),
  quickAddAttendeeAction: z.strictObject({
    meetingId: uuid,
    ...personFields,
    personActivityId: uuid,
    attendanceId: uuid,
    attendanceType: z.enum(attendanceTypes),
    invitedById: nullableUuid,
    expectedMeetingUpdatedAt: timestamp,
    expectedPersonAbsent: z.literal(true),
    expectedAttendanceAbsent: z.literal(true),
    notificationTargets: notificationTargetsSchema,
    expectedChurchMaterialEventAt: nullableTimestamp,
  }),
  quickAddPersonToGuestListAction: z.strictObject({
    meetingId: uuid,
    ...personFields,
    personActivityId: uuid,
    attendanceId: uuid,
    expectedMeetingUpdatedAt: timestamp,
    expectedPersonAbsent: z.literal(true),
    expectedAttendanceAbsent: z.literal(true),
    notificationTargets: notificationTargetsSchema,
    expectedChurchMaterialEventAt: nullableTimestamp,
  }),
  quickAddWalkInAction: z.strictObject({
    meetingId: uuid,
    ...personFields,
    personActivityId: uuid,
    attendanceId: uuid,
    attendanceType: z.enum(attendanceTypes),
    expectedMeetingUpdatedAt: timestamp,
    expectedPersonAbsent: z.literal(true),
    expectedAttendanceAbsent: z.literal(true),
    notificationTargets: notificationTargetsSchema,
    expectedChurchMaterialEventAt: nullableTimestamp,
  }),
  recordAttendanceBatchAction: z.strictObject({
    meetingId: uuid,
    expectedMeetingUpdatedAt: timestamp,
    records: z.array(attendanceRecordChangeSchema).min(1),
  }),
  recordResponseCardAction: z.strictObject({
    meetingId: uuid,
    personId: uuid,
    responseType: z.enum(responseCardTypes),
    notes: z.string().max(2000).nullable(),
    responseId: uuid,
    expectedAttendanceUpdatedAt: timestamp,
    beforeResponse: responseBaselineSchema.nullable(),
  }),
  removeAttendeeAction: z.strictObject({
    meetingId: uuid,
    personId: uuid,
    expectedAttendanceUpdatedAt: timestamp,
    expectedResponseUpdatedAt: nullableTimestamp,
    pendingNotificationIds: uuidSet,
  }),
  removeFromGuestListAction: z.strictObject({
    meetingId: uuid,
    personId: uuid,
    expectedAttendanceUpdatedAt: timestamp,
    pendingNotificationIds: uuidSet,
  }),
  saveAgendaAction: z.strictObject({
    meetingId: uuid,
    expectedUpdatedAt: timestamp,
    beforeSections: agendaSchema,
    afterSections: agendaSchema,
  }),
  toggleAttendanceStatusAction: z.strictObject({
    meetingId: uuid,
    personId: uuid,
    beforeStatus: z.enum(attendanceStatuses),
    afterStatus: z.enum(attendanceStatuses),
    afterAttendanceType: z.enum(attendanceTypes).nullable(),
    expectedAttendanceUpdatedAt: timestamp,
  }),
  toggleChecklistItemAction: z.strictObject({
    itemId: uuid,
    meetingId: uuid,
    beforeChecked: z.boolean(),
    afterChecked: z.boolean(),
    expectedUpdatedAt: timestamp,
  }),
  updateChecklistItemAction: z.strictObject({
    itemId: uuid,
    meetingId: uuid,
    beforeNotes: nullableText,
    afterNotes: nullableText,
    beforeAssignedTo: nullableUuid,
    afterAssignedTo: nullableUuid,
    expectedAssignedPersonUpdatedAt: nullableTimestamp,
    expectedUpdatedAt: timestamp,
  }),
  updateLocationAction: z.strictObject({
    locationId: uuid,
    expectedUpdatedAt: timestamp,
    before: locationStateSchema,
    after: locationStateSchema,
    affectedMeetingIds: uuidSet,
    pendingNotificationIds: uuidSet,
    notificationTargets: notificationTargetsSchema,
  }),
  updateMeetingAction: z.strictObject({
    meetingId: uuid,
    timezone,
    expectedUpdatedAt: timestamp,
    before: meetingStateSchema,
    after: meetingStateSchema,
    pendingNotificationIds: uuidSet,
    notificationTargets: notificationTargetsSchema,
  }),
  updateMeetingStatusAction: z.strictObject({
    meetingId: uuid,
    beforeStatus: z.enum(meetingStatuses),
    afterStatus: z.enum(meetingStatuses),
    expectedUpdatedAt: timestamp,
    pendingNotificationIds: uuidSet,
    notificationTargets: notificationTargetsSchema,
  }),
  updateRsvpStatusAction: z.strictObject({
    meetingId: uuid,
    personId: uuid,
    beforeStatus: z.enum(responseStatuses).nullable(),
    afterStatus: z.enum(responseStatuses),
    expectedAttendanceUpdatedAt: timestamp,
  }),
} as const satisfies Record<MeetingsActionExport, z.ZodType>;

export type MeetingsEffectArguments<
  ExportName extends MeetingsActionExport,
> = z.infer<(typeof MEETINGS_EFFECT_ARGUMENT_SCHEMAS)[ExportName]>;

export function assertMeetingsEffectContractsComplete(): void {
  const exports = Object.keys(MEETINGS_ACTION_CONTRACTS).toSorted();
  const schemas = Object.keys(MEETINGS_EFFECT_ARGUMENT_SCHEMAS).toSorted();
  if (JSON.stringify(exports) !== JSON.stringify(schemas)) {
    throw new Error("Meetings effect schemas do not cover authoritative actions");
  }
  for (const exportName of exports as MeetingsActionExport[]) {
    const contractKeys = [...MEETINGS_ACTION_CONTRACTS[exportName].argumentKeys]
      .toSorted();
    const schemaKeys = Object.keys(
      MEETINGS_EFFECT_ARGUMENT_SCHEMAS[exportName].shape
    ).toSorted();
    if (JSON.stringify(contractKeys) !== JSON.stringify(schemaKeys)) {
      throw new Error(`Meetings argument contract drift: ${exportName}`);
    }
  }
}

assertMeetingsEffectContractsComplete();
