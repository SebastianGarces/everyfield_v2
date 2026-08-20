import { Bell } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ============================================================================
// The app shell's unread indicator (N-008, Screen 1).
//
// A presentational component on purpose: it takes the count, it does not fetch
// it. The count is read in the dashboard layout, which is the thing that knows
// the session — so the bell has no opinion about tenancy and there is exactly
// one place the badge's number comes from.
//
// It is also NOT a client component. Nothing here is interactive beyond a link,
// so the shell ships no extra JavaScript for it, and the count updates the way
// every other server-rendered value does: a `router.refresh()` re-renders the
// tree this layout is part of and the number changes. NOTHING ELSE MOVES IT —
// the dashboard layout is a segment every notification destination shares, and a
// client-side push reuses a shared segment instead of re-rendering it, so a
// navigation alone leaves the count exactly as it was (#527). When each
// mark-read caller fires that refresh is `notification-feed.tsx`'s business:
// inside the press if it stays, chained after the push if it leaves (#228).
//
// ----------------------------------------------------------------------------
// NEITHER "NOT YET" NOR "COULD NOT" IS A COUNT (#308 WS2, from #232; #528)
// ----------------------------------------------------------------------------
//
// The count is read below a `<Suspense>` boundary in the dashboard layout, so
// the bell renders once before it is known — and the read can also fail, which
// is why `loadUnreadBadgeCountSafely` exists at all. Both used to arrive here as
// the number `0`, and zero is a real answer the bell is allowed to give, so the
// bell did what it does for any zero: it announced "Notifications, none unread".
// Two things were wrong with that.
//
// It is an assertion the shell has not earned. A screen-reader user with one
// unread notification was told there were none, and then, when the count
// resolved, told there was one — a correction the product invited by answering
// a question it had not yet asked. And it made a rendered zero the thing a red
// badge pops out of, which is the visual half of the same lie.
//
// So both are VALUES of the prop rather than numbers standing in for one, and
// the compiler is what enforces it: nothing can print `"loading"` or
// `"unavailable"` as a count without saying which it means. In either state the
// bell renders its geometry and its link — the header must not reflow when the
// count arrives — and nothing else: no badge, no `data-unread-count`, and a
// NEUTRAL accessible name. They differ in one thing only, `aria-busy`, which is
// the ARIA spelling of "this will be answered shortly" and would be a lie on a
// read that has already finished failing.
// ============================================================================

/** Above this, the badge stops being a number and starts being a mood. */
const UNREAD_DISPLAY_CAP = 99;

/**
 * What the badge shows. Capped so a neglected feed cannot widen the header —
 * "347" and "99+" mean the same thing to a reader, and only one of them fits.
 * The exact count stays available to assistive tech and to tests via the
 * `aria-label` and `data-unread-count`.
 */
export function formatUnreadBadge(count: number): string {
  return count > UNREAD_DISPLAY_CAP ? `${UNREAD_DISPLAY_CAP}+` : String(count);
}

/** The accessible name — the count belongs in the name, not only in the pixel. */
export function unreadBellLabel(count: number): string {
  if (count === 0) return "Notifications, none unread";
  if (count === 1) return "Notifications, 1 unread";
  return `Notifications, ${count} unread`;
}

/**
 * The accessible name whenever there is no count to give — still being read, or
 * read and failed.
 *
 * Deliberately says nothing about unread state. `aria-busy`, present only on
 * the loading render, carries "not yet"; a screen reader announces the control
 * either way without a number the shell has not earned.
 */
export const UNCOUNTED_BELL_LABEL = "Notifications";

/**
 * What the bell was told about the viewer's unread work.
 *
 * STRINGS RATHER THAN SENTINEL NUMBERS. There is no count that means "I do not
 * know yet" or "I could not read it": zero is a real answer the bell is allowed
 * to give, and while all three shared a representation the shell made that
 * answer on the viewer's behalf. Anything that has to tell them apart now has
 * to say which it means, and the compiler asks.
 */
export type UnreadCount = number | "loading" | "unavailable";

export interface NotificationBellProps {
  /**
   * Visible unread notifications for this viewer, `"loading"` while the count
   * is still being read below the layout's Suspense boundary, or
   * `"unavailable"` when the read failed (`loadUnreadBadgeCountSafely`).
   */
  unreadCount: UnreadCount;
  className?: string;
}

export function NotificationBell({
  unreadCount,
  className,
}: NotificationBellProps) {
  const loading = unreadCount === "loading";
  const counted = typeof unreadCount === "number";
  const hasUnread = counted && unreadCount > 0;

  return (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      className={cn("relative cursor-pointer", className)}
    >
      <Link
        href="/notifications"
        aria-label={
          counted ? unreadBellLabel(unreadCount) : UNCOUNTED_BELL_LABEL
        }
        // The ARIA spelling of "an answer is coming". Omitted, not `false`,
        // once it has arrived — a permanently-present `aria-busy="false"` is
        // noise a screen reader has to step over on every header — and omitted
        // on the failed read too, which is an answer, just not a number.
        aria-busy={loading ? true : undefined}
        // The count as data, so the shell's state is assertable without
        // scraping a badge that may be capped, hidden or restyled. ABSENT
        // unless there is a count, because the attribute is the
        // machine-readable form of the same assertion the label makes, and a
        // test that read `0` here would be reading a placeholder as the answer.
        data-unread-count={counted ? unreadCount : undefined}
        // Which of the three states this render is, for a test that has to
        // catch the loading one before it resolves — and for an operator
        // looking at a bell that never got its number.
        data-unread-state={counted ? "ready" : unreadCount}
        data-testid="notification-bell"
        className="cursor-pointer"
      >
        <Bell aria-hidden="true" />
        {hasUnread && (
          <span
            // `aria-hidden` because `aria-label` above already says the count;
            // without it a screen reader reads the number twice.
            aria-hidden="true"
            data-testid="notification-unread-badge"
            className="bg-destructive pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold text-white tabular-nums"
          >
            {formatUnreadBadge(unreadCount)}
          </span>
        )}
      </Link>
    </Button>
  );
}
