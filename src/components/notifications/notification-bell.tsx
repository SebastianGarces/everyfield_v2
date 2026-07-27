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

export interface NotificationBellProps {
  /** Visible unread notifications for the current user in the current church. */
  unreadCount: number;
  className?: string;
}

export function NotificationBell({
  unreadCount,
  className,
}: NotificationBellProps) {
  const hasUnread = unreadCount > 0;

  return (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      className={cn("relative cursor-pointer", className)}
    >
      <Link
        href="/notifications"
        aria-label={unreadBellLabel(unreadCount)}
        // The count as data, so the shell's state is assertable without
        // scraping a badge that may be capped, hidden or restyled.
        data-unread-count={unreadCount}
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
