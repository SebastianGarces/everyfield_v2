// ============================================================================
// Guest List Service
// ============================================================================
//
// Simple CRUD for the meeting guest list using the meeting_attendance table.
// People are added before the meeting, attendance is marked after.
// ============================================================================

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  meetingAttendance,
  type MeetingAttendanceRecord,
  type MeetingType,
  type NewMeetingAttendanceRecord,
  type ResponseStatus,
} from "@/db/schema/meetings";
import { persons } from "@/db/schema/people";
import { teamMemberships } from "@/db/schema/ministry-teams";
import { users } from "@/db/schema/user";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuestListEntry {
  id: string;
  personId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  attendanceStatus: string;
  responseStatus: string | null;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Get the full guest list for a meeting with person details.
 */
export async function getGuestList(
  churchId: string,
  meetingId: string
): Promise<GuestListEntry[]> {
  const rows = await db
    .select({
      id: meetingAttendance.id,
      personId: meetingAttendance.personId,
      firstName: persons.firstName,
      lastName: persons.lastName,
      email: persons.email,
      phone: persons.phone,
      attendanceStatus: meetingAttendance.status,
      responseStatus: meetingAttendance.responseStatus,
    })
    .from(meetingAttendance)
    .innerJoin(persons, eq(meetingAttendance.personId, persons.id))
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.meetingId, meetingId)
      )
    );

  return rows;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Add a person to the guest list.
 * Uses upsert to handle duplicates gracefully.
 */
export async function addToGuestList(
  churchId: string,
  meetingId: string,
  personId: string,
  userId: string
): Promise<MeetingAttendanceRecord> {
  const [record] = await db
    .insert(meetingAttendance)
    .values({
      churchId,
      meetingId,
      personId,
      status: "absent", // default — toggled to "attended" on the attendance page
      createdBy: userId,
    })
    .onConflictDoNothing({
      target: [meetingAttendance.meetingId, meetingAttendance.personId],
    })
    .returning();

  // If conflict (already exists), fetch the existing record
  if (!record) {
    const [existing] = await db
      .select()
      .from(meetingAttendance)
      .where(
        and(
          eq(meetingAttendance.meetingId, meetingId),
          eq(meetingAttendance.personId, personId)
        )
      )
      .limit(1);
    return existing;
  }

  return record;
}

/**
 * Remove a person from the guest list.
 */
export async function removeFromGuestList(
  churchId: string,
  meetingId: string,
  personId: string
): Promise<void> {
  await db
    .delete(meetingAttendance)
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.meetingId, meetingId),
        eq(meetingAttendance.personId, personId)
      )
    );
}

// ---------------------------------------------------------------------------
// VM-006 — the team roster as a guest list
// ---------------------------------------------------------------------------
//
// A team meeting is a meeting OF a team, so its guest list starts as that
// team's roster instead of as an empty list the planter re-types every week.
//
// Three things this must not do, each of them a separate piece below:
//
//  1. Duplicate anybody. A person holding two roles on one team has two
//     `team_memberships` rows, and a meeting created twice (double-submitted
//     form) would re-add everyone. `selectDistinct` collapses the first,
//     `dedupePersonIds` collapses it again in memory for a caller that builds
//     rows itself, and the INSERT leans on the DATABASE for the second:
//     `meeting_attendance_meeting_person_unique` with `ON CONFLICT DO NOTHING`.
//     `memory/invariants.md` → Transactions: a read is not a concurrency guard,
//     so the uniqueness is never the SELECT's job.
//  2. Invite people who are not on the team any more. Membership `status` is
//     three-valued (`active` / `inactive` / `pending`); only `active` is a
//     member today. A soft-deleted person is not on the roster either.
//  3. Touch a non-team meeting. `shouldPopulateGuestListFromTeam` is the one
//     gate, so a vision meeting keeps its own empty-then-invited guest list.

/**
 * Does this meeting get its team's roster? A `team_meeting` WITH a team does;
 * everything else does not. Both halves matter — `meetingCreateSchema` requires
 * a `teamId` for a team meeting, but the column is nullable and older rows
 * predate that rule.
 */
export function shouldPopulateGuestListFromTeam(
  type: MeetingType,
  teamId: string | null | undefined
): teamId is string {
  return type === "team_meeting" && Boolean(teamId);
}

/**
 * Collapse repeated person ids, keeping first-seen order.
 *
 * One person can hold several roles on the same team, which is several
 * `team_memberships` rows and the same guest twice.
 */
export function dedupePersonIds(
  rows: { personId: string }[] | string[]
): string[] {
  const ids = rows.map((row) => (typeof row === "string" ? row : row.personId));
  return [...new Set(ids)];
}

/**
 * The roster read behind the auto-populated guest list: the ACTIVE members of
 * one team, in one church, excluding soft-deleted people.
 *
 * Returned as a query builder rather than rows so the tenancy of the read can
 * be asserted with `.toSQL()` (the technique `src/lib/wiki/tenancy.test.ts`
 * uses) without a database.
 */
export function activeTeamMemberIdsQuery(churchId: string, teamId: string) {
  return db
    .selectDistinct({ personId: teamMemberships.personId })
    .from(teamMemberships)
    .innerJoin(persons, eq(teamMemberships.personId, persons.id))
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.status, "active"),
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt)
      )
    );
}

/**
 * The person ids of a team's active members, each one once.
 */
export async function listActiveTeamMemberIds(
  churchId: string,
  teamId: string
): Promise<string[]> {
  const rows = await activeTeamMemberIdsQuery(churchId, teamId);
  return dedupePersonIds(rows);
}

/**
 * Build the guest-list rows for a set of people.
 *
 * `status: "absent"` is the guest-list default `addToGuestList` also uses — a
 * guest list is who was invited, and attendance is marked after the meeting.
 */
export function buildTeamGuestListRows(
  churchId: string,
  meetingId: string,
  personIds: string[],
  userId: string
): NewMeetingAttendanceRecord[] {
  return dedupePersonIds(personIds).map((personId) => ({
    churchId,
    meetingId,
    personId,
    status: "absent" as const,
    createdBy: userId,
  }));
}

/**
 * Put a set of people on a meeting's guest list in one INSERT.
 *
 * Idempotent: re-running it adds nobody a second time — the meeting/person
 * unique index refuses the repeat and `DO NOTHING` makes that a no-op rather
 * than an error. Returns how many guests were actually added, so a caller can
 * tell "nobody to add" from "they were all on the list already".
 */
export async function addTeamMembersToGuestList(
  churchId: string,
  meetingId: string,
  personIds: string[],
  userId: string
): Promise<number> {
  const rows = buildTeamGuestListRows(churchId, meetingId, personIds, userId);
  if (rows.length === 0) return 0;

  const inserted = await db
    .insert(meetingAttendance)
    .values(rows)
    .onConflictDoNothing({
      target: [meetingAttendance.meetingId, meetingAttendance.personId],
    })
    .returning({ id: meetingAttendance.id });

  return inserted.length;
}

// ---------------------------------------------------------------------------
// VM-018 — which guests can actually be NOTIFIED
// ---------------------------------------------------------------------------
//
// A guest list is a list of PEOPLE; F11 addresses USERS ("a `person` with no
// login is not a recipient" — `enqueue.ts`). Most guests are neither, and never
// will be: a vision-meeting invitee is a contact in the CRM, not an account.
// So a reminder can only reach the guests who also hold a login in this plant,
// and the bridge between the two records is the ADDRESS they share.
//
// It is a bridge, not an identity claim. Two rails keep it honest:
//
//   1. BOTH SIDES ARE SCOPED TO THE SAME CHURCH. A person and a user matching
//      on address across tenants would mail one plant's meeting to another
//      plant's planter, and tenant isolation here is application-layer
//      (`memory/invariants.md` → Multi-Tenancy) — so the church id is in the
//      JOIN and in the WHERE, never inferred from the meeting id.
//   2. `enqueue` RE-ASKS THE QUESTION. Whatever this returns, gate 1 of
//      `recipientMayBeNotified` resolves the recipient's own access to the
//      church and skips anyone who fails it. This read decides WHO to offer;
//      it does not decide who is allowed.
//
// Addresses are compared case-insensitively because `users.email` is stored
// lowercased (`src/lib/invitations/core.ts`) while `persons.email` is typed by
// hand and is not. A NULL person address matches nothing, which is the correct
// answer rather than an accident.

/**
 * The users on a meeting's guest list, as a query builder.
 *
 * Un-awaited so the tenancy of the read can be asserted with `.toSQL()`
 * without a database — the same technique `activeTeamMemberIdsQuery` above is
 * shaped for.
 */
export function guestListUserIdsQuery(churchId: string, meetingId: string) {
  return db
    .selectDistinct({ userId: users.id })
    .from(meetingAttendance)
    .innerJoin(persons, eq(meetingAttendance.personId, persons.id))
    .innerJoin(
      users,
      and(
        eq(users.churchId, churchId),
        sql`lower(${users.email}) = lower(${persons.email})`
      )
    )
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.meetingId, meetingId),
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt),
        isNotNull(persons.email)
      )
    );
}

/** The user ids of everyone on a meeting's guest list who holds a login. */
export async function listGuestListUserIds(
  churchId: string,
  meetingId: string
): Promise<string[]> {
  const rows = await guestListUserIdsQuery(churchId, meetingId);
  return [...new Set(rows.map((row) => row.userId))];
}

/**
 * Update RSVP status (confirmed/declined) for a guest.
 */
export async function updateRsvpStatus(
  churchId: string,
  meetingId: string,
  personId: string,
  status: ResponseStatus
): Promise<void> {
  await db
    .update(meetingAttendance)
    .set({
      responseStatus: status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.meetingId, meetingId),
        eq(meetingAttendance.personId, personId)
      )
    );
}
