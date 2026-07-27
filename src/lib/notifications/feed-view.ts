import { formatDateTime, formatRelativeTimestamp } from "@/lib/datetime";

import { NOTIFICATION_CATEGORIES } from "./categories";
import { notificationEntityHref } from "./entity-links";
import type { FeedCursor, FeedNotification } from "./queries";

// ============================================================================
// The feed's view model — the shape the client component renders.
//
// It lives here rather than in the page because TWO server entrypoints produce
// it now: the page's first render and the load-more action's later pages
// (`src/app/(dashboard)/notifications/actions.ts`). A second copy of this
// mapping would be a second chance for page 2 to disagree with page 1 about
// what a category is called or where a row points.
//
// Everything that needs a database, a session or a clock is resolved on this
// side of the boundary: the entity link (null where this app has no screen),
// the category label (which keeps the Drizzle table graph out of the client
// bundle) and both timestamp forms, computed against ONE instant the caller
// supplies — a relative label recomputed at hydration renders a different
// string than the server sent (memory/invariants.md → Date & Time Rendering).
// ============================================================================

/** One row as the feed renders it — a view model, not a database row. */
export interface NotificationFeedRow {
  id: string;
  /** Plain-language category name, e.g. "Meetings". */
  categoryLabel: string;
  title: string;
  body: string;
  /** Where the row points, or null when the subject has no screen. */
  href: string | null;
  /** `"12m ago"`, computed server-side against one instant. */
  timeLabel: string;
  /** Absolute form, for the tooltip and for `<time dateTime>`. */
  timeTitle: string;
  timeIso: string;
  isRead: boolean;
}

/**
 * The keyset cursor as it crosses to the client and back.
 *
 * A `Date` would survive the RSC payload but not the round trip through the
 * server action's parse, so the wire form is a string and the action is what
 * turns it back into an instant. It carries nothing the viewer was not already
 * shown — the `(created_at, id)` of a row on their own screen — and it is
 * never trusted for scope: the action rebuilds church and recipient from the
 * session and intersects them with whatever cursor arrives.
 */
export interface SerializedFeedCursor {
  createdAt: string;
  id: string;
}

/** Project one row onto what the list renders, against a fixed instant. */
export function toFeedRow(
  row: FeedNotification,
  now: Date
): NotificationFeedRow {
  return {
    id: row.id,
    categoryLabel: NOTIFICATION_CATEGORIES[row.category]?.label ?? "Update",
    title: row.title,
    body: row.body,
    href: notificationEntityHref(row.entityType, row.entityId),
    timeLabel: formatRelativeTimestamp(row.createdAt, now),
    timeTitle: formatDateTime(row.createdAt, "short"),
    timeIso: row.createdAt.toISOString(),
    isRead: row.readAt !== null,
  };
}

/** Wire form of a cursor, or null when there is no page after this one. */
export function serializeFeedCursor(
  cursor: FeedCursor | null
): SerializedFeedCursor | null {
  if (!cursor) return null;
  return { createdAt: cursor.createdAt.toISOString(), id: cursor.id };
}
