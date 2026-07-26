"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { List } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOC_MIN_HEADINGS, type TocHeading } from "@/lib/wiki/toc";

/**
 * Distance from the top of the viewport at which a heading counts as "the
 * section you are reading". Matches the `scroll-m-20` (5rem) offset the MDX
 * headings carry, with room to spare so the heading you just jumped to reads
 * as active rather than the one above it.
 */
const ACTIVE_OFFSET_PX = 120;

type TableOfContentsProps = {
  headings: TocHeading[];
};

/**
 * Right-side table of contents for a wiki article (W-014).
 *
 * Renders nothing below `TOC_MIN_HEADINGS` headings. Above the layout's `lg`
 * breakpoint it is a sticky right rail beside the prose; below it, it collapses
 * into a closed disclosure above the article so it never overlaps the text.
 *
 * Scroll position is *not* persisted here — reading progress is W-012's job
 * (`ProgressTracker`), and this component deliberately only reads scroll state.
 */
export function TableOfContents({ headings }: TableOfContentsProps) {
  const activeId = useActiveHeadingId(headings);

  if (headings.length < TOC_MIN_HEADINGS) {
    return null;
  }

  return (
    <>
      {/* Below `lg`: collapsed, above the prose, out of the way. */}
      <details
        data-testid="wiki-toc-mobile"
        className="bg-muted/40 order-first rounded-lg border px-4 py-3 lg:hidden"
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
          <List className="h-4 w-4 shrink-0" aria-hidden="true" />
          On this page
        </summary>
        <nav aria-label="Table of contents" className="mt-3">
          <TocLinks headings={headings} activeId={activeId} />
        </nav>
      </details>

      {/* `lg` and up: sticky right rail. */}
      <nav
        data-testid="wiki-toc"
        aria-label="Table of contents"
        className="sticky top-6 hidden w-48 shrink-0 self-start lg:block xl:w-56"
      >
        <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
          On this page
        </p>
        <TocLinks headings={headings} activeId={activeId} />
      </nav>
    </>
  );
}

function TocLinks({
  headings,
  activeId,
}: {
  headings: TocHeading[];
  activeId: string | null;
}) {
  return (
    <ul className="space-y-1 text-sm">
      {headings.map((heading, index) => {
        const isActive = heading.id === activeId;
        return (
          <li key={`${heading.id}-${index}`}>
            <a
              href={`#${heading.id}`}
              data-testid="wiki-toc-entry"
              data-active={isActive ? "true" : "false"}
              aria-current={isActive ? "location" : undefined}
              className={cn(
                "hover:text-foreground block cursor-pointer border-l-2 py-1 leading-snug transition-colors",
                heading.level === 3 ? "pl-6" : "pl-3",
                isActive
                  ? "border-primary text-primary font-medium"
                  : "text-muted-foreground border-transparent"
              )}
            >
              {heading.text}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Which heading the reader is currently under.
 *
 * Scroll position is an external store, so it is read as one: `subscribe`
 * listens, `getSnapshot` reads the live geometry of the rendered headings. No
 * scroll state is mirrored into React state, which is also why there is no
 * effect here to fall out of sync.
 *
 * Listening happens in the capture phase on `window` because the article
 * scrolls inside the wiki layout's `overflow-y-auto` column rather than the
 * window, and scroll events do not bubble. `getBoundingClientRect()` is then
 * correct whichever element actually moved.
 */
function useActiveHeadingId(headings: TocHeading[]): string | null {
  const ids = useMemo(() => headings.map((heading) => heading.id), [headings]);

  const subscribe = useCallback((onStoreChange: () => void) => {
    let frame = 0;

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        onStoreChange();
      });
    };

    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const getSnapshot = useCallback(() => activeHeadingId(ids), [ids]);

  // On the server there is no geometry to read: the reader starts at the top,
  // so the first heading is the honest answer.
  const getServerSnapshot = useCallback(() => ids[0] ?? null, [ids]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The last heading whose top has passed the active line, else the first. */
function activeHeadingId(ids: string[]): string | null {
  if (ids.length === 0) return null;

  let current = ids[0];

  for (const id of ids) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (element.getBoundingClientRect().top > ACTIVE_OFFSET_PX) break;
    current = id;
  }

  return current;
}
