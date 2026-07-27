import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import {
  NotificationFeed,
  type NotificationFeedRow,
} from "@/components/notifications/notification-feed";
import { verifySession } from "@/lib/auth/session";
import { formatDateTime, formatRelativeTimestamp } from "@/lib/datetime";
import { NOTIFICATION_CATEGORIES } from "@/lib/notifications/categories";
import { notificationEntityHref } from "@/lib/notifications/entity-links";
import {
  getUnreadCount,
  hasAnyNotifications,
  listNotifications,
  type FeedNotification,
} from "@/lib/notifications/queries";
import { cn } from "@/lib/utils";

// ============================================================================
// Screen 1 — the in-app feed (N-008, N-009).
//
// The server resolves everything the list needs and hands the client component
// a finished view model: the scope (from the session, never from the URL), the
// link target, the formatted timestamps and the category label. That keeps the
// three things that must not drift in one place — tenancy, "is there a screen
// for this entity", and "which instant are these relative times relative to".
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notifications",
};

/** One page of the feed. Paging beyond it is N-020, not this unit. */
const FEED_PAGE_SIZE = 50;

interface NotificationsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Map a projected feed row onto what the list renders.
 *
 * `now` is threaded in rather than read here so every row on the page — and the
 * server's `hasAny`/count queries — agree on one instant.
 */
function toFeedRow(row: FeedNotification, now: Date): NotificationFeedRow {
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

export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps) {
  const { user } = await verifySession();

  // Every notification is church-scoped, so a user with no church has no feed
  // to show — send them somewhere that means something instead of rendering an
  // empty page that looks broken.
  if (!user.churchId) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const unreadOnly = params.filter === "unread";

  const scope = { churchId: user.churchId, recipientUserId: user.id };
  const now = new Date();

  const [rows, unreadCount, hasAny] = await Promise.all([
    listNotifications(scope, { unreadOnly, now, limit: FEED_PAGE_SIZE }),
    getUnreadCount(scope, now),
    hasAnyNotifications(scope, now),
  ]);

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Notifications" }]} />

      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Notifications
          </h1>
          <p className="text-muted-foreground text-sm">
            What happened while you were away.
          </p>
        </div>

        {hasAny && (
          <nav
            aria-label="Filter notifications"
            className="bg-muted inline-flex items-center gap-1 rounded-lg p-1"
          >
            <FilterTab href="/notifications" active={!unreadOnly} testId="all">
              All
            </FilterTab>
            <FilterTab
              href="/notifications?filter=unread"
              active={unreadOnly}
              testId="unread"
            >
              Unread
            </FilterTab>
          </nav>
        )}

        <NotificationFeed
          rows={rows.map((row) => toFeedRow(row, now))}
          unreadCount={unreadCount}
          hasAny={hasAny}
          unreadOnly={unreadOnly}
        />
      </div>
    </>
  );
}

function FilterTab({
  href,
  active,
  testId,
  children,
}: {
  href: string;
  active: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-testid={`notification-filter-${testId}`}
      data-active={active ? "true" : "false"}
      className={cn(
        "cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Link>
  );
}
