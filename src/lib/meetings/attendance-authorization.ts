import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { churchMeetings, type ChurchMeeting } from "@/db/schema/meetings";
import { persons } from "@/db/schema/people";
import { holdsSeatFor, SeatRefusalError } from "@/lib/auth/seat-rules";
import type { SeatFields } from "@/lib/auth/tenancy";
import { mayManageTeam } from "@/lib/ministry-teams/authorization";

type AttendanceActor = SeatFields & { id: string };
type AttendanceMeeting = Pick<ChurchMeeting, "churchId" | "type" | "teamId">;

/** Attendance is a team leader's duty; it grants no meeting or RSVP administration. */
export async function mayRecordMeetingAttendance(
  user: AttendanceActor,
  meeting: AttendanceMeeting
): Promise<boolean> {
  if (
    !holdsSeatFor(user, "meetings.attendance") ||
    user.churchId !== meeting.churchId
  )
    return false;
  if (holdsSeatFor(user, "meetings.write")) return true;
  return (
    meeting.type === "team_meeting" &&
    meeting.teamId !== null &&
    mayManageTeam(user, meeting.teamId)
  );
}

export async function requireAttendanceWrite(
  user: AttendanceActor,
  meetingId: string
): Promise<void> {
  if (
    holdsSeatFor(user, "meetings.attendance") &&
    user.churchId &&
    z.string().uuid().safeParse(meetingId).success
  ) {
    const [meeting] = await db
      .select({
        churchId: churchMeetings.churchId,
        type: churchMeetings.type,
        teamId: churchMeetings.teamId,
      })
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.churchId, user.churchId),
          eq(churchMeetings.id, meetingId)
        )
      )
      .limit(1);
    if (meeting && (await mayRecordMeetingAttendance(user, meeting))) return;
  }
  throw new SeatRefusalError("meetings.attendance");
}

/** Validate the entire batch before its first effect, including optional inviter references. */
export async function requireAttendancePeople(
  churchId: string,
  personIds: string[]
): Promise<void> {
  const parsed = z.array(z.string().uuid()).nonempty().safeParse(personIds);
  if (!parsed.success) throw new SeatRefusalError("meetings.attendance");
  const ids = [...new Set(parsed.data)];
  const rows = await db
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        inArray(persons.id, ids),
        isNull(persons.deletedAt)
      )
    );
  if (rows.length !== ids.length)
    throw new SeatRefusalError("meetings.attendance");
}
