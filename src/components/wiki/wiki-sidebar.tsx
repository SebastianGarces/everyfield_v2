"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { ArticleNavSection, NavGroup } from "@/lib/wiki/types";
import { Bookmark, ChevronRight, Clock, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface WikiSidebarProps {
  groups: NavGroup[];
}

export function WikiSidebar({ groups }: WikiSidebarProps) {
  const pathname = usePathname();

  return (
    <nav className="space-y-3">
      {/* Search placeholder */}
      <div className="relative">
        <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
        <div className="border-input bg-background text-muted-foreground h-9 w-full rounded-md border px-8 py-2 text-sm">
          Search coming soon...
        </div>
      </div>

      {groups.map((group, index) => (
        <div key={group.slug}>
          {index > 0 && <Separator className="mb-3" />}
          <SidebarGroup group={group} pathname={pathname} />
        </div>
      ))}

      {/* Resources placeholder if no resources group exists */}
      {!groups.some((g) => g.slug === "resources") && (
        <>
          <Separator />
          <div>
            <div className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wider uppercase">
              Resources
            </div>
            <div className="text-muted-foreground space-y-0.5 text-sm">
              <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1 opacity-50">
                <span>Templates & Downloads</span>
                <span className="text-xs">(coming soon)</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1 opacity-50">
                <span>Training Library</span>
                <span className="text-xs">(coming soon)</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Bookmarks and Recently Viewed placeholders */}
      <Separator />
      <div className="space-y-0.5">
        <div className="text-muted-foreground flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm opacity-50">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4" />
            <span>My Bookmarks</span>
          </div>
          <span className="text-xs">(coming soon)</span>
        </div>
        <div className="text-muted-foreground flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm opacity-50">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>Recently Viewed</span>
          </div>
          <span className="text-xs">(coming soon)</span>
        </div>
      </div>
    </nav>
  );
}

function SidebarGroup({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wider uppercase">
        {group.title}
      </div>
      <div className="space-y-1">
        {group.sections.map((section) => (
          <SidebarSection
            key={section.slug}
            section={section}
            pathname={pathname}
          />
        ))}
      </div>
    </div>
  );
}

function SidebarSection({
  section,
  pathname,
}: {
  section: ArticleNavSection;
  pathname: string;
}) {
  // Check if any article in this section is active
  const hasActiveChild = section.items.some(
    (item) =>
      pathname === item.href ||
      item.children?.some((child) => pathname === child.href)
  );

  return (
    <Collapsible defaultOpen={hasActiveChild}>
      <CollapsibleTrigger className="group text-foreground hover:text-foreground/80 flex w-full items-center gap-1 py-0.5 text-left text-sm font-medium">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
        <span>{section.title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-0.5 space-y-px">
        {section.items.map((item) => (
          <SidebarItem key={item.slug} item={item} pathname={pathname} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function SidebarItem({
  item,
  pathname,
}: {
  item: ArticleNavSection["items"][number];
  pathname: string;
}) {
  const hasChildren = item.children && item.children.length > 0;
  const isActive = pathname === item.href;
  const hasActiveChild = item.children?.some(
    (child) => pathname === child.href
  );

  if (hasChildren) {
    return (
      <Collapsible defaultOpen={hasActiveChild || isActive}>
        <CollapsibleTrigger
          className={cn(
            "group text-muted-foreground hover:bg-muted hover:text-foreground flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-sm",
            (isActive || hasActiveChild) && "text-foreground"
          )}
        >
          <ChevronRight className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
          <span>{item.title}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-px">
          {item.children!.map((child) => (
            <SidebarItem key={child.slug} item={child} pathname={pathname} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(
        "text-muted-foreground hover:bg-muted hover:text-foreground block rounded px-2 py-0.5 text-sm",
        isActive && "bg-muted text-foreground font-medium"
      )}
    >
      {item.title}
    </Link>
  );
}
