import { getWikiNavigation } from "@/lib/wiki";
import { WikiSidebar } from "@/components/wiki/wiki-sidebar";

export default async function WikiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigation = await getWikiNavigation();

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 border-r bg-muted/30 lg:block">
        <div className="h-full overflow-y-auto px-4 py-4">
          <WikiSidebar sections={navigation} />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-10">{children}</div>
      </div>
    </div>
  );
}
