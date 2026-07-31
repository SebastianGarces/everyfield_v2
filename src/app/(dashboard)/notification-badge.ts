import { unstable_rethrow } from "next/navigation";

import {
  loadUnreadBadgeCount,
  type NotificationViewer,
} from "@/lib/notifications/feed";

// ============================================================================
// Failure isolation for the shell's unread badge (#227).
//
// The badge is the ONE notifications read that happens on every dashboard
// route, because it lives in the layout rather than on a page. That makes it
// structurally different from every other notifications read: a feed query that
// fails takes down `/notifications`, but an unread-count query that fails takes
// down `/people`, `/tasks`, `/meetings` and everything else with it. That is
// what was observed pre-migration against dev Neon — a missing table behind the
// count 500'd the entire shell, not the bell.
//
// So the count is treated as decoration, not as data the shell depends on: if
// it cannot be read, the number degrades to zero and every route still renders.
// A stale-looking bell is a strictly better failure than an unreachable app.
//
// What is deliberately NOT swallowed: Next.js control-flow errors. `redirect()`,
// `notFound()`, dynamic-usage bailouts and prerender interrupts are thrown as
// errors but MEAN something to the framework, so `unstable_rethrow` gets first
// refusal on every caught value. Swallowing one of those would turn a working
// redirect into a silent zero.
// ============================================================================

/** What the badge shows when the count could not be read. */
export const DEGRADED_UNREAD_COUNT = 0;

/**
 * The count loader, injectable so the failure path is testable without a
 * database. Production always uses `loadUnreadBadgeCount` — the same loader the
 * feed page goes through, so the badge keeps counting exactly the categories
 * the feed lists.
 */
export type UnreadBadgeLoader = (viewer: NotificationViewer) => Promise<number>;

/**
 * Read the badge count, degrading to zero rather than failing the render.
 *
 * Resolves for every input: a rejected loader, a loader that throws
 * synchronously, and a loader that returns a nonsense count all produce a
 * number the shell can render. The only value that escapes is a Next.js
 * control-flow error.
 */
export async function loadUnreadBadgeCountSafely(
  viewer: NotificationViewer,
  load: UnreadBadgeLoader = loadUnreadBadgeCount
): Promise<number> {
  try {
    const count = await load(viewer);
    // A non-finite or negative count is as unrenderable as a throw — the badge
    // would print "NaN" in the header — so it degrades the same way.
    return Number.isFinite(count) && count >= 0
      ? Math.floor(count)
      : DEGRADED_UNREAD_COUNT;
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      "[NOTIFICATIONS] unread badge count failed; rendering the shell without it:",
      error
    );
    return DEGRADED_UNREAD_COUNT;
  }
}
