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
// it cannot be read, this says so — `"unavailable"` — and every route still
// renders. A bell with no number is a strictly better failure than an
// unreachable app.
//
// IT DOES NOT DEGRADE TO A NUMBER. It used to return `0`, and zero is a real
// answer the bell is allowed to give ("none unread"), so the failure render
// made an assertion about the viewer's unread work that nothing had read. The
// failure is a VALUE of the return type now, which is why nothing downstream
// can print it as a count: the compiler asks which of the two it means.
//
// What is deliberately NOT swallowed: Next.js control-flow errors. `redirect()`,
// `notFound()`, dynamic-usage bailouts and prerender interrupts are thrown as
// errors but MEAN something to the framework, so `unstable_rethrow` gets first
// refusal on every caught value. Swallowing one of those would turn a working
// redirect into a silent zero.
// ============================================================================

/**
 * The count loader, injectable so the failure path is testable without a
 * database. Production always uses `loadUnreadBadgeCount` — the same loader the
 * feed page goes through, so the badge keeps counting exactly the categories
 * the feed lists.
 */
export type UnreadBadgeLoader = (viewer: NotificationViewer) => Promise<number>;

/**
 * Read the badge count, reporting failure as a value rather than throwing.
 *
 * Resolves for every input: a rejected loader, a loader that throws
 * synchronously, and a loader that returns a nonsense count all produce
 * something the shell can render. The only value that escapes is a Next.js
 * control-flow error.
 */
export async function loadUnreadBadgeCountSafely(
  viewer: NotificationViewer,
  load: UnreadBadgeLoader = loadUnreadBadgeCount
): Promise<number | "unavailable"> {
  try {
    const count = await load(viewer);
    // A non-finite or negative count is as unrenderable as a throw — the badge
    // would print "NaN" in the header — so it reports the same way.
    return Number.isFinite(count) && count >= 0
      ? Math.floor(count)
      : "unavailable";
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      "[NOTIFICATIONS] unread badge count failed; rendering the shell without it:",
      error
    );
    return "unavailable";
  }
}
