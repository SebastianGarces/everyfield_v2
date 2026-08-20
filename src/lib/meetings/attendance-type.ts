// ============================================================================
// Attendance Type Derivation (F3)
// ============================================================================
//
// Derives the `attendance_type` (first_time | returning | core_group) for a
// person at a given meeting. This must be called by every code path that
// transitions a meeting_attendance row to status='attended', so analytics
// (new-vs-returning breakdowns) read non-zero values.
//
// Derivation rules (precedence: core_group rule FIRST):
//   1. person.status in {core_group, launch_team, leader} -> 'core_group'
//   2. else any PRIOR meeting (earlier datetime) where this person has a
//      meeting_attendance row with status='attended' -> 'returning'
//   3. else -> 'first_time'
// ============================================================================

import { and, eq, lt, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { churchMeetings, meetingAttendance } from "@/db/schema/meetings";
import { persons } from "@/db/schema/people";
import type { AttendanceType } from "@/db/schema/meetings";

/**
 * NO `isRecruitedContact()` HERE, and that is the decision rather than an
 * oversight (#378). The three reads that MEASURE recruiting — the dashboard's
 * core-group count, the phase engine's leadership candidates and the compose
 * form's status cohorts — exclude the planter's own person row, because a row
 * that arrived by owning the plant is not progress. This read is not one of
 * them: it classifies somebody who actually turned up at a meeting, and the
 * planter attending their own vision meeting is a real attendance with a real
 * answer. `core_group` is the honest label for it — they are not a first-timer
 * and calling them one would corrupt the new-vs-returning breakdown in the
 * other direction.
 */
const CORE_GROUP_STATUSES = ["core_group", "launch_team", "leader"] as const;

/**
 * Derive the attendance type for a person at a meeting.
 *
 * @param personId        The person being marked attended
 * @param meetingId       The meeting they are being marked attended at
 * @param meetingStartsAt The datetime of the meeting (used to find prior meetings)
 * @param database        The drizzle db instance
 */
export async function deriveAttendanceType(
  personId: string,
  meetingId: string,
  meetingStartsAt: Date,
  database: Database
): Promise<AttendanceType> {
  // Rule 1 (highest precedence): core group / launch team / leader.
  const [person] = await database
    .select({ status: persons.status })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);

  if (
    person &&
    (CORE_GROUP_STATUSES as readonly string[]).includes(person.status)
  ) {
    return "core_group";
  }

  // Rule 2: returning if they attended any earlier meeting.
  const [prior] = await database
    .select({ id: meetingAttendance.id })
    .from(meetingAttendance)
    .innerJoin(
      churchMeetings,
      eq(meetingAttendance.meetingId, churchMeetings.id)
    )
    .where(
      and(
        eq(meetingAttendance.personId, personId),
        eq(meetingAttendance.status, "attended"),
        sql`${meetingAttendance.meetingId} <> ${meetingId}`,
        lt(churchMeetings.datetime, meetingStartsAt)
      )
    )
    .limit(1);

  if (prior) {
    return "returning";
  }

  // Rule 3: otherwise this is their first time.
  return "first_time";
}
