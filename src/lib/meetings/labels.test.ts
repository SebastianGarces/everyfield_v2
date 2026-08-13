import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { meetingStatuses, meetingTypes } from "@/db/schema/meetings";
import { TS_FILES, codeOf, rel } from "@/lib/auth/server-action-surface";
import {
  MEETING_STATUS_BADGE_CLASSES,
  MEETING_STATUS_LABELS,
  MEETING_TYPE_BADGE_CLASSES,
  MEETING_TYPE_LABELS,
  MEETING_TYPE_OPTIONS,
  meetingDisplayTitle,
  meetingTypeLabel,
} from "@/lib/meetings/labels";

// ----------------------------------------------------------------------------
// THE ONE MEETING DISPLAY VOCABULARY (#411, discharging #407 D4)
//
// Before this module there were SEVEN hand-written tables of what a meeting is
// called, spread over `meeting-card.tsx`, `meeting-header.tsx`,
// `meetings/[id]/layout.tsx`, `meeting-details-client.tsx`,
// `meeting-form.tsx`, `rsvp/[token]/page.tsx` and `lib/dashboard/service.ts`,
// plus four copies of the title derivation. They had drifted, in ways a planter
// could see in two clicks:
//
//   - the card badge said "Vision" where the detail header said "Vision
//     Meeting", for the same meeting one click apart;
//   - an untitled orientation was "Orientation Meeting" on the card,
//     "Orientation" in the breadcrumb, and the bare word "Meeting" in the Edit
//     and Delete dialogs on its own page;
//   - the breadcrumb ignored the team-name branch the header right below it
//     applied, so an untitled team meeting read "Team Meeting" above
//     "Worship Team Meeting".
//
// The last section of this file is the part that keeps it at one: a walk over
// every module under `src/` that fails on a SECOND table mapping the meeting
// types to strings. An equality test can only pin the copy that exists; the
// walk pins that no new copy can appear.
// ----------------------------------------------------------------------------

// ============================================================================
// The tables are total over their unions
// ============================================================================

test("every meeting type has a label, a badge tint and an offered option", () => {
  // `Record<MeetingType, string>` already makes a missing key a compile error.
  // This is the runtime half: the enum ARRAY and the tables agree, so a type
  // added to the schema and forgotten here fails the suite rather than
  // rendering as `team_meeting` in a badge.
  for (const type of meetingTypes) {
    assert.ok(MEETING_TYPE_LABELS[type], `${type} has a label`);
    assert.ok(MEETING_TYPE_BADGE_CLASSES[type], `${type} has a badge tint`);
    assert.ok(
      MEETING_TYPE_OPTIONS.some((option) => option.value === type),
      `${type} is offered by the create form`
    );
  }

  assert.equal(Object.keys(MEETING_TYPE_LABELS).length, meetingTypes.length);
  assert.equal(MEETING_TYPE_OPTIONS.length, meetingTypes.length);
});

test("every meeting status has a label and a badge tint", () => {
  for (const status of meetingStatuses) {
    assert.ok(MEETING_STATUS_LABELS[status], `${status} has a label`);
    assert.ok(MEETING_STATUS_BADGE_CLASSES[status], `${status} has a tint`);
  }

  assert.equal(
    Object.keys(MEETING_STATUS_LABELS).length,
    meetingStatuses.length
  );
});

test("the labels are the ruled sentence-case copy", () => {
  // Written out here so the ruling (407-4-1, 2026-08-12) and the shipped table
  // are two independent things that must agree — the technique
  // `ruled-copy.test.ts` uses for its four sentences.
  assert.deepEqual(MEETING_TYPE_LABELS, {
    vision_meeting: "Vision Meeting",
    orientation: "Orientation",
    team_meeting: "Team Meeting",
  });
});

test("the create form's options are the label table, not a second copy", () => {
  // The options are DERIVED from the labels, so this asserts the derivation
  // rather than a hand-kept parallel list: same order, same labels. The card
  // used to carry a short vocabulary ("Vision", "Team") under the same shape,
  // which no `Record<MeetingType, string>` could catch.
  assert.deepEqual(
    MEETING_TYPE_OPTIONS.map((option) => option.value),
    Object.keys(MEETING_TYPE_LABELS),
    "declaration order in MEETING_TYPE_LABELS is the order the form offers"
  );

  for (const option of MEETING_TYPE_OPTIONS) {
    assert.equal(option.label, MEETING_TYPE_LABELS[option.value]);
  }
});

// ============================================================================
// The fallbacks — a value that arrived from an older row
// ============================================================================

test("an unknown type degrades to the RAW token, never to a crash", () => {
  assert.equal(meetingTypeLabel("vision_meeting"), "Vision Meeting");
  assert.equal(
    meetingTypeLabel("prayer_walk"),
    "prayer_walk",
    "the raw token, not a prettified `prayer walk` — a guess that reads like a real label is worse than one that does not"
  );
});

test("a prototype key is not a label", () => {
  // `meetingTypeLabel` is a `Record` read on a caller-supplied string.
  // `constructor` and `toString` reach `Object.prototype` and hand a native
  // FUNCTION to a caller expecting a string — the same species of bug the phase
  // engine's cited-fact vocabularies were converted to `Map`s for. A `??`
  // fallback does not catch it, because a prototype member is a defined value;
  // the `Object.hasOwn` gate does.
  for (const forged of ["constructor", "toString", "__proto__", "valueOf"]) {
    assert.equal(typeof meetingTypeLabel(forged), "string", forged);
    assert.equal(meetingTypeLabel(forged), forged, forged);
  }
});

test("the module exports exactly one string-keyed accessor", () => {
  // The three siblings this one kept — `meetingTypeBadgeClass`,
  // `meetingStatusLabel`, `meetingStatusBadgeClass` — had ZERO production
  // callers and were deleted. Both status tables and the type-tint table are
  // read by INDEX with a column-typed key, so a `(status: string)` overload
  // invited a caller to widen a key the pg enum already narrows. If a real
  // caller for one appears, add it back with the same `Object.hasOwn` gate and
  // update this count.
  const file = TS_FILES.find(
    (candidate) =>
      rel(candidate) === path.join("src", "lib", "meetings", "labels.ts")
  );
  assert.ok(file, "the walk did not find labels.ts");

  const accessors = codeOf(file).match(/^export function meeting\w+\(/gm) ?? [];
  assert.deepEqual(accessors.sort(), [
    "export function meetingDisplayTitle(",
    "export function meetingTypeLabel(",
  ]);
});

// ============================================================================
// The display title — one derivation, four surfaces
// ============================================================================

test("a numbered vision meeting is named by its number", () => {
  assert.equal(
    meetingDisplayTitle({ type: "vision_meeting", meetingNumber: 7 }),
    "Vision Meeting #7"
  );
});

test("the number outranks a stored title", () => {
  // Deliberate: the create form offers no title field for a vision meeting, so
  // a title on one is residue from an older row or another path, and the number
  // is what the planter counts by.
  assert.equal(
    meetingDisplayTitle({
      type: "vision_meeting",
      meetingNumber: 3,
      title: "Kickoff",
    }),
    "Vision Meeting #3"
  );
});

test("an unnumbered vision meeting falls back to title, then to the label", () => {
  assert.equal(
    meetingDisplayTitle({ type: "vision_meeting", title: "Kickoff" }),
    "Kickoff"
  );
  assert.equal(
    meetingDisplayTitle({ type: "vision_meeting", meetingNumber: null }),
    "Vision Meeting"
  );
});

test("a team meeting with a team is named by the team", () => {
  assert.equal(
    meetingDisplayTitle({ type: "team_meeting", teamName: "Worship" }),
    "Worship Meeting"
  );
  assert.equal(
    meetingDisplayTitle({
      type: "team_meeting",
      teamName: "Worship",
      title: "Set list planning",
    }),
    "Set list planning"
  );
});

test("a team meeting with no team reads the type label, not an empty gap", () => {
  assert.equal(meetingDisplayTitle({ type: "team_meeting" }), "Team Meeting");
});

test("an untitled orientation is the type label on every surface", () => {
  // The single most visible drift this function deleted: this meeting used to
  // read "Orientation Meeting" (card), "Orientation" (breadcrumb and header)
  // and "Meeting" (its own Edit/Delete dialogs).
  assert.equal(meetingDisplayTitle({ type: "orientation" }), "Orientation");
  assert.equal(
    meetingDisplayTitle({ type: "orientation", title: "" }),
    "Orientation",
    "an empty title is not a title — `||`, not `??`"
  );
  assert.equal(
    meetingDisplayTitle({ type: "orientation", title: null }),
    "Orientation"
  );
});

test("the vision-meeting prefix comes from the label table", () => {
  // Not a hardcoded "Vision Meeting #" — otherwise a re-ruled label would leave
  // the numbered form spelling the old one.
  assert.ok(
    meetingDisplayTitle({
      type: "vision_meeting",
      meetingNumber: 1,
    }).startsWith(MEETING_TYPE_LABELS.vision_meeting)
  );
});

// ============================================================================
// The guard: the surfaces that NAME a meeting call the derivation
// ============================================================================

/**
 * The six surfaces that render a meeting's name, enumerated by path.
 *
 * This list exists because a DOCBLOCK claiming "the RSVP page reads this" was
 * shipped while the RSVP page still read `meeting.title ?? meetingTypeLabel(…)`
 * — an attested claim that stayed green while the thing it described was false.
 * A comment cannot be false for long if a test spells out the same claim.
 *
 * It is deliberately NOT every surface in the repo: `/communication/compose`,
 * `/communication/[id]` and `ministry-teams/meetings-tab.tsx` still derive a
 * title inline. They belong to other domains and are DECISION 411-D1, so they
 * are absent from this list rather than silently covered by it.
 */
const TITLE_SURFACES = [
  path.join("src", "components", "meetings", "meeting-card.tsx"),
  path.join("src", "components", "meetings", "meeting-header.tsx"),
  path.join("src", "app", "(dashboard)", "meetings", "[id]", "layout.tsx"),
  path.join(
    "src",
    "app",
    "(dashboard)",
    "meetings",
    "[id]",
    "meeting-details-client.tsx"
  ),
  path.join("src", "app", "rsvp", "[token]", "page.tsx"),
  path.join("src", "lib", "dashboard", "service.ts"),
];

test("every enumerated title surface calls meetingDisplayTitle", () => {
  const missing = TITLE_SURFACES.filter((relative) => {
    const file = TS_FILES.find((candidate) => rel(candidate) === relative);
    return !file || !codeOf(file).includes("meetingDisplayTitle");
  });

  assert.deepEqual(
    missing,
    [],
    `these surfaces name a meeting without the one derivation:\n  ${missing.join("\n  ")}`
  );
});

test("no enumerated title surface derives a title of its own", () => {
  // The exact shape that made the RSVP page's <h1> empty for a meeting saved
  // with an empty title: `??` treats "" as a title, `||` does not. Any local
  // `title ?? …` / `title || …` on these surfaces is a second derivation, and a
  // second derivation is how the four this pass deleted disagreed.
  const offenders = TITLE_SURFACES.flatMap((relative) => {
    const file = TS_FILES.find((candidate) => rel(candidate) === relative);
    if (!file) return [];
    return /\btitle\s*(\?\?|\|\|)/.test(codeOf(file)) ? [relative] : [];
  });

  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

// ============================================================================
// The guard: no second meeting-type label table anywhere under src/
// ============================================================================

const LABELS = path.join("src", "lib", "meetings", "labels.ts");

/**
 * The modules allowed to map a meeting type to a display string.
 *
 * `labels.ts` is the vocabulary itself. `meeting-type-filter.ts` is the ruled
 * FILTER table — plural captions ("Vision Meetings") bound to the `?type=`
 * param, a different concern with its own invariant, and it is keyed by
 * `value:`/`label:` rather than by the type names.
 */
const ALLOWED = new Set([
  LABELS,
  path.join("src", "lib", "meetings", "meeting-type-filter.ts"),
]);

/**
 * Does this source map ALL THREE meeting types to string literals?
 *
 * All three, deliberately. Several legitimate tables in other domains hold a
 * `vision_meeting` key — `tasks.category` and `persons.source` are separate
 * enums that each happen to have a member of that name — and folding them into
 * the meeting vocabulary would couple three enums that are free to diverge.
 * Only a table that names `orientation` AND `team_meeting` too is a copy of
 * THIS one.
 */
function declaresMeetingTypeLabelMap(code: string): boolean {
  return meetingTypes.every((type) =>
    new RegExp(`(["']?)${type}\\1\\s*:\\s*["'\`]`).test(code)
  );
}

/** Does this source declare `{ value: "<meeting type>", label: "…" }` rows? */
function declaresMeetingTypeOptionList(code: string): boolean {
  return /\bvalue\s*:\s*["'](?:vision_meeting|orientation|team_meeting)["']\s*,\s*label\s*:\s*["'`]/.test(
    code
  );
}

test("no module outside labels.ts declares a meeting-type label table", () => {
  // The property, not the instance. Seven copies existed; deleting them proves
  // nothing about the eighth, and the eighth is what the next meetings feature
  // writes when a component needs a badge and nothing stops it.
  //
  // Comments are stripped by `codeOf`, so this file's own prose — which quotes
  // the shapes it forbids — cannot trip it.
  assert.ok(
    TS_FILES.length > 100,
    `the walk found only ${TS_FILES.length} modules — it is looking in the wrong place`
  );

  const offenders = TS_FILES.filter((file) => {
    const relative = rel(file);
    if (ALLOWED.has(relative) || /\.test\.tsx?$/.test(relative)) return false;

    const code = codeOf(file);
    return (
      declaresMeetingTypeLabelMap(code) || declaresMeetingTypeOptionList(code)
    );
  }).map(rel);

  assert.deepEqual(
    offenders,
    [],
    `these modules carry their own meeting-type labels — import MEETING_TYPE_LABELS (or MEETING_TYPE_OPTIONS, or meetingDisplayTitle) from @/lib/meetings/labels instead:\n  ${offenders.join(
      "\n  "
    )}`
  );
});

test("the guard can see a copy — shown failing on the shape it forbids", () => {
  // A walk that cannot be shown failing is a walk nobody has checked. Three
  // source-text assertions over another route passed while the property they
  // described was false (memory/invariants.md, the /register readers).
  assert.ok(
    declaresMeetingTypeLabelMap(
      `const typeLabels = { vision_meeting: "Vision", orientation: "Orientation", team_meeting: "Team" };`
    ),
    "the short-vocabulary copy the meeting card carried is caught"
  );
  assert.ok(
    declaresMeetingTypeLabelMap(
      `{ "vision_meeting": 'Vision Meeting', "orientation": 'Orientation', "team_meeting": 'Team Meeting' }`
    ),
    "quoted keys and single-quoted values are caught"
  );
  assert.ok(
    declaresMeetingTypeOptionList(
      `[{ value: "vision_meeting", label: "Vision Meeting" }]`
    ),
    "the create form's option-array shape is caught"
  );

  // And the false positives it must NOT raise.
  assert.ok(
    !declaresMeetingTypeLabelMap(
      `const CATEGORY_LABELS = { vision_meeting: "Vision Meeting", follow_up: "Follow-up", ministry_team: "Ministry Team" };`
    ),
    "a tasks-category table holding one same-named member is not a copy of this vocabulary"
  );
  assert.ok(
    !declaresMeetingTypeLabelMap(
      `const SOURCE_LABELS = { vision_meeting: "Vision Meeting", website: "Website" };`
    ),
    "a person-source table is not a copy of this vocabulary either"
  );
});

test("labels.ts itself is what the guard is exempting", () => {
  // The allow-list is a set of PATHS, so a typo in one would silently exempt
  // nothing and pass. This asserts the exemption is load-bearing: the module
  // the guard allows really does declare the table.
  assert.ok(
    TS_FILES.some((file) => rel(file) === LABELS),
    `${LABELS} does not exist — this guard is watching a file that moved`
  );
  assert.ok(
    declaresMeetingTypeLabelMap(
      codeOf(TS_FILES.find((file) => rel(file) === LABELS)!)
    ),
    "labels.ts declares the table the rest of src/ may not"
  );
});
