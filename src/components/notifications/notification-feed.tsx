"use client";

import { CheckCheck, Inbox, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import {
  loadMoreNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(dashboard)/notifications/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  NotificationFeedRow,
  SerializedFeedCursor,
} from "@/lib/notifications/feed-view";
import { cn } from "@/lib/utils";

// ============================================================================
// The in-app feed (N-008, N-009, Screen 1).
//
// Presentation and paging. Everything that needed a database, a session or a
// clock was resolved on the server — by the page for the first screenful
// (`src/app/(dashboard)/notifications/page.tsx`) and by the load-more action
// for every page after it — and arrives as a finished view model
// (`@/lib/notifications/feed-view`):
//
//   - `href` is already resolved, and is NULL where this app has no screen for
//     the entity — so this component renders a link or plain text, and never
//     has to invent a path (see `src/lib/notifications/entity-links.ts`).
//   - the timestamps are already formatted against ONE instant chosen on the
//     server, because a relative label recomputed at hydration renders a
//     different string than the server sent (memory/invariants.md → Date & Time
//     Rendering).
//   - `categoryLabel` is already looked up, which keeps `@/db/schema` — and the
//     whole Drizzle table graph — out of the client bundle. The two imports
//     from `feed-view` are types, so they are erased and bring none of it.
//
// Read state is optimistic (memory/contracts/data-patterns.md): the row un-bolds
// the instant it is clicked, the server action reconciles, and its `refresh()`
// is what moves the count in the app shell's bell.
//
// The ONE piece of client state here is the paging cursor and the pages it has
// fetched — which data-patterns.md names explicitly as legitimate. It is not a
// mirror of a prop: `rows` remains server truth for the first page and is never
// copied into state, and appended pages are strictly OLDER rows the server has
// not been asked to re-render. Appends are deduplicated by id, because a
// notification arriving between the first render and a load-more shifts the
// page boundary by one.
// ============================================================================

export interface NotificationFeedProps {
  /** The first page, from the server. Never copied into state. */
  rows: NotificationFeedRow[];
  /** Cursor for the page after `rows`, or null when there is none. */
  nextCursor: SerializedFeedCursor | null;
  /** Server-truth unread count for this recipient (all rows, not just this page). */
  unreadCount: number;
  /**
   * Does this recipient have ANY visible notification at all?
   *
   * This is what separates the two empty states. Without it, a church in its
   * first week and a user whose unread filter has run dry get the same blank
   * panel — and a blank panel with no explanation reads as a bug, not as
   * "nothing has happened yet".
   */
  hasAny: boolean;
  /**
   * Whether the unread-only filter is active. The next page has to be drawn
   * from the same filtered list as the first, so it travels with the cursor.
   */
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

/**
 * Append older pages without ever showing a row twice.
 *
 * The duplicate is real, not defensive: a notification enqueued between the
 * first render and the click shifts every page boundary down by one, so the row
 * that was last on page 1 is first on page 2. React would render two children
 * with the same key; the user would read the same notification twice.
 */
function appendRows(
  existing: NotificationFeedRow[],
  incoming: NotificationFeedRow[]
): NotificationFeedRow[] {
  const seen = new Set(existing.map((row) => row.id));
  return [...existing, ...incoming.filter((row) => !seen.has(row.id))];
}

export function NotificationFeed({
  rows,
  nextCursor,
  unreadCount,
  hasAny,
  unreadOnly,
}: NotificationFeedProps) {
  const [isPending, startTransition] = useTransition();
  const [isLoadingMore, startLoadingMore] = useTransition();

  // Pagination state (data-patterns.md: cursors are legitimate client state).
  // `rows` is page one and stays a prop; these are the pages after it.
  const [olderRows, setOlderRows] = useState<NotificationFeedRow[]>([]);
  const [cursor, setCursor] = useState<SerializedFeedCursor | null>(nextCursor);

  const [state, applyOptimistic] = useOptimistic(
    { rows: appendRows(rows, olderRows), unreadCount },
    applyFeedAction
  );

  const loadMore = () => {
    if (!cursor) return;

    startLoadingMore(async () => {
      const result = await loadMoreNotificationsAction({ cursor, unreadOnly });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setOlderRows((previous) => appendRows(previous, result.rows));
      setCursor(result.nextCursor);
    });
  };

  // An optimistic update lasts only as long as its transition: when the action
  // settles, the row falls back to whatever the underlying data now says. For
  // page one that is the server's answer, arriving via the action's `refresh()`.
  // The appended pages are not part of that re-render, so a row marked read on
  // page two would visibly UN-read itself the moment the transition ended. The
  // confirmed result is written back to them here — after the action succeeded,
  // never before, which is what keeps this a reconciliation rather than a second
  // source of truth.
  const markRead = (id: string) => {
    startTransition(async () => {
      applyOptimistic({ type: "read", id });
      const result = await markNotificationReadAction(id);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setOlderRows((previous) =>
        unreadOnly
          ? // On the unread tab a read row is no longer a member of the list —
            // which is exactly what the server's refresh does to page one.
            previous.filter((row) => row.id !== id)
          : previous.map((row) =>
              row.id === id ? { ...row, isRead: true } : row
            )
      );
    });
  };

  const markAllRead = () => {
    startTransition(async () => {
      applyOptimistic({ type: "read-all" });
      const result = await markAllNotificationsReadAction();

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      if (unreadOnly) {
        // Nothing unread is left, so the unread list — every page of it — is
        // empty, and there is no page after an empty list.
        setOlderRows([]);
        setCursor(null);
        return;
      }

      setOlderRows((previous) =>
        previous.map((row) => ({ ...row, isRead: true }))
      );
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
        <EmptyState hasAny={hasAny} />
      ) : (
        <>
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

          {cursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={loadMore}
                disabled={isLoadingMore}
                aria-busy={isLoadingMore}
                data-testid="notification-load-more"
              >
                {isLoadingMore && (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                )}
                {isLoadingMore ? "Loading" : "Load more"}
              </Button>
            </div>
          )}

          {/* The end of the list, announced once rather than left ambiguous:
              without it, a feed that has stopped paging looks identical to one
              whose button failed to appear. */}
          {!cursor && state.rows.length > 0 && olderRows.length > 0 && (
            <p
              className="text-muted-foreground pt-2 text-center text-sm"
              data-testid="notification-feed-end"
            >
              That is everything.
            </p>
          )}
        </>
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
//
// There are exactly two, and which one shows is decided by `hasAny` alone.
//
// The version before this took `unreadOnly` as well and had a third message for
// "the All tab is empty but you have notifications" — a state that cannot
// happen. `hasAnyNotifications` is built from the same predicates as the feed
// (tenancy, feed visibility, preference allow-list), so on the All tab an empty
// list and `hasAny === true` are contradictory: the probe finds a row exactly
// when the first page would list one. Paging does not create the state either —
// page one is only empty when the whole filtered list is. So the branch was
// unreachable copy, and unreachable copy is worse than none: it never ships, it
// never gets read, and it quietly claims the empty states were considered.
//
// The remaining "all caught up" is reachable ONLY under the unread filter,
// where `hasAny` counts read rows the list does not, and its copy says so.
// ----------------------------------------------------------------------------

function EmptyState({ hasAny }: { hasAny: boolean }) {
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

  // Everything visible has been read — the unread tab, run dry. A finished
  // state, not an empty one.
  return (
    <div
      data-testid="notifications-all-caught-up"
      className="border-border bg-card flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center"
    >
      <CheckCheck className="text-muted-foreground size-8" aria-hidden="true" />
      <h2 className="text-base font-semibold">All caught up</h2>
      <p className="text-muted-foreground max-w-md text-sm text-pretty">
        Nothing is unread. Switch to All to look back through what you have
        already read.
      </p>
    </div>
  );
}
