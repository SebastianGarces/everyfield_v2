import type { AttendanceType } from "@/db/schema";
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
  personId: string;
  churchId: string;
  attendanceType: AttendanceType;
  timestamp: Date;
}

/**
 * Event payload for meeting.attendance.finalized
 * Emitted once when all attendance is finalized for a meeting.
 * F5 (Task Management) subscribes to create follow-up tasks for new attendees.
 */
export interface MeetingAttendanceFinalizedEvent {
  type: "meeting.attendance.finalized";
  meetingId: string;
  churchId: string;
  newAttendeeIds: string[];
  totalAttendance: number;
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
  personId: string,
  churchId: string,
  attendanceType: AttendanceType
): Promise<void> {
  await eventBus.emit<MeetingAttendanceRecordedEvent>({
    type: "meeting.attendance.recorded",
    meetingId,
    personId,
    churchId,
    attendanceType,
    timestamp: new Date(),
  });
}

/**
 * Emit an event when attendance is finalized for a meeting.
 * F5 (Task Management) subscribes to create follow-up tasks for new attendees.
 */
export async function emitAttendanceFinalized(
  meetingId: string,
  churchId: string,
  newAttendeeIds: string[],
  totalAttendance: number
): Promise<void> {
  await eventBus.emit<MeetingAttendanceFinalizedEvent>({
    type: "meeting.attendance.finalized",
    meetingId,
    churchId,
    newAttendeeIds,
    totalAttendance,
    timestamp: new Date(),
  });
}

/**
 * Emit an event when a meeting is marked as completed.
 * Dashboard (F4) subscribes to update metrics.
 */
export async function emitMeetingCompleted(
  meetingId: string,
  churchId: string,
  attendanceCount: number,
  newAttendeeCount: number
): Promise<void> {
  await eventBus.emit<MeetingCompletedEvent>({
    type: "meeting.completed",
    meetingId,
    churchId,
    attendanceCount,
    newAttendeeCount,
    timestamp: new Date(),
  });
}
