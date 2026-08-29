import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { EvryLauncher } from "@/components/evry/evry-launcher";
import { EvryShell } from "@/components/evry/evry-shell";
import { evrySuggestionsForActor } from "@/components/evry/suggestions/server";
import { HeaderProvider } from "@/components/header";
import { GlobalAppBar } from "@/components/header/global-app-bar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SettingsModal } from "@/components/settings/settings-modal";
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
import { settingsSectionsFor } from "@/lib/settings/sections";
import { DASHBOARD_MAIN_ID } from "@/lib/dashboard/main-region";
import { sidebarDefaultOpen } from "@/lib/dashboard/sidebar-preference";
import {
  notificationViewer,
  type NotificationViewer,
} from "@/lib/notifications/feed";
import { resolveTenancyShell } from "@/lib/navigation";
import { evryPlantStandingOf } from "@/lib/evry/eligibility/viewer";

import { assignedPlantsSafely } from "./assigned-plants";
import { loadUnreadBadgeCountSafely } from "./notification-badge";

const APP_BAR_ICON_CLASS =
  "text-app-bar-foreground hover:bg-white/10 hover:text-app-bar-foreground focus-visible:ring-white/70";

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
  const bellProps = { unreadCount, className: APP_BAR_ICON_CLASS };
  return <NotificationBell {...bellProps} />;
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
  const defaultOpen = sidebarDefaultOpen(
    cookieStore.get("sidebar_state")?.value
  );

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
  // shell components are clients, and a storage key in their props is a key in
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
  const shell = resolveTenancyShell(org?.type ?? "church");

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
  const evryEnabled = evryPlantStandingOf(user).status === "eligible";
  const evrySuggestions = evrySuggestionsForActor(evryEnabled, capabilities);

  return (
    <ViewerCapabilitiesProvider capabilities={capabilities}>
      <SidebarProvider
        data-authenticated-shell
        defaultOpen={defaultOpen}
        className="h-svh flex-col overflow-hidden"
      >
        <a
          href={`#${DASHBOARD_MAIN_ID}`}
          className="bg-card text-foreground focus-visible:ring-ring fixed top-1 left-2 z-50 -translate-y-12 rounded-md px-3 py-2 text-sm font-medium shadow-md focus:translate-y-0 focus-visible:ring-2 focus-visible:outline-none"
        >
          Skip to content
        </a>
        <HeaderProvider>
          <EvryShell
            enabled={evryEnabled}
            eligibleSuggestions={evrySuggestions}
          >
            <GlobalAppBar shell={shell} user={sidebarUser}>
              {viewer && (
                <Suspense
                  fallback={
                    <NotificationBell
                      unreadCount="loading"
                      className={APP_BAR_ICON_CLASS}
                    />
                  }
                >
                  <NotificationBellSlot viewer={viewer} />
                </Suspense>
              )}
              <EvryLauncher />
            </GlobalAppBar>
            <div className="flex min-h-0 flex-1">
              <AppSidebar
                user={sidebarUser}
                orgType={org?.type ?? null}
                hasChurch={!!user.churchId}
                assignedPlants={assignedPlants}
                isPlatformAdmin={userIsPlatformAdmin}
              />
              <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                {/* `tabIndex={-1}` makes the main a reliable skip-link target. The
                settings modal has a narrower focus target inside PageCanvas:
                page content AFTER breadcrumb/actions, so its next Tab cannot
                re-enter contextual navigation.

                `overflow-clip` is load-bearing. `hidden` is still a programmatic
                scroll container, so a nested route transition can offset this
                persistent shell and erase PageCanvas's visual inset. Route
                canvases and specialized panes own scrolling below this clip. */}
                <SidebarInset
                  id={DASHBOARD_MAIN_ID}
                  tabIndex={-1}
                  className="min-h-0 overflow-clip overscroll-y-none outline-none"
                >
                  {children}
                </SidebarInset>
                {/* SETTINGS, MOUNTED ON EVERY DASHBOARD SCREEN AND OPEN ON NONE
              (#657). It draws nothing until `location.hash` names a section, so
              this costs one client component and no read; it lives beside
              `<main>` rather than inside it because the modal covers the screen
              rather than belonging to it, and Radix portals it to the document
              body regardless.

              All three props come from the session this layout already holds, so
              opening settings costs no extra work here. `visibleIds` is the
              NAV's list — `loadSettingsSection` asks the same gate again on the
              server before it reads anything.

              `scope` is WHOSE those answers are, and it is load-bearing: the
              modal caches its section reads in module scope, and signing out is
              a server action ending in `redirect()` — a client-side navigation,
              so the document survives it. Without an identity in the cache key,
              the next account to sign in on this tab was shown the previous
              one's settings while its own read was in flight (#673). */}
                <SettingsModal
                  visibleIds={settingsSectionsFor(user).map(
                    (section) => section.id
                  )}
                  serverRenderId={crypto.randomUUID()}
                  scope={user.id}
                />
                {!org && <WikiGuide />}
              </div>
            </div>
          </EvryShell>
        </HeaderProvider>
      </SidebarProvider>
    </ViewerCapabilitiesProvider>
  );
}
