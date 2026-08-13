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
import { and, eq, sql } from "drizzle-orm";
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
import { RECIPIENT_STATUS_RANK, isUnreachableStatus } from "./queries";

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

/** The one pending token for a (meeting, person) pair, if there is one. */
async function findPendingToken(
  meetingId: string,
  personId: string
): Promise<MeetingConfirmationToken | undefined> {
  const [pending] = await db
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
  return pending;
}

/**
 * Generate a confirmation token for a meeting + person pair.
 * Re-uses the existing token if one is still awaiting an answer.
 * Returns the token string (not the full record).
 *
 * ONE UNANSWERED TOKEN PER PAIR, AND THE DATABASE IS WHAT SAYS SO (#407 D2,
 * migration 0038). `sendCommunication` calls this once per recipient, so the
 * old shape — read "is there a live pending token?", then INSERT — minted a
 * second pending row for every person on any second send of one meeting
 * invitation, and the planter's tracking showed two unanswered RSVPs for one
 * invitee. `memory/invariants.md` → Transactions names it: SELECT-then-INSERT
 * is not a concurrency guard.
 *
 * THE WRITE IS ONE STATEMENT and it has three outcomes, which is why it is an
 * upsert rather than `DO NOTHING`:
 *
 *   - the slot is free       → the fresh token is inserted and returned;
 *   - the slot holds an EXPIRED pending row → that SAME row is renewed in
 *     place (`setWhere` on `expires_at <= now()`), so a renewal cannot add a
 *     second row the way the old expiry branch did;
 *   - the slot holds a LIVE pending row → `setWhere` is false, nothing is
 *     written, `returning()` is empty, and the live token is re-read below.
 *
 * An empty `returning()` is not an error (`memory/invariants.md` →
 * Transactions). The re-read is the second half of the guard: without it every
 * loser of a race, and every ordinary second send, would get no token at all.
 */
export async function createConfirmationToken(
  churchId: string,
  meetingId: string,
  personId: string,
  expiresInDays = 7
): Promise<string> {
  return claimConfirmationToken(
    churchId,
    meetingId,
    personId,
    expiresInDays,
    2
  );
}

/**
 * `attemptsLeft` bounds the "answered between the upsert and the read" retry.
 * That window needs a third party to answer the RSVP in the microseconds
 * between two statements, so one retry is already generous — but a loop with no
 * ceiling is a loop, and this one runs inside a per-recipient send.
 */
async function claimConfirmationToken(
  churchId: string,
  meetingId: string,
  personId: string,
  expiresInDays: number,
  attemptsLeft: number
): Promise<string> {
  const token = randomBytes(12).toString("base64url");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  const [written] = await db
    .insert(meetingConfirmationTokens)
    .values({
      token,
      churchId,
      meetingId,
      personId,
      status: "pending",
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [
        meetingConfirmationTokens.meetingId,
        meetingConfirmationTokens.personId,
      ],
      // The index predicate, repeated byte for byte — a mismatch is "there is
      // no unique or exclusion constraint matching the ON CONFLICT
      // specification" on every send.
      targetWhere: sql`${meetingConfirmationTokens.status} = 'pending'`,
      set: { token, expiresAt, churchId },
      // Renew ONLY what has lapsed. A live token is in somebody's inbox and
      // overwriting it would break the link they were sent.
      setWhere: sql`${meetingConfirmationTokens.expiresAt} <= now()`,
    })
    .returning();

  if (written) return written.token;

  const pending = await findPendingToken(meetingId, personId);
  if (pending) return pending.token;

  // The holder was answered between the upsert and the read, so the slot is
  // free again. Retry — the next attempt can only take the first branch above.
  if (attemptsLeft > 1) {
    return claimConfirmationToken(
      churchId,
      meetingId,
      personId,
      expiresInDays,
      attemptsLeft - 1
    );
  }
  throw new Error("Failed to create a meeting confirmation token");
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

  // All three writes are known up front, so they go in ONE `db.batch([...])`
  // — a Neon batched transaction, all-or-nothing (memory/invariants.md ->
  // Transactions). Three independent statements once left a consumed token
  // whose RSVP was recorded nowhere when a later statement failed, and the
  // `status !== "pending"` guard above then reported success forever. Now the
  // token, the invitation and the guest-list row move together, and on failure
  // the token stays `pending` so the link still works.
  const invitationStatus = response === "confirmed" ? "confirmed" : "declined";
  await db.batch([
    db
      .update(meetingConfirmationTokens)
      .set({
        status: response,
        respondedAt: new Date(),
      })
      .where(eq(meetingConfirmationTokens.id, tokenRecord.id)),
    db
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
      ),
    db
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
      ),
  ]);

  // Update email tracking — the person clicked the link, so they opened + clicked
  // Find communication_recipients for this person + meeting
  try {
    // Church-scoped in the predicate, not by FK topology — the token carries
    // its own church_id (memory/invariants.md -> Multi-Tenancy).
    const meetingComms = await db
      .select({ id: communications.id })
      .from(communications)
      .where(
        and(
          eq(communications.meetingId, tokenRecord.meetingId),
          eq(communications.churchId, tokenRecord.churchId)
        )
      );

    if (meetingComms.length > 0) {
      const commIds = meetingComms.map((c) => c.id);
      for (const commId of commIds) {
        const [recipient] = await db
          .select()
          .from(communicationRecipients)
          .where(
            and(
              eq(communicationRecipients.communicationId, commId),
              eq(communicationRecipients.personId, tokenRecord.personId),
              eq(communicationRecipients.churchId, tokenRecord.churchId)
            )
          )
          .limit(1);

        if (recipient) {
          // Only advance status — never regress from "clicked", and never
          // touch a bounced/failed row: the click reached us through SOME
          // channel, but the recipient row records that THIS address did not
          // work, and overwriting it would erase the bounce from the delivery
          // figures and re-enter the address into the resend pool
          // (memory/invariants.md -> Communication, UNREACHABLE_STATUSES).
          if (
            !isUnreachableStatus(recipient.status) &&
            RECIPIENT_STATUS_RANK[recipient.status] <
              RECIPIENT_STATUS_RANK.clicked
          ) {
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

  return (record?.status as ConfirmationStatus | null) ?? null;
}
