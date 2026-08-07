// ============================================================================
// LAUNCH PREP FIXTURE — the real Launch Sunday preparation checklist, frozen so
// the landing page can render the app's real MaterialsChecklistView.
//
// Source: Redemption Hill Church's "Launch Sunday" meeting (seed-dated
// 2026-08-28; the landing renders it as Sunday 2026-08-30 — see
// launch-sunday-fixture.ts note 2), read
// 2026-08-05 through the app's own read layer — `getChecklist(churchId,
// meetingId)` and `getChecklistSummary(churchId, meetingId)`
// (src/lib/meetings/service.ts:1135 and :1191). Those are the two calls the
// meeting's Materials tab makes, and the rows below are in the order that
// query returns them (category, then item name). To regenerate, re-run both
// for that meeting and paste the results back over the constants below.
//
// Every rendered string is verbatim: item names, categories, and every
// checked/unchecked state. The summary is the meeting's real one — 4 of 8 —
// and it stays 4 of 8 in every composition, including the ones that show fewer
// than eight rows: it is a count of the checklist, not of what is on screen.
//
// IDS ARE NOT INERT HERE. MaterialsChecklistView binds each row's <label> to
// its control with `htmlFor={item.id}`, so these ids reach the DOM. They are
// readable slugs rather than the real row uuids for that reason, and the
// compact subset carries its own `-m` ids because both compositions are in the
// page at once (one of them display:none) and two elements may not share an id.
// ============================================================================

import type { MaterialsChecklistItemView } from "@/components/meetings/materials-checklist-view";

/** The whole checklist, as the Materials tab renders it. Kept complete even
 *  though no composition shows all eight — it is the source the two subsets
 *  below are cut from, and the thing to re-read when this fixture is
 *  regenerated. */
export const LAUNCH_PREP_ITEMS = [
  {
    id: "prep-sound-system",
    itemName: "Sound system tested in the gym",
    category: "av",
    isChecked: true,
  },
  {
    id: "prep-greeters",
    itemName: "Greeter assignments confirmed",
    category: "essential",
    isChecked: false,
  },
  {
    id: "prep-bulletins",
    itemName: "Print bulletins",
    category: "materials",
    isChecked: false,
  },
  {
    id: "prep-promo-cards",
    itemName: "Promo cards mailed",
    category: "materials",
    isChecked: true,
  },
  {
    id: "prep-signage",
    itemName: "Signage ordered",
    category: "materials",
    isChecked: true,
  },
  {
    id: "prep-dry-run",
    itemName: "Dry run #1 complete",
    category: "organization",
    isChecked: true,
  },
  {
    id: "prep-walkthrough",
    itemName: "Final walkthrough with all teams",
    category: "organization",
    isChecked: false,
  },
  {
    id: "prep-kids-checkin",
    itemName: "Kids check-in stations set",
    category: "setup",
    isChecked: false,
  },
] satisfies MaterialsChecklistItemView[];

/** The meeting's real completion, unchanged by which rows a composition shows.
 *  It is what the progress card and its bar read. */
export const LAUNCH_PREP_SUMMARY = { total: 8, checked: 4 };

/** Desktop: the progress card plus two category cards — Essential and
 *  Materials. Four of the eight rows, chosen by what fits the phase pane at a
 *  readable size rather than by what they say: all eight would render the
 *  app's own type at ~8px in this pane (see .vg-prelaunch in marketing.css).
 *  The four kept are the ones the retired vignette drew. */
export const LAUNCH_PREP_DESKTOP = LAUNCH_PREP_ITEMS.filter(
  (item) => item.category === "essential" || item.category === "materials"
);

/** Below 900px, one category card: Materials. Three real rows at the app's own
 *  size beats eight at a size nobody can read, and Materials is the one whose
 *  rows say both things at once — two struck through, one still open. The `-m`
 *  ids keep this composition's DOM ids distinct from the desktop one's. */
export const LAUNCH_PREP_COMPACT = LAUNCH_PREP_ITEMS.filter(
  (item) => item.category === "materials"
).map((item) => ({ ...item, id: `${item.id}-m` }));
