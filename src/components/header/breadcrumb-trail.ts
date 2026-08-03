// ============================================================================
// Breadcrumb trail resolution — the pure rule behind the dashboard header's
// breadcrumbs (#261).
//
// Extracted from `dashboard-header.tsx` for one reason: the header is a client
// component and the repo's test harness runs `src/**/*.test.ts` only (node:test,
// no DOM), so the load-bearing decision — WHICH label names the current page —
// is only testable as a pure function.
//
// The rule it encodes, and the bug it exists to prevent: a page that declares a
// trail is named by the LAST item in that trail, never by the shell's fallback.
// `/oversight/health` shipped without a declared trail and so rendered
// "Dashboard" — the name of a different page — in the current-page slot.
// ============================================================================

import type { HeaderBreadcrumbItem } from "./header-context";

/**
 * What the header shows when a page declares no trail at all.
 *
 * It is a fallback, not a default: any page that names itself overrides it. A
 * page that shows this label is a page that forgot to declare its breadcrumbs.
 */
export const FALLBACK_BREADCRUMB_LABEL = "Dashboard";

export type ResolvedBreadcrumb = {
  label: string;
  /**
   * Present only on ancestor crumbs. The current page is never a link to
   * itself, so this is dropped from the last crumb even when the caller
   * supplied one.
   */
  href?: string;
  /** True for exactly one crumb: the page the user is on. */
  isCurrent: boolean;
};

/**
 * Turn a page's declared breadcrumb items into the trail the header renders.
 *
 * - The last item is the current page: rendered as text, never as a link.
 * - Earlier items link when they carry an `href`, and are plain text otherwise.
 * - An empty trail falls back to {@link FALLBACK_BREADCRUMB_LABEL}.
 */
export function resolveBreadcrumbTrail(
  items: HeaderBreadcrumbItem[]
): ResolvedBreadcrumb[] {
  if (items.length === 0) {
    return [{ label: FALLBACK_BREADCRUMB_LABEL, isCurrent: true }];
  }

  return items.map((item, index) => {
    const isCurrent = index === items.length - 1;

    // `href` is omitted rather than set to undefined: the current page must not
    // link to itself, and an ancestor with no href is plain text, not a dead
    // link. Both cases are then the same one thing to render.
    return isCurrent || item.href === undefined
      ? { label: item.label, isCurrent }
      : { label: item.label, href: item.href, isCurrent };
  });
}
