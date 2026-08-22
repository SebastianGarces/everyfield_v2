import type { PrivacyFeatureKey } from "@/lib/auth/access";
import { OVERSIGHT_SHARING_FEATURE } from "@/lib/notifications/categories";

// ============================================================================
// THE PULL TOGGLES, AND WHAT THE PLANTER IS TOLD EACH ONE DOES (CS-011, #619).
//
// The six `share_*` columns on `church_privacy_settings` gate what an oversight
// org may PULL — the sections of its per-plant page, and the insight categories
// behind them. They have gated those reads since migration 0029 and had NO EDIT
// UI anywhere until this file: the panel in the Church settings section is the
// first surface a planter can actually decide them on.
//
// ONE ORDERED LIST, and it is the only one. The panel renders it, the write
// action validates against it, and `sections.test.ts` asks it which keys are
// pull toggles rather than keeping the hand-written set it used to. The ORDER is
// the array's — a panel that sorted for itself would be a second opinion about
// which decision a planter meets first.
//
// WHY THE COPY LIVES HERE AND NOT IN THE COMPONENT. It is the same rule
// `OVERSIGHT_SHARING_TOGGLE` (`@/lib/notifications/categories`) is kept under
// and for the same reason: consent copy that lives in a page is consent copy no
// guard can hold to the code. `toggles.test.ts` holds every line below to
// `memory/invariants.md` line 84 — a summary may state what the org gets to see
// and what it never sees, and may not claim the plant is hidden, because the
// portfolio listing (name, stage, launch countdown, health) returns to an
// oversight admin with no privacy gate at all.
//
// EACH SUMMARY IS PERMISSION LANGUAGE, deliberately: "lets them see". Two of the
// six — `financials` and `facilities` — gate a read that has no oversight
// section drawn for it yet, so a summary phrased as "they see X" would describe
// a screen that does not exist. Phrased as permission it is true on the day the
// section lands and true before it, and the never-clause — the half a planter is
// actually deciding on — is exact in both cases.
// ============================================================================

/**
 * Every feature key except the PUSH toggle, which is a different question.
 *
 * The literal is written once, in `OVERSIGHT_SHARING_FEATURE` beside the gate it
 * names, and `satisfies` there keeps it narrow enough to subtract with.
 */
export type SharingPullFeature = Exclude<
  PrivacyFeatureKey,
  typeof OVERSIGHT_SHARING_FEATURE
>;

export interface SharingPullToggle {
  feature: SharingPullFeature;
  /** The switch's own label. Sentence case, no trailing period. */
  label: string;
  /** One line: what this opens, and what it never opens. */
  summary: string;
}

export const SHARING_PULL_TOGGLES = [
  {
    feature: "people",
    label: "People",
    summary:
      "Lets them see how many people sit at each stage of your pipeline. Never a name, a note or a contact detail.",
  },
  {
    feature: "meetings",
    label: "Meetings",
    summary:
      "Lets them see how often you meet and how attendance has been running. Never who came, and never what was said.",
  },
  {
    feature: "tasks",
    label: "Tasks",
    summary:
      "Lets them see how much work is open, finished and overdue. Never a task, its owner or its notes.",
  },
  {
    feature: "financials",
    label: "Finances",
    summary:
      "Lets them see period totals for money in and money out. Never a donor, a gift or a line item.",
  },
  {
    feature: "ministry_teams",
    label: "Ministry teams",
    summary:
      "Lets them see how many teams you have and how many of them have a leader. Never who leads one or who is on it.",
  },
  {
    feature: "facilities",
    label: "Facilities",
    summary:
      "Lets them see how much space and equipment you have booked. Never an address, a contract or a cost.",
  },
] as const satisfies readonly SharingPullToggle[];

/**
 * COMPILE-TIME TOTALITY. A seventh pull column — `share_wiki` (#62) is the one
 * on its way — widens `PrivacyFeatureKey`, and the build fails HERE until the
 * new key has a row above. A test would have caught it a run later; this catches
 * it before the panel can ship with a toggle the planter cannot see.
 */
type PullFeatureWithNoRow = Exclude<
  SharingPullFeature,
  (typeof SHARING_PULL_TOGGLES)[number]["feature"]
>;
const _everyPullFeatureHasARow: [PullFeatureWithNoRow] extends [never]
  ? true
  : ["missing from SHARING_PULL_TOGGLES", PullFeatureWithNoRow] = true;
void _everyPullFeatureHasARow;

/** Is this string one of the six? Module-private — `isSharingFeature` is the
 * question every caller actually has. */
function isSharingPullFeature(value: string): value is SharingPullFeature {
  return SHARING_PULL_TOGGLES.some((toggle) => toggle.feature === value);
}

/**
 * Is this string a toggle the panel writes at all — one of the six, or the push
 * toggle? The write action's boundary check, and the ONLY thing that turns an
 * arbitrary posted string into a `PrivacyFeatureKey`.
 */
export function isSharingFeature(value: string): value is PrivacyFeatureKey {
  return isSharingPullFeature(value) || value === OVERSIGHT_SHARING_FEATURE;
}

/**
 * The sentence above the panel.
 *
 * It names the ungated portfolio listing in the same breath as the toggles,
 * because a panel of six switches with no such line reads as "turn these off and
 * they see nothing" — the exact overclaim `memory/invariants.md` line 84 exists
 * to forbid, made by layout rather than by a sentence.
 */
export const SHARING_PANEL_INTRO =
  "Your sending church or network can always see this plant listed with its name, current stage and launch date. These switches decide what else they may look up, and they only ever see totals — never the people behind them.";
