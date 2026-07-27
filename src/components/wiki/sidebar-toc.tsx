"use client";

import { TOC_MIN_HEADINGS } from "@/lib/wiki/toc";
import { TocLinks, useActiveHeadingId } from "./table-of-contents";
import { useSidebarToc } from "./toc-store";

/**
 * Prototype B of the W-014 layout ruling: the active article's table of
 * contents, nested under that article's item in the left sidebar. The sidebar
 * only ever renders one TOC — the store only holds the article being read,
 * and the active sidebar item is the only caller whose `href` matches it.
 *
 * Visible only while `data-toc-proto="b"` (see `toc-prototype-switcher.tsx`).
 */
export function SidebarArticleToc({ href }: { href: string }) {
  const entry = useSidebarToc();
  const headings = entry?.href === href ? entry.headings : [];
  const activeId = useActiveHeadingId(headings);

  if (headings.length < TOC_MIN_HEADINGS) {
    return null;
  }

  return (
    <nav
      data-testid="wiki-toc-sidebar"
      aria-label="Table of contents"
      className="hidden px-2 pt-1 pb-2 [[data-toc-proto=b]_&]:block"
    >
      <TocLinks
        headings={headings}
        activeId={activeId}
        entryTestId="wiki-toc-sidebar-entry"
      />
    </nav>
  );
}
