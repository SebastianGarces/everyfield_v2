import { getWikiNavigation, getRecentlyViewed } from "@/lib/wiki";
import { WikiSidebar } from "@/components/wiki/wiki-sidebar";

// Force dynamic rendering for recently viewed data
export const dynamic = "force-dynamic";

export default async function WikiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [groups, recentlyViewed] = await Promise.all([
    getWikiNavigation(),
    getRecentlyViewed(5),
  ]);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 border-r bg-muted/30 lg:block">
        <div className="h-full overflow-y-auto px-4 py-4">
          <WikiSidebar groups={groups} recentlyViewed={recentlyViewed} />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-10">{children}</div>
      </div>
    </div>
  );
}
