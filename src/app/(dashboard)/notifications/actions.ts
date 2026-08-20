"use server";

import { z } from "zod";

import { requireSeat } from "@/lib/auth/seats";
import { type Capability } from "@/lib/auth/seat-rules";
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
// THE SHELL REFRESH IS THE CALLER'S, NOT THIS MODULE'S (#228, #308 WS2).
//
// Marking a notification read changes the unread badge, and the badge does not
// live on this page: it lives in the dashboard LAYOUT's header, which every
// route renders. So something has to re-render the current tree including its
// layouts. These actions used to do it themselves, with `refresh()` on the way
// out.
//
// That is right for the two presses that STAY on the feed and wrong for the one
// that does not. A row click marks read AND navigates, and the refresh lands on
// the route the user is leaving: it re-renders `/notifications` while `Link`'s
// push is still waiting for its RSC payload, the push is superseded, and the
// user stays put looking at a row that just stopped being unread. That is
// #228's "1 in 5", and it reproduced 22 times out of 22 once the destination
// was not already prefetched.
//
// Only the caller knows which of the two it is, so the caller now says:
// `notification-feed.tsx` calls `router.refresh()` after the "Mark read" and
// "Mark all read" buttons, and calls nothing after a row click, because the
// destination's own render is a fresher read of the badge than a refresh of the
// screen being left. The feed does not wait for either — it holds an optimistic
// row state (memory/contracts/data-patterns.md) — so the visible effect is
// instant and the badge follows.
//
// SESSION FIRST, THEN THE PARSE (ruled 2026-08-10; extended repo-wide in round
// 8 of #304). Every export opens with `currentViewer()`, which is this module's
// mint — it awaits `verifySession()` on its first line — and it sits ABOVE the
// `safeParse` in the two exports that have one. While the parse ran first, an
// anonymous POST of `"not-a-uuid"` came back `{ success: false, error: "Invalid
// notification" }` while an anonymous POST of a well-formed uuid threw: a free
// oracle for the id and cursor shapes, and, worse, an endpoint whose first line
// said nothing about who was calling.
//
// The mint being a HELPER does not weaken the claim, but it does mean the
// structural test cannot look for `verifySession()` in these bodies — it looks
// for the mint this module actually uses. `service.test.ts` §1b‴ names it per
// module for exactly that reason.
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
 * Rare but real, and it is no longer "an oversight user": since N-027 an
 * oversight account gets a viewer scoped to its org. What is left is an account
 * with no tenancy at all — mid-registration, or one whose church was removed —
 * and a row naming two, which reaches nothing in either direction.
 */
async function currentViewer(
  capability: Capability
): Promise<
  { ok: true; viewer: NotificationViewer } | { ok: false; error: string }
> {
  const viewer = notificationViewer(await requireSeat(capability));

  if (!viewer) {
    return {
      ok: false,
      error: "You are not associated with a church or an organization",
    };
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
  const resolved = await currentViewer("self.write");
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const parsed = notificationIdSchema.safeParse(notificationId);
  if (!parsed.success) {
    return { success: false, error: "Invalid notification" };
  }

  const { markedCount } = await markVisibleNotificationRead(
    resolved.viewer,
    parsed.data
  );

  return { success: true, markedCount };
}

/** Mark every visible unread notification read (N-009). */
export async function markAllNotificationsReadAction(): Promise<MarkReadActionResult> {
  const resolved = await currentViewer("self.write");
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const { markedCount } = await markAllVisibleNotificationsRead(
    resolved.viewer
  );

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
  const resolved = await currentViewer("read");
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const parsed = loadMoreSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Could not load more notifications" };
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
