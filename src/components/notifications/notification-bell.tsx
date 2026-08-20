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
// every other server-rendered value does: the mark-read actions call
// `refresh()`, the layout re-renders, the number changes.
//
// ----------------------------------------------------------------------------
// LOADING IS A THIRD STATE, NOT A COUNT OF ZERO (#308 WS2, from #232)
// ----------------------------------------------------------------------------
//
// The count is read below a `<Suspense>` boundary in the dashboard layout, so
// the bell renders once before it is known. That render used to pass
// `DEGRADED_UNREAD_COUNT` — the constant the FAILURE path degrades to — and the
// bell has no way to tell the two apart, so it did what it does for any zero:
// it announced "Notifications, none unread". Two things were wrong with that.
//
// It is an assertion the shell has not earned. A screen-reader user with one
// unread notification was told there were none, and then, when the count
// resolved, told there was one — a correction the product invited by answering
// a question it had not yet asked. And it made a rendered zero the thing a red
// badge pops out of, which is the visual half of the same lie.
//
// So `"loading"` is a value of the prop rather than a number standing in for
// one. In that state the bell renders its geometry and its link — the header
// must not reflow when the count arrives — and nothing else: no badge, no
// `data-unread-count`, and a NEUTRAL accessible name under `aria-busy`, which
// is the ARIA spelling of "this will be answered shortly".
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
 * The accessible name while the count is still being read.
 *
 * Deliberately says nothing about unread state. `aria-busy` on the same element
 * carries "not yet", so a screen reader announces the control without a number
 * that is about to change.
 */
export const LOADING_BELL_LABEL = "Notifications";

export interface NotificationBellProps {
  /**
   * Visible unread notifications for this viewer, or `"loading"` while the
   * count is still being read below the layout's Suspense boundary.
   *
   * A STRING RATHER THAN A SENTINEL NUMBER. There is no count that means "I do
   * not know yet": zero is a real answer the bell is allowed to give, and while
   * the two shared a representation the loading render made that answer on the
   * shell's behalf. Anything that has to tell them apart now has to say which
   * it means, and the compiler asks.
   */
  unreadCount: number | "loading";
  className?: string;
}

export function NotificationBell({
  unreadCount,
  className,
}: NotificationBellProps) {
  const loading = unreadCount === "loading";
  const hasUnread = !loading && unreadCount > 0;

  return (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      className={cn("relative cursor-pointer", className)}
    >
      <Link
        href="/notifications"
        aria-label={loading ? LOADING_BELL_LABEL : unreadBellLabel(unreadCount)}
        // The ARIA spelling of "an answer is coming". Omitted, not `false`,
        // once it has arrived — a permanently-present `aria-busy="false"` is
        // noise a screen reader has to step over on every header.
        aria-busy={loading ? true : undefined}
        // The count as data, so the shell's state is assertable without
        // scraping a badge that may be capped, hidden or restyled. ABSENT while
        // loading, because the attribute is the machine-readable form of the
        // same assertion the label makes, and a test that read `0` here would
        // be reading the placeholder as the answer.
        data-unread-count={loading ? undefined : unreadCount}
        // Which of the three states this render is, for a test that has to
        // catch the loading one before it resolves.
        data-unread-state={loading ? "loading" : "ready"}
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
