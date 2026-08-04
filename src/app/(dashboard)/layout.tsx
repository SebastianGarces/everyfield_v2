import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { DashboardHeader, HeaderProvider } from "@/components/header";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WikiGuide } from "@/components/wiki-guide";
import { getCurrentSession } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/auth/admin";
import { isCrawlerUserAgent } from "@/lib/crawler";
import {
  notificationViewer,
  type NotificationViewer,
} from "@/lib/notifications/feed";

import {
  DEGRADED_UNREAD_COUNT,
  loadUnreadBadgeCountSafely,
} from "./notification-badge";

/**
 * The badge, read inside its own boundary rather than in the layout body.
 *
 * Two things follow from that, and both exist because this read runs on EVERY
 * dashboard route (#227). It cannot fail the shell — `loadUnreadBadgeCountSafely`
 * degrades a throwing count to zero — and it cannot delay the shell, because the
 * `await` happens below a `<Suspense>` boundary instead of above the whole tree.
 * Notifications being slow or broken is now a bell that says "none unread", not
 * a dashboard nobody can reach.
 */
async function NotificationBellSlot({
  viewer,
}: {
  viewer: NotificationViewer;
}) {
  const unreadCount = await loadUnreadBadgeCountSafely(viewer);
  return <NotificationBell unreadCount={unreadCount} />;
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email.substring(0, 2).toUpperCase();
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getCurrentSession();
  const headersList = await headers();
  // Derived here from the request's own `user-agent` — the same input, and the
  // same predicate, the proxy used to decide not to bounce this request to
  // /login. It used to read an `x-is-crawler` request header instead, which the
  // proxy only ever set on the RESPONSE: nothing in the app wrote that header,
  // so the branch fired only for a client that forged it (#240). See
  // `src/lib/crawler.ts` for what this check does and does not authorise.
  const isCrawler = isCrawlerUserAgent(headersList.get("user-agent"));

  // For crawlers without auth, render minimal shell for metadata scraping only
  if (!user && isCrawler) {
    return <>{children}</>;
  }

  if (!user) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  // Whether there is a bell at all (N-008). Resolved here, in the one place
  // that already holds the session, so the bell itself stays a presentational
  // component. A user with no church has no notifications — every row is
  // church-scoped — so there is no viewer, nothing to count and no bell to show.
  //
  // The count itself is NOT awaited here: it is read inside
  // `NotificationBellSlot`, below the Suspense boundary, so a notifications-side
  // failure or stall stays inside the bell instead of taking the shell with it.
  const viewer = notificationViewer({ user });

  const sidebarUser = {
    name: user.name || user.email.split("@")[0],
    email: user.email,
    initials: getInitials(user.name, user.email),
    role: user.role,
  };

  const isOversightUser =
    user.role === "sending_church_admin" || user.role === "network_admin";

  const userIsPlatformAdmin = isPlatformAdmin(user);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        user={sidebarUser}
        hasChurch={!!user.churchId}
        isPlatformAdmin={userIsPlatformAdmin}
      />
      <SidebarInset className="flex h-screen flex-col overflow-hidden">
        <HeaderProvider>
          <DashboardHeader>
            {viewer && (
              // The fallback is the bell itself at zero, so the header's
              // geometry and its link to /notifications are there from the
              // first byte and the count fills in when it arrives.
              <Suspense
                fallback={
                  <NotificationBell unreadCount={DEGRADED_UNREAD_COUNT} />
                }
              >
                <NotificationBellSlot viewer={viewer} />
              </Suspense>
            )}
          </DashboardHeader>
          <main className="flex-1 overflow-auto">{children}</main>
          {!isOversightUser && <WikiGuide />}
        </HeaderProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
