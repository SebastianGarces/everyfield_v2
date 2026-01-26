"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Search, Bookmark, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArticleNavSection, NavGroup } from "@/lib/wiki/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";

interface WikiSidebarProps {
  groups: NavGroup[];
}

export function WikiSidebar({ groups }: WikiSidebarProps) {
  const pathname = usePathname();

  return (
    <nav className="space-y-3">
      {/* Search placeholder */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <div className="h-9 w-full rounded-md border border-input bg-background px-8 py-2 text-sm text-muted-foreground">
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
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Resources
            </div>
            <div className="space-y-0.5 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 rounded-md px-2 py-1 opacity-50">
                <span>Templates & Downloads</span>
                <span className="text-xs">(coming soon)</span>
              </div>
              <div className="flex items-center gap-2 rounded-md px-2 py-1 opacity-50">
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
        <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground opacity-50">
          <Bookmark className="h-4 w-4" />
          <span>My Bookmarks</span>
          <span className="text-xs">(coming soon)</span>
        </div>
        <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground opacity-50">
          <Clock className="h-4 w-4" />
          <span>Recently Viewed</span>
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
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
      <CollapsibleTrigger className="group flex w-full items-center gap-1 py-0.5 text-left text-sm font-medium text-foreground hover:text-foreground/80">
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
            "group flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
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
        "block rounded px-2 py-0.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        isActive && "bg-muted font-medium text-foreground"
      )}
    >
      {item.title}
    </Link>
  );
}
