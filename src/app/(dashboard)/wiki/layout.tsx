import { WikiSidebar } from "@/components/wiki/wiki-sidebar";
import {
  HeaderBreadcrumbs,
  PageContext,
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
    <PageCanvas
      className="overflow-hidden"
      contentClassName="h-full"
      context="none"
    >
      {/* Header context is state, not paint: CSS cannot replace the dashboard
          fallback with this route's page-context label. */}
      <HeaderBreadcrumbs items={WIKI_BREADCRUMBS} />
      <SplitWorkspace
        data-context-layout="single-suppressed"
        className="grid-rows-[auto_minmax(0,1fr)] [[data-auth-page-hierarchy=b]_&]:gap-y-0"
      >
        <PageContext
          attachment="attached"
          className="col-span-full [[data-auth-page-hierarchy=b]_&]:lg:col-span-1 [[data-auth-page-hierarchy=b]_&]:lg:col-start-2"
          items={WIKI_BREADCRUMBS}
        />
        {/* The secondary navigation needs its own surface beside the article
            workspace. CSS alone could not separate it while the old sidebar
            and content were siblings on one uninterrupted canvas. */}
        <WorkspacePanel className="hidden h-full overflow-hidden lg:block">
          <aside className="h-full overflow-y-auto p-4">
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
          className="h-full overflow-y-auto outline-none [container:wiki-content/size] lg:col-start-2 lg:row-start-2"
        >
          <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-10 @min-[65rem]/wiki-content:has-[[data-testid=wiki-toc]]:max-w-[62rem] @min-[67rem]/wiki-content:has-[[data-testid=wiki-toc]]:max-w-5xl">
            {children}
          </div>
        </WorkspacePanel>
      </SplitWorkspace>
    </PageCanvas>
  );
}
