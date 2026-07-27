import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { feedVisibility, scopedWhere, type NotificationScope } from "./queries";

// ============================================================================
// Read state (N-009) — mark one read, mark all read.
//
// Three properties this module exists to hold, none of which are conventions:
//
//   1. READ STATE LIVES ON THE NOTIFICATION, NOT ON A DELIVERY.
//      `notifications.read_at` is the only column either statement writes
//      (plus `updated_at`). `notification_deliveries` is the channel attempt
//      log — "we sent this email, at 09:04, with this provider id" — and that
//      is a historical fact about a send, not a statement about whether a human
//      has looked at the feed row. An email that was delivered does not make
//      the feed row read, and reading the feed row does not un-send or re-send
//      anything. Nothing in this file imports `notificationDeliveries`, so the
//      separation is structural rather than remembered.
//
//   2. THE SAME TWO BOUNDARIES AS EVERY READ.
//      Both statements are built with `scopedWhere`, so `church_id` AND
//      `recipient_user_id` are in the WHERE clause of the UPDATE itself — a
//      write is not permitted to be looser than the read that surfaced the row.
//      Marking another church's notification read is not "blocked in the UI",
//      it updates zero rows.
//
//   3. YOU CAN ONLY MARK READ WHAT THE FEED COULD SHOW YOU.
//      `feedVisibility` is applied to both, so a cancelled row and a row
//      scheduled for next Tuesday are untouched by "mark all read". Without it,
//      "mark all read" would silently stamp future reminders as already-seen,
//      and they would arrive dead: in the feed, below the fold, never bolded,
//      never counted.
//
// Both statements are idempotent: they filter on `read_at IS NULL`, so a double
// click, a replayed action or a retry updates nothing the second time and
// preserves the FIRST read instant rather than sliding it forward.
// ============================================================================

/** Ids touched by a mark-read write — empty when it was already read. */
export interface MarkReadResult {
  /** The rows this call actually transitioned from unread to read. */
  markedIds: string[];
  /** Convenience for the common "how many did that clear?" question. */
  markedCount: number;
}

/**
 * `UPDATE notifications SET read_at = $now, updated_at = $now` — the whole
 * write, in both statements below.
 *
 * Spelled once so neither path can quietly grow a column. `updated_at` has no
 * database trigger in this schema; every writer sets it explicitly, and a
 * mark-read that left it stale would misreport when the row last changed.
 */
function readStatePatch(now: Date) {
  return { readAt: now, updatedAt: now };
}

/**
 * Mark ONE notification read.
 *
 * Scoped to church + recipient + feed visibility, and further filtered to rows
 * that are still unread, so the returned ids say what this call changed rather
 * than what already happened to be read.
 */
export function markNotificationReadQuery(
  scope: NotificationScope,
  id: string,
  now: Date = new Date()
) {
  return db
    .update(notifications)
    .set(readStatePatch(now))
    .where(
      scopedWhere(
        scope,
        eq(notifications.id, id),
        isNull(notifications.readAt),
        ...feedVisibility(now)
      )
    )
    .returning({ id: notifications.id });
}

/**
 * Mark EVERY visible unread notification read — the "mark all read" action.
 *
 * `read_at IS NULL` is not just an optimisation here: it is what keeps the
 * write bounded to the rows the badge is counting, and what makes a repeat
 * press a no-op instead of a mass re-stamp of every row's read instant.
 */
export function markAllNotificationsReadQuery(
  scope: NotificationScope,
  now: Date = new Date()
) {
  return db
    .update(notifications)
    .set(readStatePatch(now))
    .where(
      scopedWhere(scope, isNull(notifications.readAt), ...feedVisibility(now))
    )
    .returning({ id: notifications.id });
}

/**
 * Mark one notification read, returning what changed.
 *
 * A row that does not exist, belongs to another church, belongs to another user
 * in the same church, is cancelled, is not yet due, or is simply already read
 * all produce the same thing: zero ids. The caller cannot tell those apart, and
 * should not be able to — the id is not a probe for whether someone else's
 * notification exists.
 */
export async function markNotificationRead(
  scope: NotificationScope,
  id: string,
  now: Date = new Date()
): Promise<MarkReadResult> {
  const rows = await markNotificationReadQuery(scope, id, now);
  return { markedIds: rows.map((row) => row.id), markedCount: rows.length };
}

/** Mark every visible unread notification read for this recipient (N-009). */
export async function markAllNotificationsRead(
  scope: NotificationScope,
  now: Date = new Date()
): Promise<MarkReadResult> {
  const rows = await markAllNotificationsReadQuery(scope, now);
  return { markedIds: rows.map((row) => row.id), markedCount: rows.length };
}
