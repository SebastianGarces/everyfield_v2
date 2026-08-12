/**
 * The meeting-type filter — one table, both surfaces (VM-010k).
 *
 * This module imports nothing but a TYPE, the same rule `copy.ts` and
 * `agenda.ts` keep and for the same reason. `service.ts` opens with `@/db`, ten
 * schema tables and drizzle, so every symbol in it is one `"use client"` away
 * from dragging that graph into the client bundle — and the filter table is
 * needed on BOTH sides of the boundary: `/meetings` filters in the browser
 * (`MeetingList`, `"use client"`) and `/meetings/[id]/analytics` filters on the
 * server. `import type` is erased at compile time and adds no bundle edge, so
 * it is the one import this module may have; `client-boundary.test.ts` walks
 * value edges only and `ruled-copy.test.ts` pins that this file has none.
 *
 * It exists because the table WAS declared twice — `typeFilters` in
 * `meeting-list.tsx` and `ANALYTICS_MEETING_TYPE_FILTERS` in `service.ts`, the
 * same four values and the same four labels feeding the same `?type=` param —
 * and the two copies had already drifted apart in order while the newer one's
 * comment claimed they agreed. A table kept in agreement by a comment is a
 * table with two implementations.
 *
 * `service.ts` deliberately does NOT re-export any of this: a pass-through
 * keeps the coupling this module exists to remove. Import from here.
 */

import type { MeetingType } from "@/db/schema";

/**
 * What a meetings view can be filtered to: one meeting type, or `"all"`.
 *
 * `"all"` is a filter VALUE and not the absence of one, so the active control
 * is always exactly one of these and the URL always says which.
 */
export type MeetingTypeFilter = MeetingType | "all";

/**
 * The offered filters, in the ONE order both surfaces offer them.
 *
 * Broadest first: `"all"` leads, then the three types in the order the product
 * introduces them. Both `/meetings` and `/meetings/[id]/analytics` render this
 * array directly, so the order here IS the order on screen — this comment
 * cannot go stale against a second copy, because there is no second copy.
 */
export const MEETING_TYPE_FILTERS: readonly {
  value: MeetingTypeFilter;
  label: string;
}[] = [
  { value: "all", label: "All Types" },
  { value: "vision_meeting", label: "Vision Meetings" },
  { value: "orientation", label: "Orientations" },
  { value: "team_meeting", label: "Team Meetings" },
];

/**
 * The filter the ANALYTICS view starts on when the URL says nothing.
 *
 * Vision meetings, because that is what the view showed before it was
 * filterable — every existing bookmark and every existing planter lands on the
 * same figures they landed on yesterday.
 *
 * The meetings LIST defaults to `"all"` instead, and that difference is on
 * purpose: the list is a browse surface that has always shown everything, the
 * analytics view is a figures surface whose numbers would change meaning under
 * a widened default. Sharing the table does not mean sharing the default.
 */
export const DEFAULT_ANALYTICS_MEETING_TYPE: MeetingTypeFilter =
  "vision_meeting";

/** The filter the meetings LIST starts on when the URL says nothing. */
export const DEFAULT_LIST_MEETING_TYPE: MeetingTypeFilter = "all";

/**
 * Read the analytics filter out of a `?type=` search param.
 *
 * Total over any input: a missing, repeated or unrecognised value falls back to
 * the default rather than reaching the query builders, so a hand-edited URL
 * narrows the figures to nothing instead of widening them.
 */
export function parseAnalyticsMeetingTypeFilter(
  value: string | string[] | undefined
): MeetingTypeFilter {
  if (typeof value !== "string") return DEFAULT_ANALYTICS_MEETING_TYPE;

  const match = MEETING_TYPE_FILTERS.find((option) => option.value === value);

  return match?.value ?? DEFAULT_ANALYTICS_MEETING_TYPE;
}

/**
 * The argument the analytics queries take for a filter.
 *
 * `undefined` is how `getAttendanceTrend`/`getMeetingSummaryStats` spell "no
 * type restriction", so `"all"` maps to it. Kept as one named translation so a
 * call site cannot express "all" as an empty string or a null by accident.
 */
export function analyticsMeetingTypeArg(
  filter: MeetingTypeFilter
): MeetingType | undefined {
  return filter === "all" ? undefined : filter;
}

/** The label for a filter — for captions that must say what is being counted. */
export function analyticsMeetingTypeLabel(filter: MeetingTypeFilter): string {
  return (
    MEETING_TYPE_FILTERS.find((option) => option.value === filter)?.label ??
    "All Types"
  );
}
