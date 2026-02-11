// ============================================================================
// Meeting Confirmation Token Service
// ============================================================================
//
// Generates and resolves token-based RSVP for meetings.
// Tokens are URL-safe, unique, and expire after 7 days.
// When a recipient confirms/declines via the public RSVP page,
// this service updates both the token record and the meeting invitation.
// ============================================================================

import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  meetingConfirmationTokens,
  communicationRecipients,
  communications,
  type ConfirmationStatus,
  type MeetingConfirmationToken,
} from "@/db/schema/communication";
import { invitations, meetingAttendance } from "@/db/schema/meetings";
import { churchMeetings } from "@/db/schema/meetings";
import { persons } from "@/db/schema/people";
import { churches } from "@/db/schema/church";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmationDetails {
  token: MeetingConfirmationToken;
  meeting: {
    id: string;
    title: string | null;
    type: string;
    datetime: Date;
    locationName: string | null;
    locationAddress: string | null;
  };
  person: {
    firstName: string;
    lastName: string;
  };
  church: {
    name: string;
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Generate a confirmation token for a meeting + person pair.
 * Re-uses existing token if one already exists and hasn't expired.
 * Returns the token string (not the full record).
 */
export async function createConfirmationToken(
  churchId: string,
  meetingId: string,
  personId: string,
  expiresInDays = 7
): Promise<string> {
  // Check for existing valid token
  const [existing] = await db
    .select()
    .from(meetingConfirmationTokens)
    .where(
      and(
        eq(meetingConfirmationTokens.meetingId, meetingId),
        eq(meetingConfirmationTokens.personId, personId),
        eq(meetingConfirmationTokens.status, "pending")
      )
    )
    .limit(1);

  if (existing && existing.expiresAt > new Date()) {
    return existing.token;
  }

  const token = randomBytes(12).toString("base64url");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  await db.insert(meetingConfirmationTokens).values({
    token,
    churchId,
    meetingId,
    personId,
    status: "pending",
    expiresAt,
  });

  return token;
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

/**
 * Look up a confirmation token and return full context for the RSVP page.
 * Returns null if token not found.
 */
export async function getConfirmationDetails(
  token: string
): Promise<ConfirmationDetails | null> {
  const [tokenRecord] = await db
    .select()
    .from(meetingConfirmationTokens)
    .where(eq(meetingConfirmationTokens.token, token))
    .limit(1);

  if (!tokenRecord) return null;

  const [meeting] = await db
    .select()
    .from(churchMeetings)
    .where(eq(churchMeetings.id, tokenRecord.meetingId))
    .limit(1);

  const [person] = await db
    .select()
    .from(persons)
    .where(eq(persons.id, tokenRecord.personId))
    .limit(1);

  const [church] = await db
    .select()
    .from(churches)
    .where(eq(churches.id, tokenRecord.churchId))
    .limit(1);

  if (!meeting || !person || !church) return null;

  return {
    token: tokenRecord,
    meeting: {
      id: meeting.id,
      title: meeting.title,
      type: meeting.type,
      datetime: meeting.datetime,
      locationName: meeting.locationName,
      locationAddress: meeting.locationAddress,
    },
    person: {
      firstName: person.firstName,
      lastName: person.lastName,
    },
    church: {
      name: church.name,
    },
  };
}

/**
 * Process a confirmation response (confirm or decline).
 * Updates the token record and syncs to the invitations table.
 */
export async function resolveConfirmation(
  token: string,
  response: "confirmed" | "declined"
): Promise<{ success: boolean; error?: string }> {
  const [tokenRecord] = await db
    .select()
    .from(meetingConfirmationTokens)
    .where(eq(meetingConfirmationTokens.token, token))
    .limit(1);

  if (!tokenRecord) {
    return { success: false, error: "Invalid confirmation link" };
  }

  if (tokenRecord.expiresAt < new Date()) {
    return { success: false, error: "This confirmation link has expired" };
  }

  if (tokenRecord.status !== "pending") {
    return {
      success: true, // Already responded, not an error
    };
  }

  // Update token record
  await db
    .update(meetingConfirmationTokens)
    .set({
      status: response,
      respondedAt: new Date(),
    })
    .where(eq(meetingConfirmationTokens.id, tokenRecord.id));

  // Sync to invitations table (update the invitation for this meeting + person)
  const invitationStatus = response === "confirmed" ? "confirmed" : "declined";
  await db
    .update(invitations)
    .set({
      status: invitationStatus,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(invitations.meetingId, tokenRecord.meetingId),
        eq(invitations.inviteeId, tokenRecord.personId)
      )
    );

  // Sync to meeting_attendance table (guest list RSVP)
  await db
    .update(meetingAttendance)
    .set({
      responseStatus: response,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetingAttendance.meetingId, tokenRecord.meetingId),
        eq(meetingAttendance.personId, tokenRecord.personId)
      )
    );

  // Update email tracking — the person clicked the link, so they opened + clicked
  // Find communication_recipients for this person + meeting
  try {
    const meetingComms = await db
      .select({ id: communications.id })
      .from(communications)
      .where(eq(communications.meetingId, tokenRecord.meetingId));

    if (meetingComms.length > 0) {
      const commIds = meetingComms.map((c) => c.id);
      for (const commId of commIds) {
        const [recipient] = await db
          .select()
          .from(communicationRecipients)
          .where(
            and(
              eq(communicationRecipients.communicationId, commId),
              eq(communicationRecipients.personId, tokenRecord.personId)
            )
          )
          .limit(1);

        if (recipient) {
          // Only advance status — don't regress from "clicked" to "opened"
          const statusRank: Record<string, number> = {
            pending: 0,
            sent: 1,
            delivered: 2,
            opened: 3,
            clicked: 4,
          };
          const currentRank = statusRank[recipient.status] ?? 0;
          if (currentRank < 4) {
            await db
              .update(communicationRecipients)
              .set({
                status: "clicked",
                deliveredAt: recipient.deliveredAt ?? new Date(),
                openedAt: recipient.openedAt ?? new Date(),
                clickedAt: new Date(),
              })
              .where(eq(communicationRecipients.id, recipient.id));
          }
        }
      }
    }
  } catch (err) {
    // Non-critical — don't fail the RSVP response
    console.error("[RSVP] Failed to update email tracking:", err);
  }

  return { success: true };
}

/**
 * Check if a person has responded to a meeting confirmation.
 */
export async function getConfirmationStatus(
  meetingId: string,
  personId: string
): Promise<ConfirmationStatus | null> {
  const [record] = await db
    .select()
    .from(meetingConfirmationTokens)
    .where(
      and(
        eq(meetingConfirmationTokens.meetingId, meetingId),
        eq(meetingConfirmationTokens.personId, personId)
      )
    )
    .limit(1);

  return record?.status as ConfirmationStatus | null ?? null;
}
