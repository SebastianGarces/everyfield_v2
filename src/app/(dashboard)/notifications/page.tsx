import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { NotificationFeed } from "@/components/notifications/notification-feed";
import { verifySession } from "@/lib/auth/session";
import {
  loadNotificationFeedScreen,
  notificationViewer,
} from "@/lib/notifications/feed";
import { serializeFeedCursor, toFeedRow } from "@/lib/notifications/feed-view";
import { cn } from "@/lib/utils";

// ============================================================================
// Screen 1 — the in-app feed (N-008, N-009).
//
// The server resolves everything the list needs and hands the client component
// a finished view model: the scope (from the session, never from the URL), the
// preference allow-list, the link target, the formatted timestamps and the
// category label. That keeps the things that must not drift in one place —
// tenancy, what this viewer has asked to see, "is there a screen for this
// entity", and "which instant are these relative times relative to".
//
// The list is PAGED, not truncated: this is the first page plus the cursor for
// the one after it, and the feed component appends the rest through the
// load-more action.
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notifications",
};

/**
 * Rows per page. The feed loads more on demand from the keyset cursor rather
 * than stopping here (`loadOlderNotifications` in `@/lib/notifications/feed`).
 */
const FEED_PAGE_SIZE = 30;

interface NotificationsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps) {
  const session = await verifySession();
  const viewer = notificationViewer(session);

  // Who has no feed at all is now a narrow question (N-027): an account with no
  // tenancy, or one naming two. An oversight account HAS one — `viewer.scope`
  // carries their org and the read spans the plants that opted in — so this is
  // no longer the redirect that kept them off the page. Anyone left has nothing
  // to read; send them somewhere that means something instead of rendering an
  // empty page that looks broken.
  if (!viewer) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const unreadOnly = params.filter === "unread";

  const now = new Date();

  const { rows, nextCursor, unreadCount, hasAny } =
    await loadNotificationFeedScreen(viewer, {
      unreadOnly,
      now,
      limit: FEED_PAGE_SIZE,
    });

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Notifications" }]} />

      <PageCanvas>
        <WorkspacePanel className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
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
              <FilterTab
                href="/notifications"
                active={!unreadOnly}
                testId="all"
              >
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
            // Remount when the tab changes: the appended pages and the cursor
            // below belong to ONE filtered list, and carrying them across a
            // switch would splice unread-only rows into the All tab.
            key={unreadOnly ? "unread" : "all"}
            rows={rows.map((row) => toFeedRow(row, now))}
            nextCursor={serializeFeedCursor(nextCursor)}
            unreadCount={unreadCount}
            hasAny={hasAny}
            unreadOnly={unreadOnly}
          />
        </WorkspacePanel>
      </PageCanvas>
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
