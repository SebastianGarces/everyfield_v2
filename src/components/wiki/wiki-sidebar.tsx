"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArticleNavSection } from "@/lib/wiki/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface WikiSidebarProps {
  sections: ArticleNavSection[];
}

export function WikiSidebar({ sections }: WikiSidebarProps) {
  const pathname = usePathname();

  return (
    <nav className="space-y-4">
      {sections.map((section) => (
        <SidebarSection
          key={section.slug}
          section={section}
          pathname={pathname}
        />
      ))}
    </nav>
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
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 py-1 text-left text-sm font-semibold text-foreground hover:text-foreground/80">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
        <span>{section.title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-0.5">
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
            "group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
            (isActive || hasActiveChild) && "text-foreground"
          )}
        >
          <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
          <span>{item.title}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-0.5 space-y-0.5">
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
        "block rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        isActive && "bg-muted font-medium text-foreground"
      )}
    >
      {item.title}
    </Link>
  );
}
