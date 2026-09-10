import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  churchMeetings,
  meetingAttendance,
  invitations,
} from "@/db/schema/meetings";
import { meetingConfirmationTokens } from "@/db/schema/communication";
import { persons } from "@/db/schema/people";
import { assertSeatFor, holdsSeatFor } from "@/lib/auth/seat-rules";
import type { SeatFields } from "@/lib/auth/tenancy";
import type { OwnRsvpResponse } from "./own-rsvp-input";

type RsvpActor = SeatFields & { id: string };

/** No person identifier or account link crosses the client boundary. */
export async function getOwnRsvp(actor: RsvpActor, meetingId: string) {
  if (!holdsSeatFor(actor, "meetings.rsvp") || !actor.churchId) return null;
  const [row] = await db
    .select({ response: meetingAttendance.responseStatus })
    .from(meetingAttendance)
    .innerJoin(persons, eq(persons.id, meetingAttendance.personId))
    .innerJoin(
      churchMeetings,
      eq(churchMeetings.id, meetingAttendance.meetingId)
    )
    .where(
      and(
        eq(meetingAttendance.churchId, actor.churchId),
        eq(churchMeetings.churchId, actor.churchId),
        eq(persons.churchId, actor.churchId),
        eq(persons.userId, actor.id),
        isNull(persons.deletedAt),
        eq(meetingAttendance.meetingId, meetingId)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Membership and identity qualify the UPDATE itself, not an earlier read.
 * Related response writes depend on its RETURNING row, so refusal writes nothing.
 * Attendance status/type/notes and email delivery tracking are never written.
 */
export async function saveOwnRsvp(
  actor: RsvpActor,
  meetingId: string,
  response: OwnRsvpResponse
): Promise<boolean> {
  assertSeatFor(actor, "meetings.rsvp");
  const result = await db.execute(sql`
    with locked_tokens as materialized (
      select token.id
      from ${meetingConfirmationTokens} as token
      join ${persons} as person on person.id = token.person_id
      where token.meeting_id = ${meetingId}
        and token.church_id = ${actor.churchId}
        and person.church_id = token.church_id
        and person.user_id = ${actor.id}
        and person.deleted_at is null
      order by token.id
      for update of token
    ), answered as (
      update ${meetingAttendance} as guest
      set response_status = ${response}, updated_at = now()
      from ${persons} as person, ${churchMeetings} as meeting
      where guest.meeting_id = ${meetingId}
        and guest.church_id = ${actor.churchId}
        and person.id = guest.person_id
        and person.church_id = guest.church_id
        and person.user_id = ${actor.id}
        and person.deleted_at is null
        and meeting.id = guest.meeting_id
        and meeting.church_id = guest.church_id
        and (select count(*) from locked_tokens) >= 0
      returning guest.person_id, guest.meeting_id, guest.church_id
    ), token_answers as (
      update ${meetingConfirmationTokens} as token
      set status = ${response}, responded_at = now()
      from answered
      where token.status = 'pending'
        and token.person_id = answered.person_id
        and token.meeting_id = answered.meeting_id
        and token.church_id = answered.church_id
    ), invitation_answers as (
      update ${invitations} as invitation
      set status = ${response}, updated_at = now()
      from answered
      where invitation.invitee_id = answered.person_id
        and invitation.meeting_id = answered.meeting_id
        and invitation.church_id = answered.church_id
    )
    select person_id from answered
  `);
  return result.rows.length === 1;
}
