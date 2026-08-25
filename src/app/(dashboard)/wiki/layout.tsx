import { WikiSidebar } from "@/components/wiki/wiki-sidebar";
import {
  HeaderBreadcrumbs,
  type HeaderBreadcrumbItem,
} from "@/components/header";
import {
  PageCanvas,
  SplitWorkspace,
  WorkspacePanel,
} from "@/components/layout/page-frame";
import { getCurrentSession } from "@/lib/auth";
import { DASHBOARD_PAGE_CONTENT_ID } from "@/lib/dashboard/main-region";
import { getBookmarks, getRecentlyViewed, getWikiNavigation } from "@/lib/wiki";

// Force dynamic rendering for recently viewed data
export const dynamic = "force-dynamic";

const WIKI_BREADCRUMBS: HeaderBreadcrumbItem[] = [{ label: "Wiki" }];

export default async function WikiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The navigation is a tenancy-scoped read (#317): a church's own articles
  // belong in its sidebar, another church's never do. `getCurrentSession` is
  // `React.cache`d and the dashboard layout above has already called it, so
  // reading it here costs no extra query — and awaiting it before the
  // `Promise.all` costs no round trip either.
  const { user } = await getCurrentSession();

  const [groups, recentlyViewed, bookmarks] = await Promise.all([
    getWikiNavigation(user?.churchId ?? null),
    getRecentlyViewed(5),
    getBookmarks(10),
  ]);

  return (
    /* `overflow-clip` is load-bearing: unlike `hidden`, it does not make this
       persistent canvas a scroll container that a nested route transition can
       offset. The navigation and article panes below remain the scroll owners. */
    <PageCanvas
      className="overflow-clip"
      contentClassName="h-full"
      context="none"
    >
      {/* Preserve the route's declared context state for nested consumers even
          though the ruled Wiki workspace renders no visible context row. */}
      <HeaderBreadcrumbs items={WIKI_BREADCRUMBS} />
      <SplitWorkspace className="grid-rows-[minmax(0,1fr)]">
        {/* The secondary navigation needs its own surface beside the article
            workspace. CSS alone could not separate it while the old sidebar
            and content were siblings on one uninterrupted canvas. */}
        <WorkspacePanel className="hidden h-full overflow-hidden lg:col-start-1 lg:row-start-1 lg:block">
          <aside className="h-full overflow-y-auto overscroll-y-none p-4">
            <WikiSidebar
              groups={groups}
              recentlyViewed={recentlyViewed}
              bookmarks={bookmarks}
            />
          </aside>
        </WorkspacePanel>

        {/* Main content. When the page inside renders a right-rail TOC, the
          content widens just enough that the prose keeps the same 704px measure
          it has on a TOC-less page instead of being squeezed beside the rail.

          The thresholds are CONTAINER queries on this column, not viewport
          breakpoints: the rail only exists once the column genuinely fits the
          widened card (65rem = 62rem card + p-6), so the prose is never
          compressed below its measure by a rail the viewport cannot afford —
          below that the TOC stays a disclosure above the article, whatever
          the surrounding sidebars are doing. */}
        <WorkspacePanel
          id={DASHBOARD_PAGE_CONTENT_ID}
          tabIndex={-1}
          className="row-start-1 h-full overflow-y-auto overscroll-y-none outline-none [container:wiki-content/size] lg:col-start-2"
        >
          <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-10 @min-[65rem]/wiki-content:has-[[data-testid=wiki-toc]]:max-w-[62rem] @min-[67rem]/wiki-content:has-[[data-testid=wiki-toc]]:max-w-5xl">
            {children}
          </div>
        </WorkspacePanel>
      </SplitWorkspace>
    </PageCanvas>
  );
}
