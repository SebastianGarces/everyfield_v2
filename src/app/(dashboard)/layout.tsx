import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { DashboardHeader, HeaderProvider } from "@/components/header";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ViewerCapabilitiesProvider } from "@/components/shared/viewer-capabilities";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WikiGuide } from "@/components/wiki-guide";
import { getCurrentSession } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/auth/admin";
import { heldCapabilities } from "@/lib/auth/seat-rules";
import { oversightOrgOf } from "@/lib/auth/tenancy";
import { loginPathFor } from "@/lib/auth/safe-redirect";
import { isCrawlerPreviewRequest } from "@/lib/crawler";
import { accountInitials, userAvatarSrc } from "@/lib/profile-photo";
import { ROUTED_URL_HEADER } from "@/lib/routed-url";
import { DASHBOARD_MAIN_ID } from "@/lib/dashboard/main-region";
import {
  notificationViewer,
  type NotificationViewer,
} from "@/lib/notifications/feed";

import { assignedPlantsSafely } from "./assigned-plants";
import { loadUnreadBadgeCountSafely } from "./notification-badge";

/**
 * The badge, read inside its own boundary rather than in the layout body.
 *
 * Two things follow from that, and both exist because this read runs on EVERY
 * dashboard route (#227). It cannot fail the shell — `loadUnreadBadgeCountSafely`
 * turns a throwing count into `"unavailable"` — and it cannot delay the shell,
 * because the `await` happens below a `<Suspense>` boundary instead of above the
 * whole tree. Notifications being slow or broken is now a bell with no number on
 * it, not a dashboard nobody can reach.
 */
async function NotificationBellSlot({
  viewer,
}: {
  viewer: NotificationViewer;
}) {
  const unreadCount = await loadUnreadBadgeCountSafely(viewer);
  return <NotificationBell unreadCount={unreadCount} />;
}

export default async function DashboardLayout({
  children,
  settings,
}: {
  children: React.ReactNode;
  /**
   * The settings modal's parallel slot (#615, ruled 2026-08-21 §187).
   *
   * It renders BESIDE `children`, never instead of it, which is the whole
   * mechanism: `@settings/(.)settings/…` intercepts an in-app navigation to a
   * settings URL, so this slot fills while the screen the reader was on stays
   * mounted underneath with its state intact. On every other route the slot's
   * `default.tsx` renders nothing.
   */
  settings: React.ReactNode;
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
    // THE bounce for this group, carrying where to come back to — same header,
    // same builder the proxy uses (#503). A bare `/login` here is what sent a
    // reader following a deep link to the dashboard instead of the page they
    // asked for.
    //
    // It is not the proxy's leftovers. It is the only bounce for the routes the
    // proxy does not protect (/settings, /people, /tasks, /teams, /meetings,
    // /notifications), and the only one for a session cookie that EXISTS but no
    // longer verifies — the proxy reads presence, not validity, so that reader
    // looks signed-in to it and signed-out here.
    //
    // That second case only terminates because `/login` is not on the proxy's
    // `AUTH_ROUTES`. While it was, this redirect and that one chased each other
    // — dead cookie in the jar, so the proxy sent the reader back to the route
    // that had just refused them — and the loop ended at ERR_TOO_MANY_REDIRECTS
    // rather than at the form that would have fixed it. Putting `/login` back
    // on that list restores the loop; `proxy.test.ts` fails first if anyone does.
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

  // The picture is resolved to a ROUTE here, never handed down as a key: the
  // sidebar is a client component, and a storage key in its props is a key in
  // the RSC payload (CS-004, #617).
  const sidebarUser = {
    name: user.name || user.email.split("@")[0],
    email: user.email,
    initials: accountInitials(user.name, user.email),
    avatarSrc: userAvatarSrc(user.avatarKey),
  };

  // ONE derivation of the caller's tenancy, read twice below: the nav keys off
  // the org KIND, and the Wiki guide is hidden for an oversight account because
  // the wiki is the plant's own library.
  const org = oversightOrgOf(user);

  const userIsPlatformAdmin = isPlatformAdmin(user);

  // The coaching reach, read for the sidebar's "Assigned plants" section
  // (#496). Independent of `org` above: an oversight Owner who also coaches a
  // plant has both, and each is drawn in its own section from its own consent.
  //
  // STARTED HERE AND AWAITED IN THE SIDEBAR (#569), on the same two grounds as
  // the badge below. It cannot fail the shell — `assignedPlantsSafely` turns a
  // throwing join into an empty list — and it cannot delay the shell, because
  // the promise crosses into `AppSidebar` unawaited and is unwrapped under a
  // `<Suspense>` boundary there. An `await` on this line is the whole dashboard
  // waiting on a query that returns nothing for nearly every account.
  const assignedPlants = assignedPlantsSafely(user.id);

  // WHAT THIS ACCOUNT MAY DO, resolved once for the whole tree (AS-020, #499).
  //
  // The same table `requireSeat` reads, so a control's visibility and the
  // server's refusal cannot disagree. Server components below keep asking
  // `holdsSeatFor` with this same `user`; only the client half needs carrying,
  // and it is carried from here so no screen re-derives it.
  const capabilities = heldCapabilities(user);

  return (
    <ViewerCapabilitiesProvider capabilities={capabilities}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar
          user={sidebarUser}
          orgType={org?.type ?? null}
          hasChurch={!!user.churchId}
          assignedPlants={assignedPlants}
          isPlatformAdmin={userIsPlatformAdmin}
        />
        <SidebarInset className="flex h-screen flex-col overflow-hidden">
          <HeaderProvider>
            <DashboardHeader>
              {viewer && (
                // The fallback is the bell in its LOADING state, so the header's
                // geometry and its link to /notifications are there from the
                // first byte while the count itself stays unclaimed until it
                // arrives.
                //
                // It is NOT a zero (#308 WS2, from #232; #528). A failed read
                // and a not-yet-finished one both used to arrive here as the
                // number the FAILURE path returned, which announces
                // "Notifications, none unread" to a screen reader and then
                // corrects itself to "1 unread" a moment later. Both are values
                // of `UnreadCount` now, so neither can be spelled as a count; see
                // `notification-bell.tsx`'s header for the rest of the argument.
                <Suspense fallback={<NotificationBell unreadCount="loading" />}>
                  <NotificationBellSlot viewer={viewer} />
                </Suspense>
              )}
            </DashboardHeader>
            {/* `tabIndex={-1}` so the settings modal has somewhere to put focus
              when it closes. The control that opened it — a Settings item
              inside the avatar dropdown — is gone by then, so Radix's
              restore-to-trigger lands on `<body>` and a keyboard reader has to
              tab from the top of the document. Focusing the main region instead
              is the SPA-navigation answer, and it is `-1` so nothing joins the
              tab order. */}
            <main
              id={DASHBOARD_MAIN_ID}
              tabIndex={-1}
              className="flex-1 overflow-auto outline-none"
            >
              {children}
            </main>
            {/* Beside `children`, not inside `<main>`: the modal is a sibling of
              the screen it covers, and Radix portals it to the document body
              regardless. Rendered here so it sits inside the router and sidebar
              providers it reads. */}
            {settings}
            {!org && <WikiGuide />}
          </HeaderProvider>
        </SidebarInset>
      </SidebarProvider>
    </ViewerCapabilitiesProvider>
  );
}
