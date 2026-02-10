// ============================================================================
// Guest List Service
// ============================================================================
//
// Simple CRUD for the meeting guest list using the meeting_attendance table.
// People are added before the meeting, attendance is marked after.
// ============================================================================

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  meetingAttendance,
  type MeetingAttendanceRecord,
  type ResponseStatus,
} from "@/db/schema/meetings";
import { persons } from "@/db/schema/people";

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
