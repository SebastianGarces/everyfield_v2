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
const timezone = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA time zone");
const uuidSet = z
  .array(uuid)
  .max(100)
  .superRefine((values, context) => {
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
  meetingNumber: nonnegativeInt.nullable(),
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

const attendanceBaselineSchema = z
  .strictObject({
    id: nullableUuid,
    exists: z.boolean(),
    status: z.enum(attendanceStatuses).nullable(),
    attendanceType: z.enum(attendanceTypes).nullable(),
    responseStatus: z.enum(responseStatuses).nullable(),
    notes: nullableText,
    updatedAt: nullableTimestamp,
  })
  .superRefine((value, context) => {
    const complete = value.id !== null && value.updatedAt !== null;
    if (value.exists !== complete) {
      context.addIssue({
        code: "custom",
        message:
          "An existing attendance baseline requires its id and updatedAt",
      });
    }
    if (!value.exists && value.status !== null) {
      context.addIssue({
        code: "custom",
        message: "Absent attendance cannot carry a stored status",
      });
    }
  });

const meetingNotificationTargetSchema = z.strictObject({
  notificationId: uuid,
  recipientUserId: uuid,
  category: z.literal("meetings"),
  type: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(4_000),
  entityType: z.literal("meeting"),
  entityId: uuid,
  dedupeKey: z.string().trim().min(1).max(255),
  scheduledFor: timestamp,
  expectedAbsent: z.literal(true),
});
const meetingNotificationTargetsSchema = z
  .array(meetingNotificationTargetSchema)
  .max(100)
  .superRefine((targets, context) => {
    const ids = targets.map(({ notificationId }) => notificationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Notification targets must be unique",
      });
    }
    const keys = targets.map(
      ({ recipientUserId, dedupeKey }) => `${recipientUserId}:${dedupeKey}`
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "Notification recipient/dedupe targets must be unique",
      });
    }
  });

const pendingNotificationSchema = z.strictObject({
  notificationId: uuid,
  recipientUserId: uuid,
  type: z.string().trim().min(1).max(64),
  entityId: uuid,
  dedupeKey: z.string().trim().min(1).max(255),
  scheduledFor: timestamp,
  beforeStatus: z.literal("pending"),
  expectedUpdatedAt: timestamp,
});
const pendingNotificationsSchema = z
  .array(pendingNotificationSchema)
  .max(100)
  .superRefine((targets, context) => {
    const ids = targets.map(({ notificationId }) => notificationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Pending notification targets must be unique",
      });
    }
  });

const taskNotificationTargetSchema = z.strictObject({
  notificationId: uuid,
  recipientUserId: uuid,
  category: z.literal("tasks"),
  type: z.enum(["task.due", "task.overdue"]),
  title: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(4_000),
  entityType: z.literal("task"),
  entityId: uuid,
  dedupeKey: z.string().trim().min(1).max(255),
  scheduledFor: timestamp,
  expectedAbsent: z.literal(true),
});
const taskNotificationTargetsSchema = z
  .array(taskNotificationTargetSchema)
  .max(4);
const pendingTaskNotificationSchema = z.strictObject({
  notificationId: uuid,
  recipientUserId: uuid,
  type: z.enum(["task.due", "task.overdue"]),
  entityId: uuid,
  dedupeKey: z.string().trim().min(1).max(255),
  scheduledFor: timestamp,
  beforeStatus: z.literal("pending"),
  expectedUpdatedAt: timestamp,
});
const pendingTaskNotificationsSchema = z
  .array(pendingTaskNotificationSchema)
  .max(4);

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
  performedById: uuid,
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
  expectedTaskAbsent: z.boolean(),
  beforeStatus: z
    .enum(["not_started", "in_progress", "blocked", "complete"])
    .nullable(),
  expectedUpdatedAt: nullableTimestamp,
  notificationTargets: taskNotificationTargetsSchema,
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
  pendingNotifications: pendingTaskNotificationsSchema,
  notificationTargets: taskNotificationTargetsSchema,
});
const evaluationCompletionTaskSchema = z.strictObject({
  taskId: uuid,
  title: z.string().trim().min(1).max(500),
  beforeStatus: z.enum(["not_started", "in_progress", "blocked", "complete"]),
  expectedUpdatedAt: timestamp,
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
    notificationTargets: meetingNotificationTargetsSchema,
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
    notificationTargets: meetingNotificationTargetsSchema,
  }),
  addWalkInAttendeeAction: z.strictObject({
    meetingId: uuid,
    attendanceId: uuid,
    personId: uuid,
    attendanceType: z.enum(attendanceTypes),
    expectedMeetingUpdatedAt: timestamp,
    expectedPersonUpdatedAt: timestamp,
    expectedAttendanceAbsent: z.literal(true),
    notificationTargets: meetingNotificationTargetsSchema,
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
    evaluationTask: evaluationCompletionTaskSchema.nullable(),
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
    status: z.literal("planning"),
    locationId: nullableUuid,
    locationName: z.string().max(255).nullable(),
    locationAddress: z.string().max(500).nullable(),
    savedLocationId: nullableUuid,
    teamId: nullableUuid,
    meetingSubtype: z.enum(meetingSubtypes).nullable(),
    estimatedAttendance: nonnegativeInt.nullable(),
    actualAttendance: z.null(),
    durationMinutes: z.number().int().min(1).max(1440).nullable(),
    notes: nullableText,
    agenda: agendaSchema,
    meetingNumber: nonnegativeInt.nullable(),
    checklistItems: z.array(checklistCreationSchema).max(100),
    resolvedTeamMemberIds: uuidSet,
    attendanceRows: z.array(attendanceCreationSchema).max(1_000),
    notificationTargets: meetingNotificationTargetsSchema,
    expectedMeetingAbsent: z.literal(true),
    createdById: uuid,
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
    pendingNotifications: pendingNotificationsSchema,
  }),
  finalizeAttendanceAction: z.strictObject({
    meetingId: uuid,
    meetingType: z.enum(meetingTypes),
    meetingTitle: z.string().max(255).nullable(),
    meetingDatetime: timestamp,
    timezone,
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
    notificationTargets: meetingNotificationTargetsSchema,
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
    notificationTargets: meetingNotificationTargetsSchema,
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
    notificationTargets: meetingNotificationTargetsSchema,
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
    beforeAttendance: attendanceBaselineSchema,
    beforeResponse: responseBaselineSchema.nullable(),
    expectedAttendanceUpdatedAt: timestamp,
    expectedResponseUpdatedAt: nullableTimestamp,
    pendingNotifications: pendingNotificationsSchema,
    notificationTargets: meetingNotificationTargetsSchema,
  }),
  removeFromGuestListAction: z.strictObject({
    meetingId: uuid,
    personId: uuid,
    beforeAttendance: attendanceBaselineSchema,
    expectedAttendanceUpdatedAt: timestamp,
    pendingNotifications: pendingNotificationsSchema,
    notificationTargets: meetingNotificationTargetsSchema,
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
  }),
  updateMeetingAction: z
    .strictObject({
      meetingId: uuid,
      timezone,
      expectedUpdatedAt: timestamp,
      before: meetingStateSchema,
      after: meetingStateSchema,
      pendingNotifications: pendingNotificationsSchema,
      notificationTargets: meetingNotificationTargetsSchema,
    })
    .superRefine((value, context) => {
      const immutable = [
        "type",
        "meetingNumber",
        "teamId",
        "actualAttendance",
        "agenda",
      ] as const;
      for (const key of immutable) {
        if (
          JSON.stringify(value.before[key]) !== JSON.stringify(value.after[key])
        ) {
          context.addIssue({
            code: "custom",
            path: ["after", key],
            message: `${key} is not editable through the meeting form`,
          });
        }
      }
    }),
  updateMeetingStatusAction: z.strictObject({
    meetingId: uuid,
    beforeStatus: z.enum(meetingStatuses),
    afterStatus: z.enum(meetingStatuses),
    expectedUpdatedAt: timestamp,
    pendingNotifications: pendingNotificationsSchema,
    notificationTargets: meetingNotificationTargetsSchema,
  }),
  updateRsvpStatusAction: z.strictObject({
    meetingId: uuid,
    personId: uuid,
    beforeStatus: z.enum(responseStatuses).nullable(),
    afterStatus: z.enum(responseStatuses),
    expectedAttendanceUpdatedAt: timestamp,
  }),
} as const satisfies Record<MeetingsActionExport, z.ZodType>;

export type MeetingsEffectArguments<ExportName extends MeetingsActionExport> =
  z.infer<(typeof MEETINGS_EFFECT_ARGUMENT_SCHEMAS)[ExportName]>;

export function assertMeetingsEffectContractsComplete(): void {
  const exports = Object.keys(MEETINGS_ACTION_CONTRACTS).toSorted();
  const schemas = Object.keys(MEETINGS_EFFECT_ARGUMENT_SCHEMAS).toSorted();
  if (JSON.stringify(exports) !== JSON.stringify(schemas)) {
    throw new Error(
      "Meetings effect schemas do not cover authoritative actions"
    );
  }
  for (const exportName of exports as MeetingsActionExport[]) {
    const contractKeys = [
      ...MEETINGS_ACTION_CONTRACTS[exportName].argumentKeys,
    ].toSorted();
    const schemaKeys = Object.keys(
      MEETINGS_EFFECT_ARGUMENT_SCHEMAS[exportName].shape
    ).toSorted();
    if (JSON.stringify(contractKeys) !== JSON.stringify(schemaKeys)) {
      throw new Error(`Meetings argument contract drift: ${exportName}`);
    }
  }
}

assertMeetingsEffectContractsComplete();
