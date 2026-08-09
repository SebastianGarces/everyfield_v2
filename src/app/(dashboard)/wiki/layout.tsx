import { WikiSidebar } from "@/components/wiki/wiki-sidebar";
import { getCurrentSession } from "@/lib/auth";
import { getBookmarks, getRecentlyViewed, getWikiNavigation } from "@/lib/wiki";

// Force dynamic rendering for recently viewed data
export const dynamic = "force-dynamic";

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
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="bg-card hidden w-72 shrink-0 border-r lg:block">
        <div className="h-full overflow-y-auto px-4 py-4">
          <WikiSidebar
            groups={groups}
            recentlyViewed={recentlyViewed}
            bookmarks={bookmarks}
          />
        </div>
      </aside>

      {/* Main content. When the page inside renders a right-rail TOC, the card
          widens just enough that the prose keeps the same 704px measure it has
          on a TOC-less page (card 48rem − 4rem padding) instead of being
          squeezed beside the rail: 62rem − padding − w-48 rail − gap, or with
          the wider rail 64rem − padding − w-56 rail − gap, both = 44rem.

          The thresholds are CONTAINER queries on this column, not viewport
          breakpoints: the rail only exists once the column genuinely fits the
          widened card (65rem = 62rem card + p-6), so the prose is never
          compressed below its measure by a rail the viewport cannot afford —
          below that the TOC stays a disclosure above the article, whatever
          the surrounding sidebars are doing. */}
      <div className="@container/wiki-content flex-1 overflow-y-auto p-6">
        <div className="bg-card mx-auto max-w-3xl rounded-xl px-8 py-10 shadow-sm @min-[65rem]/wiki-content:has-[[data-testid=wiki-toc]]:max-w-[62rem] @min-[67rem]/wiki-content:has-[[data-testid=wiki-toc]]:max-w-5xl">
          {children}
        </div>
      </div>
    </div>
  );
}
