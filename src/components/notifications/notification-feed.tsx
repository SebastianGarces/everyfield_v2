"use client";

import { CheckCheck, Inbox } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(dashboard)/notifications/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ============================================================================
// The in-app feed (N-008, N-009, Screen 1).
//
// Presentation only. Everything that needed a database, a session or a clock
// was resolved by the page (`src/app/(dashboard)/notifications/page.tsx`) and
// arrives as props:
//
//   - `href` is already resolved, and is NULL where this app has no screen for
//     the entity — so this component renders a link or plain text, and never
//     has to invent a path (see `src/lib/notifications/entity-links.ts`).
//   - the timestamps are already formatted against ONE instant chosen on the
//     server, because a relative label recomputed at hydration renders a
//     different string than the server sent (memory/invariants.md → Date & Time
//     Rendering).
//   - `categoryLabel` is already looked up, which keeps `@/db/schema` — and the
//     whole Drizzle table graph — out of the client bundle.
//
// Read state is optimistic (memory/contracts/data-patterns.md): the row un-bolds
// the instant it is clicked, the server action reconciles, and its `refresh()`
// is what moves the count in the app shell's bell. Nothing here writes server
// data into `useState`.
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

export interface NotificationFeedProps {
  rows: NotificationFeedRow[];
  /** Server-truth unread count for this recipient (all rows, not just this page). */
  unreadCount: number;
  /**
   * Does this recipient have ANY visible notification at all?
   *
   * This is what separates the two empty states. Without it, a church in its
   * first week and a user who has read everything get the same blank panel —
   * and a blank panel with no explanation reads as a bug, not as "nothing has
   * happened yet".
   */
  hasAny: boolean;
  /** Whether the unread-only filter is active — it decides which empty state. */
  unreadOnly: boolean;
}

interface FeedState {
  rows: NotificationFeedRow[];
  unreadCount: number;
}

type FeedAction = { type: "read"; id: string } | { type: "read-all" };

/**
 * Apply a mark-read optimistically.
 *
 * The count is decremented only for a row that was actually unread, so a double
 * click cannot drive the badge negative — the same guard the SQL applies with
 * `read_at IS NULL`.
 */
function applyFeedAction(state: FeedState, action: FeedAction): FeedState {
  if (action.type === "read-all") {
    return {
      rows: state.rows.map((row) => ({ ...row, isRead: true })),
      unreadCount: 0,
    };
  }

  const target = state.rows.find((row) => row.id === action.id);
  if (!target || target.isRead) return state;

  return {
    rows: state.rows.map((row) =>
      row.id === action.id ? { ...row, isRead: true } : row
    ),
    unreadCount: Math.max(0, state.unreadCount - 1),
  };
}

export function NotificationFeed({
  rows,
  unreadCount,
  hasAny,
  unreadOnly,
}: NotificationFeedProps) {
  const [isPending, startTransition] = useTransition();

  const [state, applyOptimistic] = useOptimistic(
    { rows, unreadCount },
    applyFeedAction
  );

  const markRead = (id: string) => {
    startTransition(async () => {
      applyOptimistic({ type: "read", id });
      const result = await markNotificationReadAction(id);
      if (!result.success) toast.error(result.error);
    });
  };

  const markAllRead = () => {
    startTransition(async () => {
      applyOptimistic({ type: "read-all" });
      const result = await markAllNotificationsReadAction();
      if (!result.success) toast.error(result.error);
    });
  };

  return (
    <div className="space-y-4" data-testid="notification-feed">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {state.unreadCount === 0
            ? "No unread notifications"
            : `${state.unreadCount} unread`}
        </p>

        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          onClick={markAllRead}
          disabled={state.unreadCount === 0 || isPending}
          data-testid="mark-all-read"
        >
          <CheckCheck aria-hidden="true" />
          Mark all read
        </Button>
      </div>

      {state.rows.length === 0 ? (
        <EmptyState hasAny={hasAny} unreadOnly={unreadOnly} />
      ) : (
        <ul className="space-y-2" data-testid="notification-list">
          {state.rows.map((row) => (
            <NotificationRow
              key={row.id}
              row={row}
              onMarkRead={() => markRead(row.id)}
              disabled={isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// A row
// ----------------------------------------------------------------------------

function NotificationRow({
  row,
  onMarkRead,
  disabled,
}: {
  row: NotificationFeedRow;
  onMarkRead: () => void;
  disabled: boolean;
}) {
  return (
    <li
      data-testid="notification-row"
      data-notification-id={row.id}
      // The read state as data, so it is assertable without depending on which
      // Tailwind classes happen to express "unread" this month.
      data-read={row.isRead ? "read" : "unread"}
      className={cn(
        "relative flex items-start gap-3 rounded-lg border p-4 transition-colors",
        row.isRead
          ? "bg-card border-border"
          : "border-primary/40 bg-primary/5 hover:bg-primary/10"
      )}
    >
      {/* Unread is never carried by colour alone: a dot, a heavier title, and
          text for screen readers all say the same thing. */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-2 size-2 shrink-0 rounded-full",
          row.isRead ? "bg-transparent" : "bg-primary"
        )}
      />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{row.categoryLabel}</Badge>
          <time
            dateTime={row.timeIso}
            title={row.timeTitle}
            className="text-muted-foreground text-xs"
          >
            {row.timeLabel}
          </time>
          {!row.isRead && <span className="sr-only">Unread</span>}
        </div>

        {row.href ? (
          // The stretched link makes the whole row the hit area (Screen 1: "row
          // click marks read and navigates"), while keeping ONE real anchor in
          // the DOM — nesting the row's other controls inside a link would be
          // invalid HTML and unusable with a keyboard.
          <Link
            href={row.href}
            onClick={onMarkRead}
            data-testid="notification-link"
            className={cn(
              "cursor-pointer text-sm after:absolute after:inset-0 hover:underline",
              row.isRead ? "font-medium" : "font-semibold"
            )}
          >
            {row.title}
          </Link>
        ) : (
          <p
            data-testid="notification-title-plain"
            className={cn(
              "text-sm",
              row.isRead ? "font-medium" : "font-semibold"
            )}
          >
            {row.title}
          </p>
        )}

        <p className="text-muted-foreground text-sm">{row.body}</p>
      </div>

      {!row.isRead && (
        <Button
          variant="ghost"
          size="xs"
          // Above the stretched link, or the link would swallow the click and
          // navigate away instead of marking read in place.
          className="relative z-10 cursor-pointer"
          onClick={onMarkRead}
          disabled={disabled}
          data-testid="mark-read"
        >
          Mark read
        </Button>
      )}
    </li>
  );
}

// ----------------------------------------------------------------------------
// The two empty states — deliberately different things to say
// ----------------------------------------------------------------------------

function EmptyState({
  hasAny,
  unreadOnly,
}: {
  hasAny: boolean;
  unreadOnly: boolean;
}) {
  // Cold start: this recipient has never had a visible notification. Almost
  // always a brand-new plant, where an unexplained blank panel is the difference
  // between "the app is quiet" and "the app is broken".
  if (!hasAny) {
    return (
      <div
        data-testid="notifications-cold-start"
        className="border-border bg-card flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center"
      >
        <Inbox className="text-muted-foreground size-8" aria-hidden="true" />
        <h2 className="text-base font-semibold">No notifications yet</h2>
        <p className="text-muted-foreground max-w-md text-sm text-pretty">
          This is where you will see what happened while you were away — tasks
          coming due, meetings scheduled, messages that did not reach someone.
          Your plant has not generated any yet.
        </p>
        <Button asChild variant="outline" size="sm" className="cursor-pointer">
          <Link href="/dashboard" className="cursor-pointer">
            Back to dashboard
          </Link>
        </Button>
      </div>
    );
  }

  // Everything visible has been read. A finished state, not an empty one.
  return (
    <div
      data-testid="notifications-all-caught-up"
      className="border-border bg-card flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center"
    >
      <CheckCheck className="text-muted-foreground size-8" aria-hidden="true" />
      <h2 className="text-base font-semibold">All caught up</h2>
      <p className="text-muted-foreground max-w-md text-sm text-pretty">
        {unreadOnly
          ? "Nothing is unread. Switch to All to look back through what you have already read."
          : "You have read everything here. New notifications will appear at the top."}
      </p>
    </div>
  );
}
