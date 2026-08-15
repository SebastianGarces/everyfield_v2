// ============================================================================
// Guest List Service
// ============================================================================
//
// Simple CRUD for the meeting guest list using the meeting_attendance table.
// People are added before the meeting, attendance is marked after.
//
// THE GUEST LIST IS THE REMINDER AUDIENCE (VM-018 Workflow 2), so every write
// that changes it re-syncs the meeting's notifications. It is not a nicety: a
// vision meeting's guest list starts EMPTY and is filled afterwards (see
// VM-006 below), so an audience frozen at create time would be permanently
// `[createdBy]` for the flagship meeting type and no invited guest would ever
// be reminded. Removal needs the same call in the other direction —
// `cancelByEntity` is entity-wide and has no per-recipient form, so the only
// way to drop one person's pending reminders is to re-enqueue the audience
// without them.
//
// The re-sync swallows its own failures (`notifications.ts`), so it can never
// fail the guest write it follows, and it runs AFTER that write for the same
// reason.
// ============================================================================

import { and, eq, isNull } from "drizzle-orm";
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

import { syncMeetingNotifications } from "./notifications";

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
 *
 * Re-syncs the meeting's reminders afterwards: a guest invited after the
 * meeting was created is the NORMAL path for a vision meeting, and they are owed
 * every offset still in the future (VM-018 Workflow 2).
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

    // Re-synced even on the conflict path: the row already existing says
    // nothing about whether this person's reminders were ever enqueued, and the
    // sync is idempotent (the re-enqueue is absorbed by the dedupe keys).
    await syncMeetingNotifications(churchId, meetingId, { mustCancel: false });
    return existing;
  }

  // `mustCancel: false`, deliberately: ADDING a guest owes no cancel. The
  // audience is re-read and re-enqueued either way, every recipient already on
  // it is absorbed by their own dedupe keys, and the new guest has no row to
  // collide with — so the cancel would only re-mint every pending row's id and
  // buy a second write per recipient on a plant-sized Core Group.
  await syncMeetingNotifications(churchId, meetingId, { mustCancel: false });

  return record;
}

/**
 * Remove a person from the guest list.
 *
 * Re-syncs for the same reason `addToGuestList` does, in the other direction:
 * `cancelByEntity` cancels a meeting's rows for EVERY recipient, so cancelling
 * and re-enqueuing the audience without this person is the only way their
 * pending reminders stop.
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

  // `mustCancel: true` — this is the direction that needs it. `cancelByEntity`
  // has no per-recipient form, so dropping the meeting's pending rows and
  // re-enqueuing the audience without this person is the only way their
  // reminders stop.
  await syncMeetingNotifications(churchId, meetingId, { mustCancel: true });
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
// That read is NOT here. `guestListUserIdsQuery` / `listGuestListUserIds` live
// in `./notifications` beside the Core Group read they share a person↔user
// bridge with, because this module now calls that one and the graph must stay
// acyclic. The bridge itself has exactly one spelling, in
// `@/lib/people/person-user`.

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
