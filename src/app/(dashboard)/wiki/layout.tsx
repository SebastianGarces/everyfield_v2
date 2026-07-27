import { WikiSidebar } from "@/components/wiki/wiki-sidebar";
import { getBookmarks, getRecentlyViewed, getWikiNavigation } from "@/lib/wiki";

// Force dynamic rendering for recently viewed data
export const dynamic = "force-dynamic";

export default async function WikiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [groups, recentlyViewed, bookmarks] = await Promise.all([
    getWikiNavigation(),
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
          squeezed to 448px beside the rail: 62rem − padding − w-48 rail − gap
          at lg, 64rem − padding − w-56 rail − gap at xl, both = 44rem. */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-card mx-auto max-w-3xl rounded-xl px-8 py-10 shadow-sm lg:has-[[data-testid=wiki-toc]]:max-w-[62rem] xl:has-[[data-testid=wiki-toc]]:max-w-5xl">
          {children}
        </div>
      </div>
    </div>
  );
}
