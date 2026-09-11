import { z } from "zod";

import {
  activeMeetingNotificationSchema,
  meetingNotificationTargetsSchema,
} from "./effect-contracts";

const uuid = z.string().uuid();
const timestamp = z.string().datetime();
const uuidSet = z.array(uuid).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: "IDs must be unique" });
  }
});

export const MEETING_CREATE_DEPENDENCY_OUTPUT_SCHEMA = z.strictObject({
  kind: z.literal("meetings.create.output.v1"),
  meetingId: uuid,
  expectedMeetingUpdatedAt: timestamp,
  activeNotifications: z.array(activeMeetingNotificationSchema),
});

const guestTargetSchema = z.strictObject({
  attendanceId: uuid,
  personId: uuid,
  label: z.string().trim().min(1).max(511),
  email: z.string().email().max(255),
  expectedPersonUpdatedAt: timestamp,
  expectedAttendanceAbsent: z.literal(true),
});

const guestExclusionSchema = z.strictObject({
  personId: uuid,
  label: z.string().trim().min(1).max(511),
  reason: z.enum([
    "Missing email address",
    "Prior Vision Meeting attendance",
    "Duplicate email address",
    "Suppressed email address",
  ]),
});

export const MEETING_GUEST_BATCH_ARGUMENT_SCHEMA = z
  .strictObject({
    mode: z.literal("batch-after-create"),
    meetingId: uuid,
    dependencyStepId: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
    targets: z.array(guestTargetSchema).min(1).max(1_000),
    exclusions: z.array(guestExclusionSchema).max(10_000),
    expectedCoreGroupUserIds: uuidSet,
    expectedReminderUserIds: uuidSet,
    notificationTargets: meetingNotificationTargetsSchema,
  })
  .superRefine((value, context) => {
    const attendanceIds = value.targets.map(({ attendanceId }) => attendanceId);
    const personIds = value.targets.map(({ personId }) => personId);
    if (new Set(attendanceIds).size !== attendanceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Attendance IDs must be unique",
      });
    }
    if (new Set(personIds).size !== personIds.length) {
      context.addIssue({ code: "custom", message: "Guest IDs must be unique" });
    }
    if (
      value.notificationTargets.some(
        ({ entityId }) => entityId !== value.meetingId
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Notification targets must belong to the planned meeting",
      });
    }
  });

export type MeetingCreateDependencyOutput = Readonly<
  z.infer<typeof MEETING_CREATE_DEPENDENCY_OUTPUT_SCHEMA>
>;
export type MeetingGuestBatchArguments = Readonly<
  z.infer<typeof MEETING_GUEST_BATCH_ARGUMENT_SCHEMA>
>;
