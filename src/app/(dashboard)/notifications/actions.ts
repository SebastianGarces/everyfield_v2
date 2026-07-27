"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { verifySession } from "@/lib/auth/session";
import {
  loadOlderNotifications,
  markAllVisibleNotificationsRead,
  markVisibleNotificationRead,
  notificationViewer,
  type NotificationViewer,
} from "@/lib/notifications/feed";
import {
  serializeFeedCursor,
  toFeedRow,
  type NotificationFeedRow,
  type SerializedFeedCursor,
} from "@/lib/notifications/feed-view";

// ============================================================================
// The feed's actions (N-008 paging, N-009 mark-read).
//
// All three derive the VIEWER from the session — never from the caller. The
// only things a client is trusted with are a notification id and a page cursor,
// and neither is a capability: both are intersected with the session's church
// and the session's user inside the statement's WHERE clause
// (`src/lib/notifications/queries.ts`, `mark-read.ts`), so a forged id or a
// cursor pointing into another church's rows returns nothing and marks nothing
// — the same answer as an id that was already read. There is no oracle here.
//
// Going through `@/lib/notifications/feed` rather than the query modules
// directly is what keeps the reads and the writes filtered by the same in-app
// preference allow-list the page was rendered with (N-005).
//
// `refresh()` rather than `revalidatePath("/notifications")` because the unread
// badge does not live on this page: it lives in the dashboard LAYOUT's header,
// which every route renders. `refresh()` re-renders the current tree including
// its layouts, so the count in the app shell reconciles with the same server
// state the feed just re-read. The feed itself does not wait for it — it holds
// an optimistic row state (memory/contracts/data-patterns.md) — so the visible
// effect is instant and the badge follows.
// ============================================================================

/** What a mark-read action tells the caller. */
export type MarkReadActionResult =
  | { success: true; markedCount: number }
  | { success: false; error: string };

/** What the load-more action tells the caller. */
export type LoadMoreActionResult =
  | {
      success: true;
      rows: NotificationFeedRow[];
      /** Null when that was the last page. */
      nextCursor: SerializedFeedCursor | null;
    }
  | { success: false; error: string };

const notificationIdSchema = z.string().uuid();

/**
 * The cursor as it comes back from the client.
 *
 * Parsed rather than trusted, but note what the parse is FOR: it keeps a
 * malformed timestamp from reaching Postgres as a cast error. It is not what
 * makes the page safe — the scope is, and the scope is rebuilt from the session
 * below whatever this cursor claims.
 */
const feedCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

const loadMoreSchema = z.object({
  cursor: feedCursorSchema,
  unreadOnly: z.boolean(),
});

export type LoadMoreInput = z.infer<typeof loadMoreSchema>;

/**
 * Resolve the session into a feed viewer, or say why there isn't one.
 *
 * A user with no church has no notifications — every row is church-scoped — so
 * this is a real (if rare) state rather than an assertion: an oversight user
 * mid-association, or an account whose church was removed.
 */
async function currentViewer(): Promise<
  { ok: true; viewer: NotificationViewer } | { ok: false; error: string }
> {
  const viewer = notificationViewer(await verifySession());

  if (!viewer) {
    return { ok: false, error: "You are not associated with a church" };
  }

  return { ok: true, viewer };
}

/**
 * Mark one notification read.
 *
 * Idempotent: marking an already-read notification succeeds with
 * `markedCount: 0` and leaves the original read instant alone.
 */
export async function markNotificationReadAction(
  notificationId: string
): Promise<MarkReadActionResult> {
  const parsed = notificationIdSchema.safeParse(notificationId);
  if (!parsed.success) {
    return { success: false, error: "Invalid notification" };
  }

  const resolved = await currentViewer();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const { markedCount } = await markVisibleNotificationRead(
    resolved.viewer,
    parsed.data
  );

  refresh();

  return { success: true, markedCount };
}

/** Mark every visible unread notification read (N-009). */
export async function markAllNotificationsReadAction(): Promise<MarkReadActionResult> {
  const resolved = await currentViewer();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const { markedCount } = await markAllVisibleNotificationsRead(
    resolved.viewer
  );

  refresh();

  return { success: true, markedCount };
}

/**
 * The next page of the feed, older than the cursor the client holds (N-008).
 *
 * Deliberately does NOT call `refresh()`: this action adds rows to a list the
 * user is reading and changes nothing on the server, so re-rendering the tree
 * would throw away the pages they had already loaded to tell them nothing new.
 */
export async function loadMoreNotificationsAction(
  input: LoadMoreInput
): Promise<LoadMoreActionResult> {
  const parsed = loadMoreSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Could not load more notifications" };
  }

  const resolved = await currentViewer();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const now = new Date();

  const page = await loadOlderNotifications(resolved.viewer, {
    before: {
      createdAt: new Date(parsed.data.cursor.createdAt),
      id: parsed.data.cursor.id,
    },
    unreadOnly: parsed.data.unreadOnly,
  });

  return {
    success: true,
    rows: page.rows.map((row) => toFeedRow(row, now)),
    nextCursor: serializeFeedCursor(page.nextCursor),
  };
}
