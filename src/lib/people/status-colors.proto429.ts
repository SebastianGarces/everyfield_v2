/**
 * PROTOTYPE ONLY — never merge. Scaffolding for the #429 design ruling on the
 * /people status-badge colour scale. Delete this file, its test, its dot
 * component and the switcher wiring in `(dashboard)/people/layout.tsx` once
 * Sebastian has ruled; then fold the winner into `STATUS_BADGE_CONFIG` and
 * retire `DEFERRED_STATUS_BADGE_FILLS`.
 *
 * ## Why the classes are shaped like this
 *
 * `STATUS_BADGE_CONFIG` is PINNED: `DEFERRED_STATUS_BADGE_FILLS` in
 * `src/app/theme-tokens.test.ts` holds its eight failing pairs to their exact
 * ratios with an INVERTED assertion, so editing a fill there fails CI on this
 * branch. So no option touches it. Every candidate is layered on top as
 * ADDITIONAL classes selected by the `data-proto-429` attribute the switcher
 * stamps on `<html>`, which leaves the baseline ("current") genuinely
 * untouched — the honest thing to compare the other four against.
 *
 * Two ancestor variants, both keyed off `<html>`, which carries the prototype
 * attribute AND the `dark` class:
 *
 *   [[data-proto-429=a]_&]:bg-blue-600        → light (and the dark default)
 *   [[data-proto-429=a].dark_&]:bg-blue-400   → dark, higher specificity, wins
 *
 * They must be written out in full: Tailwind scans source text for candidates,
 * so a class assembled from a template literal emits no CSS.
 *
 * Every ratio these classes produce is re-derived in
 * `status-colors.proto429.test.ts`, which parses this file's own strings. No
 * number here is typed by hand.
 */

import type { PersonStatus } from "@/lib/people/types";

/** The switcher's option ids, in the order the pill shows them. */
export const PROTO_429_OPTIONS = ["current", "a", "b", "c", "d"] as const;

export type Proto429Option = (typeof PROTO_429_OPTIONS)[number];

export const PROTO_429_ATTRIBUTE = "data-proto-429";
export const PROTO_429_STORAGE_KEY = "proto-429";

/**
 * Extra badge classes per status.
 *
 * - `current` contributes nothing, by design.
 * - A · darkened solids: same hue family, white label, one fill per status in
 *   both themes.
 * - B · tinted editorial: pale same-hue ground + deep same-hue ink + a hairline
 *   of the same hue; the dark theme mirrors it with a deep ground and pale ink.
 * - C · ink + colour dot: one neutral badge for every status, the hue demoted
 *   to a square dot (see `Proto429StatusDot`).
 * - D · funnel scale: ONE hue (green — the brand signal) as an ordered
 *   intensity ramp along `STATUS_ORDER`, with `following_up` pulled out of the
 *   ramp as the attention outlier in the ruled danger colour.
 */
export const PROTO_429_BADGE_CLASSES: Record<PersonStatus, string> = {
  // Already neutral (`variant="secondary"`), so A and B leave it alone; only
  // C states it explicitly and D gives it the ramp's first step.
  prospect: [
    "[[data-proto-429=c]_&]:bg-secondary [[data-proto-429=c]_&]:text-secondary-foreground",
    "[[data-proto-429=d]_&]:bg-green-50 [[data-proto-429=d]_&]:text-green-900",
    "[[data-proto-429=d].dark_&]:bg-green-950 [[data-proto-429=d].dark_&]:text-green-200",
  ].join(" "),

  attendee: [
    "[[data-proto-429=a]_&]:bg-blue-600 [[data-proto-429=a]_&]:text-white",
    "[[data-proto-429=b]_&]:bg-blue-50 [[data-proto-429=b]_&]:text-blue-800 [[data-proto-429=b]_&]:border-blue-200",
    "[[data-proto-429=b].dark_&]:bg-blue-950 [[data-proto-429=b].dark_&]:text-blue-200 [[data-proto-429=b].dark_&]:border-blue-800",
    "[[data-proto-429=c]_&]:bg-secondary [[data-proto-429=c]_&]:text-secondary-foreground",
    "[[data-proto-429=d]_&]:bg-green-100 [[data-proto-429=d]_&]:text-green-900",
    "[[data-proto-429=d].dark_&]:bg-green-900 [[data-proto-429=d].dark_&]:text-green-200",
  ].join(" "),

  following_up: [
    "[[data-proto-429=a]_&]:bg-yellow-700 [[data-proto-429=a]_&]:text-white",
    "[[data-proto-429=b]_&]:bg-yellow-50 [[data-proto-429=b]_&]:text-yellow-800 [[data-proto-429=b]_&]:border-yellow-200",
    "[[data-proto-429=b].dark_&]:bg-yellow-950 [[data-proto-429=b].dark_&]:text-yellow-200 [[data-proto-429=b].dark_&]:border-yellow-800",
    "[[data-proto-429=c]_&]:bg-secondary [[data-proto-429=c]_&]:text-secondary-foreground",
    // Out of the ramp on purpose — the one status that asks for attention.
    "[[data-proto-429=d]_&]:bg-destructive [[data-proto-429=d]_&]:text-white",
    // The dark theme LIFTS --destructive, so white stops reading on it (2.84:1)
    // and the label flips to near-black instead.
    "[[data-proto-429=d].dark_&]:text-neutral-950",
  ].join(" "),

  interviewed: [
    "[[data-proto-429=a]_&]:bg-purple-600 [[data-proto-429=a]_&]:text-white",
    "[[data-proto-429=b]_&]:bg-purple-50 [[data-proto-429=b]_&]:text-purple-800 [[data-proto-429=b]_&]:border-purple-200",
    "[[data-proto-429=b].dark_&]:bg-purple-950 [[data-proto-429=b].dark_&]:text-purple-200 [[data-proto-429=b].dark_&]:border-purple-800",
    "[[data-proto-429=c]_&]:bg-secondary [[data-proto-429=c]_&]:text-secondary-foreground",
    "[[data-proto-429=d]_&]:bg-green-200 [[data-proto-429=d]_&]:text-green-900",
    "[[data-proto-429=d].dark_&]:bg-green-800 [[data-proto-429=d].dark_&]:text-green-200",
  ].join(" "),

  core_group: [
    "[[data-proto-429=a]_&]:bg-emerald-700 [[data-proto-429=a]_&]:text-white",
    "[[data-proto-429=b]_&]:bg-emerald-50 [[data-proto-429=b]_&]:text-emerald-800 [[data-proto-429=b]_&]:border-emerald-200",
    "[[data-proto-429=b].dark_&]:bg-emerald-950 [[data-proto-429=b].dark_&]:text-emerald-200 [[data-proto-429=b].dark_&]:border-emerald-800",
    "[[data-proto-429=c]_&]:bg-secondary [[data-proto-429=c]_&]:text-secondary-foreground",
    // The ramp crosses over here: pale grounds with deep ink become deep
    // grounds with a white label, so intensity keeps rising monotonically.
    "[[data-proto-429=d]_&]:bg-green-700 [[data-proto-429=d]_&]:text-white",
    "[[data-proto-429=d].dark_&]:bg-green-500 [[data-proto-429=d].dark_&]:text-green-950",
  ].join(" "),

  launch_team: [
    // Blue twice in the shipped palette (attendee blue-500, launch_team
    // blue-600) was already two steps apart at best; A opens the gap rather
    // than closing it, since both fills have to darken.
    "[[data-proto-429=a]_&]:bg-blue-800 [[data-proto-429=a]_&]:text-white",
    "[[data-proto-429=b]_&]:bg-blue-100 [[data-proto-429=b]_&]:text-blue-900 [[data-proto-429=b]_&]:border-blue-300",
    "[[data-proto-429=b].dark_&]:bg-blue-900 [[data-proto-429=b].dark_&]:text-blue-200 [[data-proto-429=b].dark_&]:border-blue-700",
    "[[data-proto-429=c]_&]:bg-secondary [[data-proto-429=c]_&]:text-secondary-foreground",
    "[[data-proto-429=d]_&]:bg-green-800 [[data-proto-429=d]_&]:text-white",
    "[[data-proto-429=d].dark_&]:bg-green-400 [[data-proto-429=d].dark_&]:text-green-950",
  ].join(" "),

  leader: [
    "[[data-proto-429=a]_&]:bg-amber-800 [[data-proto-429=a]_&]:text-white",
    "[[data-proto-429=b]_&]:bg-amber-50 [[data-proto-429=b]_&]:text-amber-800 [[data-proto-429=b]_&]:border-amber-200",
    "[[data-proto-429=b].dark_&]:bg-amber-950 [[data-proto-429=b].dark_&]:text-amber-200 [[data-proto-429=b].dark_&]:border-amber-800",
    "[[data-proto-429=c]_&]:bg-secondary [[data-proto-429=c]_&]:text-secondary-foreground",
    "[[data-proto-429=d]_&]:bg-green-900 [[data-proto-429=d]_&]:text-white",
    "[[data-proto-429=d].dark_&]:bg-green-300 [[data-proto-429=d].dark_&]:text-green-950",
  ].join(" "),
};

/**
 * Option C's square dot: hidden in every other option, so the four other
 * candidates render exactly as they would without it.
 *
 * Radius 0 — DESIGN.md's rectangle discipline reaches the app UI even though
 * its palette and type do not.
 */
export const PROTO_429_DOT_CLASSES: Record<PersonStatus, string> = {
  prospect:
    "[[data-proto-429=c]_&]:bg-neutral-500 [[data-proto-429=c].dark_&]:bg-neutral-400",
  attendee:
    "[[data-proto-429=c]_&]:bg-blue-600 [[data-proto-429=c].dark_&]:bg-blue-400",
  following_up:
    "[[data-proto-429=c]_&]:bg-yellow-700 [[data-proto-429=c].dark_&]:bg-yellow-400",
  interviewed:
    "[[data-proto-429=c]_&]:bg-purple-600 [[data-proto-429=c].dark_&]:bg-purple-400",
  core_group:
    "[[data-proto-429=c]_&]:bg-emerald-700 [[data-proto-429=c].dark_&]:bg-emerald-400",
  launch_team:
    "[[data-proto-429=c]_&]:bg-blue-900 [[data-proto-429=c].dark_&]:bg-blue-200",
  leader:
    "[[data-proto-429=c]_&]:bg-amber-800 [[data-proto-429=c].dark_&]:bg-amber-400",
};
