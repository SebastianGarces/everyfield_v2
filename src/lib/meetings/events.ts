import type { AttendanceType, MeetingType } from "@/db/schema";
import { eventBus } from "@/lib/events/event-bus";

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event payload for meeting.attendance.recorded
 * Emitted per attendee when attendance is finalized.
 * F2 (People/CRM) subscribes to auto-advance person status (Prospect -> Attendee).
 */
export interface MeetingAttendanceRecordedEvent {
  type: "meeting.attendance.recorded";
  meetingId: string;
  meetingType: MeetingType;
  personId: string;
  churchId: string;
  attendanceType?: AttendanceType;
  timestamp: Date;
}

/**
 * One person who was in the room, and WHICH KIND of attendance that was.
 *
 * The pair travels together because every subscriber that acts on an attendee
 * acts on the kind: VM-007 gives a follow-up task to first-timers and to nobody
 * else (#323 WS2). Two parallel lists — ids here, first-timer ids beside them —
 * would be two things to keep in step; `attendance_type` is derived once, when
 * the register is marked (`meetings/attendance-type.ts`), and read from the
 * row. `null` is a row written before the derivation shipped: unknown, not
 * first-time.
 */
export interface FinalizedAttendee {
  personId: string;
  attendanceType: AttendanceType | null;
}

/**
 * Event payload for meeting.attendance.finalized
 * Emitted once when all attendance is finalized for a meeting.
 * F5 (Task Management) subscribes to create the follow-up + evaluation tasks.
 */
export interface MeetingAttendanceFinalizedEvent {
  type: "meeting.attendance.finalized";
  meetingId: string;
  meetingType: MeetingType;
  churchId: string;
  attendees: FinalizedAttendee[];
  totalAttendance: number;
  timestamp: Date;
}

/**
 * Event payload for meeting.evaluation.completed
 * Emitted when a meeting evaluation is submitted.
 * F5 (Task Management) subscribes to auto-complete the evaluation task.
 */
export interface MeetingEvaluationCompletedEvent {
  type: "meeting.evaluation.completed";
  meetingId: string;
  churchId: string;
  evaluatedById: string;
  timestamp: Date;
}

/**
 * Event payload for meeting.completed
 * Emitted when a meeting status is set to completed.
 * Dashboard (F4) subscribes to update metrics.
 */
export interface MeetingCompletedEvent {
  type: "meeting.completed";
  meetingId: string;
  meetingType: MeetingType;
  churchId: string;
  attendanceCount: number;
  newAttendeeCount: number;
  timestamp: Date;
}

// ============================================================================
// Event Emission
// ============================================================================

/**
 * Emit an event when attendance is recorded for a single attendee.
 * F2 (People/CRM) subscribes to auto-advance person status (Prospect -> Attendee).
 */
export async function emitAttendanceRecorded(
  meetingId: string,
  meetingType: MeetingType,
  personId: string,
  churchId: string,
  attendanceType?: AttendanceType
): Promise<void> {
  await eventBus.emit<MeetingAttendanceRecordedEvent>({
    type: "meeting.attendance.recorded",
    meetingId,
    meetingType,
    personId,
    churchId,
    attendanceType,
    timestamp: new Date(),
  });
}

/**
 * Emit an event when attendance is finalized for a meeting.
 * F5 (Task Management) subscribes to create follow-up tasks for all attendees.
 *
 * Emitted STRICTLY: `finalizeAttendance` only marks a meeting finalized once
 * this resolves, so a handler failure has to be visible to the caller.
 * Swallowing it would let a meeting be marked finalized with no follow-up tasks
 * and no way to notice. Handlers are still all executed (see `emit`); the
 * strict flag only decides whether the emitter is told about failures.
 */
export async function emitAttendanceFinalized(
  meetingId: string,
  meetingType: MeetingType,
  churchId: string,
  attendees: FinalizedAttendee[],
  totalAttendance: number
): Promise<void> {
  await eventBus.emit<MeetingAttendanceFinalizedEvent>(
    {
      type: "meeting.attendance.finalized",
      meetingId,
      meetingType,
      churchId,
      attendees,
      totalAttendance,
      timestamp: new Date(),
    },
    { strict: true }
  );
}

/**
 * Emit an event when a meeting evaluation is submitted.
 * F5 (Task Management) subscribes to auto-complete the evaluation task.
 */
export async function emitEvaluationCompleted(
  meetingId: string,
  churchId: string,
  evaluatedById: string
): Promise<void> {
  await eventBus.emit<MeetingEvaluationCompletedEvent>({
    type: "meeting.evaluation.completed",
    meetingId,
    churchId,
    evaluatedById,
    timestamp: new Date(),
  });
}

/**
 * Emit an event when a meeting is marked as completed.
 * Dashboard (F4) subscribes to update metrics.
 */
export async function emitMeetingCompleted(
  meetingId: string,
  meetingType: MeetingType,
  churchId: string,
  attendanceCount: number,
  newAttendeeCount: number
): Promise<void> {
  await eventBus.emit<MeetingCompletedEvent>({
    type: "meeting.completed",
    meetingId,
    meetingType,
    churchId,
    attendanceCount,
    newAttendeeCount,
    timestamp: new Date(),
  });
}
