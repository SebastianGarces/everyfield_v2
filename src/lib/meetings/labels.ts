// ============================================================================
// How a meeting is NAMED — the one meeting display vocabulary
// ============================================================================
//
// One map per concern, keyed by the enum union itself, so a new meeting type or
// status is a COMPILE error here instead of a raw lowercase token leaking into
// a badge. Mirrors src/lib/communication/status-display.ts, which was written
// for the same failure: three surfaces each carrying a partial copy of one map,
// and a new enum member rendering as itself on all of them.
//
// Keep this module free of runtime `@/db` imports — several of its consumers
// are `"use client"` components, and a value import here would pull schema code
// into the browser bundle. The type-only import below points at the one module
// that owns `MeetingType`/`MeetingStatus` and is erased at compile time.
// `ruled-copy.test.ts` lists this file among the db-free siblings and pins that
// allowance; `client-boundary.test.ts` pins the far half.
//
// WHY EVERYTHING A MEETING IS CALLED LIVES HERE, not one map per component:
// the type label, the type badge tint, the status label, the status badge tint
// and the display TITLE were six maps and four functions spread over
// `meeting-card.tsx`, `meeting-header.tsx`, `meetings/[id]/layout.tsx`,
// `meeting-details-client.tsx`, `meeting-form.tsx`, `rsvp/[token]/page.tsx` and
// `lib/dashboard/service.ts` — and they had already drifted. The card badge read
// "Vision" where the header badge read "Vision Meeting" for the same meeting; an
// untitled orientation was "Orientation Meeting" on the card, "Orientation" in
// the breadcrumb and the bare word "Meeting" in its own Edit dialog. A vocabulary
// kept in agreement by nobody is a vocabulary with seven implementations.
//
// `labels.test.ts` enforces that: it walks every module under `src/` and fails on
// a second table that maps all three meeting types to strings.
// ============================================================================

import type { MeetingStatus, MeetingType } from "@/db/schema/meetings";

// ---------------------------------------------------------------------------
// Meeting type
// ---------------------------------------------------------------------------

/**
 * Sentence-case labels for `meetingTypes` — keyed by the union, so a new
 * meeting type is a compile error here instead of a raw token leaking into
 * the UI. Canonical copy (ruled 2026-08-12, 407-4-1).
 *
 * The DECLARATION ORDER is load-bearing: `MEETING_TYPE_OPTIONS` reads its keys,
 * so this is also the order the create form offers them in. A new type joins
 * that select by being added here and nowhere else.
 *
 * These are the SINGULAR labels — what one meeting is called. The meetings
 * FILTER chips say "Vision Meetings" / "Orientations", a plural vocabulary for
 * a different job, and they live in `meeting-type-filter.ts` with the values
 * and the `?type=` param they belong to. Two tables, two concerns; neither is a
 * copy of the other.
 */
export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  vision_meeting: "Vision Meeting",
  orientation: "Orientation",
  team_meeting: "Team Meeting",
};

/**
 * Label for a type that may NOT be one of the three — the only accessor in this
 * module, because it is the only table read with something other than a
 * column-typed key. `merge.ts` resolves `{{meeting_type}}` for a merge-field
 * preview, and the communication surfaces render a joined row; the rest of the
 * repo indexes the tables above directly with a `MeetingType`.
 *
 * `Object.hasOwn`-gated, never a bare `MEETING_TYPE_LABELS[type]`: a bare index
 * reaches `Object.prototype`, so `"constructor"` returns a native FUNCTION and
 * `"toString"` returns another one, and the `??` fallback never fires for
 * either because a prototype member is a defined value. A caller that renders
 * the result then prints a function's source in place of a label.
 *
 * Same rule and same reason as `attestationLeaf` in
 * `src/lib/phase-engine/attestation-citation.ts` — see memory/invariants.md →
 * Phase Engine, "A CITED PATH IS UNTRUSTED INPUT".
 *
 * An unrecognised type degrades to the RAW token (`"prayer_walk"`), not to a
 * prettified one (`"prayer walk"`): the prettified form is a guess at a label
 * that reads like a real one, and the raw token is legible enough to be
 * reported while being obviously not a label. It replaced a
 * `type.replace(/_/g, " ")` in the dashboard feed.
 */
export function meetingTypeLabel(type: string): string {
  return Object.hasOwn(MEETING_TYPE_LABELS, type)
    ? MEETING_TYPE_LABELS[type as MeetingType]
    : type;
}

/**
 * The meeting types a planter may create, in the order they are offered.
 *
 * DERIVED from `MEETING_TYPE_LABELS` rather than written out again: the create
 * form used to carry its own `{ value, label }[]` with the same three pairs in
 * it, which is a second table under a shape that a `Record<MeetingType, string>`
 * cannot make a compile error. Reading the keys means a new type appears in the
 * select automatically and can never appear there under a different name.
 */
export const MEETING_TYPE_OPTIONS: readonly {
  value: MeetingType;
  label: string;
}[] = (Object.keys(MEETING_TYPE_LABELS) as MeetingType[]).map((value) => ({
  value,
  label: MEETING_TYPE_LABELS[value],
}));

/**
 * Badge tint per meeting type.
 *
 * Read by INDEX at both call sites (`meeting-card.tsx`, `meeting-header.tsx`),
 * because `churchMeetings.type` is a pg enum column typed `$type<MeetingType>()`
 * — there is no `meetingTypeBadgeClass(string)` accessor and there was no
 * caller for one. The same goes for the two status tables below.
 */
export const MEETING_TYPE_BADGE_CLASSES: Record<MeetingType, string> = {
  vision_meeting:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  orientation:
    "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  team_meeting:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

// ---------------------------------------------------------------------------
// Meeting status
// ---------------------------------------------------------------------------

/** Sentence-case labels. Never render `church_meetings.status` raw. */
export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  planning: "Planning",
  ready: "Ready",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Badge tint per status. */
export const MEETING_STATUS_BADGE_CLASSES: Record<MeetingStatus, string> = {
  planning:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  ready: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  in_progress:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  completed: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

// ---------------------------------------------------------------------------
// The display title
// ---------------------------------------------------------------------------

/**
 * What `meetingDisplayTitle` reads off a meeting.
 *
 * A STRUCTURAL type, not `ChurchMeeting`: `MeetingWithCounts` lives in
 * `types.ts`, which value-imports `@/db/schema`, and this module may not follow
 * that edge.
 *
 * EVERY BRANCHED FIELD IS REQUIRED, and nullable rather than optional. Sharing
 * the function is not the same as sharing the NAME: while `title`,
 * `meetingNumber` and `teamName` were optional, a caller that simply did not
 * SELECT a column type-checked and quietly took a different branch. Two of the
 * six enumerated surfaces did exactly that — neither the dashboard activity
 * feed nor the RSVP page projected `teamName` — so one untitled team meeting
 * read "Worship Meeting" on the card and "Team Meeting" in the feed and to the
 * invitee, while the docblock below, `memory/invariants.md` and two guards in
 * `labels.test.ts` all asserted the six agreed. A missing column is invisible
 * to a guard that greps for an identifier; required-nullable makes it a
 * COMPILE ERROR at the projection. Never widen these back to optional, and
 * never silence the compiler with `?? null` where the column is joinable.
 */
export type MeetingTitleFacts = {
  type: MeetingType;
  title: string | null;
  meetingNumber: number | null;
  teamName: string | null;
};

/**
 * The name a meeting is shown under on the SEVEN surfaces that call it: the
 * card, the detail header, the breadcrumb, the Edit and Delete dialogs, the
 * public RSVP page, the dashboard activity feed and the evaluation heading.
 * `labels.test.ts` walks that exact list — the enumeration is the test, not
 * this sentence.
 *
 * Every caller passes a COMPLETE `MeetingTitleFacts`. Calling this function is
 * not by itself enough to agree on the name: while the fields were optional,
 * two of the surfaces below simply did not project `teamName` and quietly took
 * a different branch. See the type above.
 *
 * Three branches, in this order:
 *
 * 1. A NUMBERED vision meeting is "Vision Meeting #7". The number is the thing
 *    the planter counts by, so it outranks a title even when one is set — and
 *    the create form does not offer a title field for vision meetings at all.
 *    The test is TRUTHINESS, so `meetingNumber` 0 falls through to branch 3
 *    rather than producing "Vision Meeting #0": the sequence `nextMeetingNumber`
 *    hands out starts at 1, so a 0 is a bad row, and naming a meeting after it
 *    prints the bad row to the planter as if it were a fact.
 * 2. A team meeting with a team falls back to "<Team> Meeting", because "Team
 *    Meeting" alone is the least useful true sentence about it.
 * 3. Everything else is the planter's own title, then the type label — `||`,
 *    not `??`, so a saved-but-empty title is not a title. `??` is what the RSVP
 *    page carried, and it rendered an empty <h1> to the invitee.
 *
 * The four copies this replaces disagreed at branch 2 and branch 3, so one
 * untitled orientation could read "Orientation Meeting", "Orientation" and
 * "Meeting" on three surfaces a planter reaches in two clicks. The behaviour
 * kept is the meeting header's — the most complete of the four, and the one
 * rendered next to the meeting itself.
 *
 * The CALLER never synthesises a meeting to name one. The evaluation heading
 * used to build `{ type: "vision_meeting", meetingNumber }` in a client
 * component while its own server page held the real row, and the route has no
 * type gate — so an orientation reached by URL was headed "Evaluate Vision
 * Meeting". The page derives, the component prints.
 *
 * NOT yet every surface in the repo: `/communication/compose`,
 * `/communication/[id]` and the ministry-team meetings tab still derive a title
 * inline. They sit outside the meetings domain this pass owns and are recorded
 * as DECISION 411-D1 rather than claimed here — see memory/invariants.md.
 */
export function meetingDisplayTitle(meeting: MeetingTitleFacts): string {
  if (meeting.type === "vision_meeting" && meeting.meetingNumber) {
    return `${MEETING_TYPE_LABELS.vision_meeting} #${meeting.meetingNumber}`;
  }

  if (meeting.type === "team_meeting" && meeting.teamName) {
    return meeting.title || `${meeting.teamName} Meeting`;
  }

  return meeting.title || meetingTypeLabel(meeting.type);
}
