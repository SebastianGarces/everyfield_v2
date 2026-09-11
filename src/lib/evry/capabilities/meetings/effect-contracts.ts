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
import { notificationStatuses } from "@/db/schema/notifications";
import { personStatuses } from "@/db/schema/people";
import { taskPriorities } from "@/db/schema/tasks";
import {
  MAX_AGENDA_SECTIONS,
  MAX_SECTION_MINUTES,
  MAX_SECTION_TITLE_LENGTH,
} from "@/lib/meetings/agenda";
import { meetingDisplayTitle } from "@/lib/meetings/labels";
import { CHURCH_LEADERSHIP_STATUSES } from "@/lib/onboarding/leadership";

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
const uuidSet = z.array(uuid).superRefine((values, context) => {
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
export const meetingNotificationTargetsSchema = z
  .array(meetingNotificationTargetSchema)
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
  .superRefine((targets, context) => {
    const ids = targets.map(({ notificationId }) => notificationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Pending notification targets must be unique",
      });
    }
  });

export const activeMeetingNotificationSchema = z.strictObject({
  notificationId: uuid,
  recipientUserId: uuid,
  type: z.string().trim().min(1).max(64),
  entityId: uuid,
  dedupeKey: z.string().trim().min(1).max(255),
  scheduledFor: timestamp,
  status: z.enum(notificationStatuses).refine((value) => value !== "cancelled"),
  expectedUpdatedAt: timestamp,
});
export const notificationPlanBaselineSchema = z.strictObject({
  coreGroupUserIds: uuidSet,
  reminderUserIds: uuidSet,
  activeNotifications: z.array(activeMeetingNotificationSchema),
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
  .superRefine((targets, context) => {
    const ids = targets.map(({ notificationId }) => notificationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Pending task notification baselines must be unique",
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
  performedById: uuid,
});

const score = z.number().int().min(1).max(5);
const priorAttendedMeetingSchema = z.strictObject({
  attendanceId: uuid,
  meetingId: uuid,
  meetingDatetime: timestamp,
});

const attendanceDerivationBaselineSchema = z.strictObject({
  personStatus: z.enum(personStatuses),
  meetingDatetime: timestamp,
  priorAttendances: z
    .array(priorAttendedMeetingSchema)
    .max(1_000)
    .superRefine((rows, context) => {
      const attendanceIds = rows.map(({ attendanceId }) => attendanceId);
      const meetingIds = rows.map(({ meetingId }) => meetingId);
      if (
        new Set(attendanceIds).size !== rows.length ||
        new Set(meetingIds).size !== rows.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Prior attendance baselines must be unique",
        });
      }
    }),
});

const attendanceRecordChangeSchema = z
  .strictObject({
    attendanceId: uuid,
    personId: uuid,
    before: attendanceBaselineSchema,
    afterStatus: z.enum(attendanceStatuses),
    afterAttendanceType: z.enum(attendanceTypes).nullable(),
    attendanceDerivation: attendanceDerivationBaselineSchema.nullable(),
  })
  .superRefine((value, context) => {
    const attended = value.afterStatus === "attended";
    if (
      attended !==
      (value.afterAttendanceType !== null &&
        value.attendanceDerivation !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Attended records require one complete derivation baseline",
      });
    }
  });
const taskTargetState = {
  taskId: uuid,
  title: z.string().trim().min(1).max(500),
  dueDate: z.string().date(),
  assignedToId: nullableUuid,
  priority: z.enum(taskPriorities),
  expectedTaskAbsent: z.boolean(),
  beforeStatus: z
    .enum(["not_started", "in_progress", "blocked", "complete"])
    .nullable(),
  expectedUpdatedAt: nullableTimestamp,
  notificationBaseline: pendingTaskNotificationsSchema,
} as const;

function refineTaskTarget(
  value: {
    taskId: string;
    assignedToId: string | null;
    priority: (typeof taskPriorities)[number];
    expectedTaskAbsent: boolean;
    beforeStatus: string | null;
    expectedUpdatedAt: string | null;
    notificationBaseline: readonly Readonly<{ entityId: string }>[];
    notificationTargets: readonly Readonly<{ entityId: string }>[];
  },
  context: z.RefinementCtx
) {
  const newTask = value.expectedTaskAbsent;
  if (
    (newTask &&
      (value.beforeStatus !== null || value.expectedUpdatedAt !== null)) ||
    (!newTask &&
      (value.beforeStatus === null || value.expectedUpdatedAt === null))
  ) {
    context.addIssue({
      code: "custom",
      message: "Task target state must identify one new or retained row",
    });
  }
  if (newTask && (value.assignedToId === null || value.priority !== "high")) {
    context.addIssue({
      code: "custom",
      message:
        "New finalization tasks require the canonical high-priority assignee",
    });
  }
  if (
    (newTask && value.notificationBaseline.length > 0) ||
    (!newTask && value.notificationTargets.length > 0)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "New task targets schedule notifications; retained task targets snapshot them",
    });
  }
  if (
    [...value.notificationBaseline, ...value.notificationTargets].some(
      ({ entityId }) => entityId !== value.taskId
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Task notification entity IDs must match their task target",
    });
  }
}

const followUpTargetSchema = z
  .strictObject({
    ...taskTargetState,
    personId: uuid,
    notificationTargets: taskNotificationTargetsSchema,
  })
  .superRefine(refineTaskTarget);
const evaluationTaskTargetSchema = z
  .strictObject({
    ...taskTargetState,
    notificationTargets: taskNotificationTargetsSchema,
  })
  .superRefine(refineTaskTarget);
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
    attendanceType: z.enum(attendanceTypes),
    attendanceDerivation: attendanceDerivationBaselineSchema,
    status: z.literal("attended"),
    invitedById: nullableUuid,
    responseStatus: z.enum(responseStatuses).nullable(),
    notes: nullableText,
    expectedMeetingUpdatedAt: timestamp,
    expectedPersonUpdatedAt: timestamp,
    expectedAttendanceAbsent: z.literal(true),
    notificationBaseline: notificationPlanBaselineSchema,
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
    notificationBaseline: notificationPlanBaselineSchema,
    notificationTargets: meetingNotificationTargetsSchema,
  }),
  addWalkInAttendeeAction: z.strictObject({
    meetingId: uuid,
    attendanceId: uuid,
    personId: uuid,
    attendanceType: z.enum(attendanceTypes),
    attendanceDerivation: attendanceDerivationBaselineSchema,
    expectedMeetingUpdatedAt: timestamp,
    expectedPersonUpdatedAt: timestamp,
    expectedAttendanceAbsent: z.literal(true),
    notificationBaseline: notificationPlanBaselineSchema,
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
  createMeetingAction: z
    .strictObject({
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
      notificationBaseline: notificationPlanBaselineSchema,
      notificationTargets: meetingNotificationTargetsSchema,
      expectedMeetingAbsent: z.literal(true),
      createdById: uuid,
    })
    .superRefine((value, context) => {
      if (value.type === "vision_meeting") {
        if (
          !value.meetingNumber ||
          value.title !==
            meetingDisplayTitle({
              type: value.type,
              title: null,
              meetingNumber: value.meetingNumber,
              teamName: null,
            })
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Numbered vision meetings require their canonical generated title",
          });
        }
      } else if (value.meetingNumber !== null) {
        context.addIssue({
          code: "custom",
          message: "Only vision meetings may have a meeting number",
        });
      }
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
    expectedConfirmationTokenIds: uuidSet,
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
    expectedTaskAssigneeId: nullableUuid,
    expectedLeadershipStatus: z.enum(CHURCH_LEADERSHIP_STATUSES).nullable(),
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
    notificationBaseline: notificationPlanBaselineSchema,
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
    notificationBaseline: notificationPlanBaselineSchema,
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
    notificationBaseline: notificationPlanBaselineSchema,
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
    notificationBaseline: notificationPlanBaselineSchema,
    notificationTargets: meetingNotificationTargetsSchema,
  }),
  removeFromGuestListAction: z.strictObject({
    meetingId: uuid,
    personId: uuid,
    beforeAttendance: attendanceBaselineSchema,
    expectedAttendanceUpdatedAt: timestamp,
    pendingNotifications: pendingNotificationsSchema,
    notificationBaseline: notificationPlanBaselineSchema,
    notificationTargets: meetingNotificationTargetsSchema,
  }),
  saveAgendaAction: z.strictObject({
    meetingId: uuid,
    expectedUpdatedAt: timestamp,
    beforeSections: agendaSchema,
    afterSections: agendaSchema,
  }),
  toggleAttendanceStatusAction: z
    .strictObject({
      meetingId: uuid,
      personId: uuid,
      beforeStatus: z.enum(attendanceStatuses),
      afterStatus: z.enum(attendanceStatuses),
      afterAttendanceType: z.enum(attendanceTypes).nullable(),
      attendanceDerivation: attendanceDerivationBaselineSchema.nullable(),
      expectedAttendanceUpdatedAt: timestamp,
    })
    .superRefine((value, context) => {
      const attended = value.afterStatus === "attended";
      if (
        attended !==
        (value.afterAttendanceType !== null &&
          value.attendanceDerivation !== null)
      ) {
        context.addIssue({
          code: "custom",
          message: "Attended transitions require one derivation baseline",
        });
      }
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
      notificationBaseline: notificationPlanBaselineSchema,
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
      if (value.before.type === "vision_meeting") {
        const canonicalTitle =
          value.before.meetingNumber === null
            ? null
            : meetingDisplayTitle({
                type: value.before.type,
                title: null,
                meetingNumber: value.before.meetingNumber,
                teamName: null,
              });
        if (value.after.title !== canonicalTitle) {
          context.addIssue({
            code: "custom",
            path: ["after", "title"],
            message:
              "Numbered vision meetings require their canonical generated title",
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
    notificationBaseline: notificationPlanBaselineSchema,
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
