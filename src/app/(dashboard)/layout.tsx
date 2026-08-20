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
import { oversightOrgOf } from "@/lib/auth/tenancy";
import { loginPathFor } from "@/lib/auth/safe-redirect";
import { isCrawlerPreviewRequest, ROUTED_URL_HEADER } from "@/lib/crawler";
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
  // Re-derived here from the same two inputs, and by the same predicate, the
  // proxy used to decide not to bounce this request to /login: the request's own
  // `user-agent`, and the URL the proxy stamped on the request. It used to
  // read an `x-is-crawler` request header instead, which the proxy only ever set
  // on the RESPONSE — nothing in the app wrote that header, so the branch fired
  // only for a client that forged it (#240).
  //
  // The route half is what keeps this branch to the ~3 routes the proxy
  // actually admits crawlers to. Without it, every route in the group took the
  // bare shell, and the six that need a session (/people, /settings, /tasks,
  // /teams, /meetings, /notifications) answered a crawler-shaped User-Agent with
  // a 500 from the page's own `verifySession()` instead of this redirect — which
  // a logged-out human in WhatsApp's in-app browser would have hit too. See
  // `src/lib/crawler.ts` for what this check does and does not authorise.
  const routedUrl = headersList.get(ROUTED_URL_HEADER);
  const isCrawlerPreview = isCrawlerPreviewRequest(
    headersList.get("user-agent"),
    routedUrl
  );

  // For crawlers without auth, render minimal shell for metadata scraping only
  if (!user && isCrawlerPreview) {
    return <>{children}</>;
  }

  if (!user) {
    // Carrying where to come back to, from the same header and through the same
    // builder the proxy uses (#503). This branch is not the proxy's leftovers:
    // it is the ONLY bounce for the routes in this group the proxy does not
    // protect — /settings, /people, /tasks, /teams, /meetings, /notifications —
    // and the only one at all for a session cookie that exists but fails to
    // verify, which the proxy cannot detect because it only reads the cookie.
    // A bare `/login` here is what sent a reader following a deep link to the
    // dashboard instead of the page they asked for.
    redirect(loginPathFor(routedUrl));
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
  };

  // ONE derivation of the caller's tenancy, read twice below: the nav keys off
  // the org KIND, and the Wiki guide is hidden for an oversight account because
  // the wiki is the plant's own library.
  const org = oversightOrgOf(user);

  const userIsPlatformAdmin = isPlatformAdmin(user);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        user={sidebarUser}
        orgType={org?.type ?? null}
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
          {!org && <WikiGuide />}
        </HeaderProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
