import { TocProvider } from "@/components/wiki/toc-store";
import { TocPrototypeSwitcher } from "@/components/wiki/toc-prototype-switcher";
import { WikiSidebar } from "@/components/wiki/wiki-sidebar";
import { getBookmarks, getRecentlyViewed, getWikiNavigation } from "@/lib/wiki";

// Force dynamic rendering for recently viewed data
export const dynamic = "force-dynamic";

// TEMPORARY (W-014 layout ruling): re-apply the stored TOC prototype before
// first paint, so a reload does not flash prototype A. React never manages
// <html> attributes, so this cannot cause a hydration mismatch.
const APPLY_TOC_PROTO = `try{var p=localStorage.getItem("wiki-toc-proto");document.documentElement.dataset.tocProto=p==="b"||p==="c"?p:"a"}catch(e){document.documentElement.dataset.tocProto="a"}`;

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
    <TocProvider>
      <script dangerouslySetInnerHTML={{ __html: APPLY_TOC_PROTO }} />
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

        {/* Main content. In prototype A the card widens — but only when the
            page inside actually renders a right-rail TOC — so the prose keeps
            its ~768px measure beside the rail instead of shrinking to 448px. */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="bg-card mx-auto max-w-3xl rounded-xl px-8 py-10 shadow-sm [[data-toc-proto=a]_&]:lg:has-[[data-testid=wiki-toc]]:max-w-[68rem]">
            {children}
          </div>
        </div>
      </div>
      <TocPrototypeSwitcher />
    </TocProvider>
  );
}
