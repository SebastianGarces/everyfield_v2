"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { List } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  activeHeadingId,
  TOC_ACTIVE_LINE_FALLBACK_PX,
  TOC_MIN_HEADINGS,
  type MeasuredHeading,
  type TocHeading,
} from "@/lib/wiki/toc";

/**
 * Slack added below a heading's landing position before it counts as reached,
 * to absorb the fractional pixels scrolling leaves behind.
 */
const LANDING_TOLERANCE_PX = 8;

/** Treat a scroll container this close to its end as scrolled to the end. */
const SCROLL_END_EPSILON_PX = 2;

type TableOfContentsProps = {
  headings: TocHeading[];
};

/**
 * Right-side table of contents for a wiki article (W-014).
 *
 * Renders nothing below `TOC_MIN_HEADINGS` headings. Once the wiki layout's
 * content column can afford it — a container query, mirroring the card
 * widening in `wiki/layout.tsx`, so the prose keeps its 704px measure — it
 * is a sticky right rail beside the prose, capped to the viewport and scrolling
 * inside itself so a long TOC never has to be chased down the article; in
 * narrower columns it collapses into a closed disclosure above the article so it
 * never squeezes the text.
 *
 * Scroll position is *not* persisted here — reading progress is W-012's job
 * (`ProgressTracker`), and this component deliberately only reads scroll state.
 */
export function TableOfContents({ headings }: TableOfContentsProps) {
  const activeId = useActiveHeadingId(headings);
  const listRef = useFollowActiveEntry(activeId);

  if (headings.length < TOC_MIN_HEADINGS) {
    return null;
  }

  return (
    <>
      {/* Narrow column: collapsed, above the prose, out of the way. */}
      <details
        data-testid="wiki-toc-mobile"
        className="bg-muted/40 order-first rounded-lg border px-4 py-3 @min-[65rem]/wiki-content:hidden"
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
          <List className="h-4 w-4 shrink-0" aria-hidden="true" />
          On this page
        </summary>
        <nav aria-label="Table of contents" className="mt-3">
          <TocLinks
            headings={headings}
            activeId={activeId}
            entryTestId="wiki-toc-mobile-entry"
          />
        </nav>
      </details>

      {/* Wide column: sticky right rail, scrolling inside itself.

          The height cap is what makes the rail a scroll container rather than a
          sticky column that simply runs off the bottom of the screen: without
          it, a TOC taller than the viewport could only be read by scrolling the
          ARTICLE, which moves the prose the reader was orienting in. The 8rem
          is everything above the rail — topbar `h-16` + the content column's
          `p-6` + the card's `py-10` — which is also the rail's unstuck offset,
          so at the top of an article it ends flush with the viewport bottom and
          once it sticks at `top-6` the difference becomes breathing room.

          Only the link list scrolls; "On this page" stays put, so a reader
          halfway down a long TOC still knows what they are looking at. */}
      <nav
        data-testid="wiki-toc"
        aria-label="Table of contents"
        className="sticky top-6 hidden max-h-[calc(100vh-8rem)] w-48 shrink-0 flex-col self-start @min-[65rem]/wiki-content:flex @min-[67rem]/wiki-content:w-56"
      >
        <p className="text-muted-foreground mb-3 shrink-0 text-xs font-semibold tracking-wide uppercase">
          On this page
        </p>
        <div
          ref={listRef}
          // `min-h-0` is the whole trick: a flex item refuses to shrink below
          // its content by default, which would push the list past the cap
          // instead of scrolling it. It stays content-sized until the cap bites.
          className="min-h-0 overflow-y-auto overscroll-contain pr-2"
        >
          <TocLinks
            headings={headings}
            activeId={activeId}
            entryTestId="wiki-toc-entry"
          />
        </div>
      </nav>
    </>
  );
}

/**
 * The two trees carry *different* entry testids on purpose. Both are in the DOM
 * at every viewport — only their visibility differs — so a shared testid makes
 * an unscoped `[data-testid="wiki-toc-entry"]` count every heading twice and
 * match two elements per `data-active`. One testid per tree keeps a selector
 * honest without the caller having to remember to scope it.
 */
function TocLinks({
  headings,
  activeId,
  entryTestId,
}: {
  headings: TocHeading[];
  activeId: string | null;
  entryTestId: string;
}) {
  return (
    <ul className="space-y-1 text-sm">
      {headings.map((heading, index) => {
        const isActive = heading.id === activeId;
        return (
          <li key={`${heading.id}-${index}`}>
            <a
              href={`#${heading.id}`}
              data-testid={entryTestId}
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
 * Keep the highlighted entry inside the rail's own scroll box.
 *
 * Once the rail scrolls independently of the article, reading far enough moves
 * the active entry out of the rail's visible area and the highlight simply
 * disappears. This nudges it back — and only it: the effect reacts to `activeId`
 * changing, so no scroll state is mirrored into React state, and the DOM read is
 * scoped to the desktop list (`ref`) so the mobile `<details>` copy, which is
 * display:none whenever it is closed, is never touched.
 *
 * `block: "nearest"` is load-bearing. It scrolls the minimum needed, so an entry
 * already visible causes no scroll at all, and the article column above — where
 * the sticky rail is always fully in view — never moves. Anything else here
 * would scroll-jack the reader mid-paragraph.
 */
function useFollowActiveEntry(activeId: string | null) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId) return;

    const active = listRef.current?.querySelector<HTMLElement>(
      '[data-active="true"]'
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return listRef;
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

  const getSnapshot = useCallback(() => readActiveHeadingId(ids), [ids]);

  // On the server there is no geometry to read: the reader starts at the top,
  // so the first heading is the honest answer.
  const getServerSnapshot = useCallback(() => ids[0] ?? null, [ids]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Read the rendered headings' geometry and hand it to `activeHeadingId`.
 *
 * The active line is measured rather than hardcoded, because it is a property
 * of the layout: a heading the browser scrolls to lands at the top of its
 * scroll container plus its own `scroll-margin-top`. Measuring means a taller
 * topbar or a different `scroll-m-*` on the headings cannot silently
 * de-synchronise the highlight from where clicks actually land.
 */
function readActiveHeadingId(ids: string[]): string | null {
  const headings: MeasuredHeading[] = [];
  let activeLinePx = TOC_ACTIVE_LINE_FALLBACK_PX;
  let atScrollEnd = false;
  let measuredLayout = false;

  for (const id of ids) {
    const element = document.getElementById(id);
    if (!element) continue;

    // The layout is the same for every heading, so read it off the first one
    // that is actually in the document.
    if (!measuredLayout) {
      measuredLayout = true;
      const container = scrollContainerOf(element);
      activeLinePx = landingPositionOf(element, container);
      atScrollEnd = isScrolledToEnd(container);
    }

    headings.push({ id, top: element.getBoundingClientRect().top });
  }

  return activeHeadingId(headings, { activeLinePx, atScrollEnd });
}

/** Where the browser puts this heading when it scrolls to its fragment. */
function landingPositionOf(
  heading: HTMLElement,
  container: HTMLElement | null
): number {
  const scrollMarginTop =
    Number.parseFloat(window.getComputedStyle(heading).scrollMarginTop) || 0;
  const containerTop = container
    ? container.getBoundingClientRect().top
    : /* The window scrolls: the container's top edge is the viewport's. */ 0;

  return containerTop + scrollMarginTop + LANDING_TOLERANCE_PX;
}

/**
 * The element that actually scrolls this heading — the wiki layout scrolls a
 * column, not the window, so the viewport top is not where content begins.
 */
function scrollContainerOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }

  return null;
}

/** Can the reader scroll no further? Then the last section is the one in view. */
function isScrolledToEnd(container: HTMLElement | null): boolean {
  const { scrollTop, clientHeight, scrollHeight } =
    container ?? document.documentElement;

  // A container with nothing to scroll is not "at the end" of a read-through.
  if (scrollHeight <= clientHeight) return false;

  return scrollTop + clientHeight >= scrollHeight - SCROLL_END_EPSILON_PX;
}
