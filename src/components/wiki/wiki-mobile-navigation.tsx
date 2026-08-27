"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { NavGroup } from "@/lib/wiki/types";
import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { WikiSidebar } from "./wiki-sidebar";
import { shouldCloseWikiMobileNavigation } from "./wiki-search-shortcut";

interface RecentlyViewedItem {
  slug: string;
  title: string;
  status: string;
  scrollPosition: number | null;
  lastViewedAt: Date;
}

interface BookmarkItem {
  slug: string;
  title: string;
  createdAt: Date;
}

interface WikiMobileNavigationProps {
  groups: NavGroup[];
  recentlyViewed?: RecentlyViewedItem[];
  bookmarks?: BookmarkItem[];
}

/** Mobile access to the same Wiki navigation rendered beside the article on desktop. */
export function WikiMobileNavigation({
  groups,
  recentlyViewed = [],
  bookmarks = [],
}: WikiMobileNavigationProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (shouldCloseWikiMobileNavigation(event.matches)) {
        setOpen(false);
      }
    };

    desktopQuery.addEventListener("change", closeOnDesktop);
    return () => desktopQuery.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start gap-2 lg:hidden"
        >
          <BookOpen className="size-4" aria-hidden="true" />
          Browse Wiki
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0 lg:hidden"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Browse Wiki</SheetTitle>
          <SheetDescription>Search and browse Wiki articles.</SheetDescription>
        </SheetHeader>
        <aside className="min-h-0 flex-1 overflow-y-auto overscroll-x-none overscroll-y-none p-4">
          <WikiSidebar
            groups={groups}
            recentlyViewed={recentlyViewed}
            bookmarks={bookmarks}
            onNavigate={() => setOpen(false)}
            shortcutScope="mobile"
          />
        </aside>
      </SheetContent>
    </Sheet>
  );
}
