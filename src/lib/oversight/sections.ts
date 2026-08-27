// ============================================================================
// The gated sections of `/oversight/plants/[id]` — catalog and explain-why copy
// (OV-002).
//
// One definition per section, carrying the `share_*` toggle that gates it. The
// read layer resolves each `privacyFeature` through `canAccessFeatureData`, so
// the gate a section is subject to is declared HERE and nowhere else: a section
// cannot be added without naming its toggle, and no component decides
// visibility on its own.
//
// WHY ONLY FOUR. There are six pull toggles (`share_people`, `share_meetings`,
// `share_tasks`, `share_financials`, `share_ministry_teams`,
// `share_facilities`). Financials and facilities have no data model in the
// product yet — they are the two nav items still hidden from the planter's own
// sidebar — so a section for either could only ever render zeroes, which reads
// as "this plant has no finances" rather than "EveryField does not track this".
// They join this list in the change that gives them something to count.
// ============================================================================

import type { PrivacyFeatureKey } from "@/lib/auth/access";
import type { OversightSectionKey } from "@/lib/oversight/types";

export interface OversightSectionDefinition {
  key: OversightSectionKey;
  /** The `share_*` toggle this section is gated by. */
  privacyFeature: PrivacyFeatureKey;
  title: string;
  /** What the section shows, in one line, above the numbers. */
  description: string;
  /**
   * How the plant's decision is named in the explain-why copy. Lowercase and
   * noun-shaped, so it reads inside a sentence ("hasn't opened its people
   * pipeline to…") rather than as a control label.
   */
  subject: string;
}

export const OVERSIGHT_SECTIONS: readonly OversightSectionDefinition[] = [
  {
    key: "people",
    privacyFeature: "people",
    title: "People",
    description: "How many people sit at each stage of the plant's pipeline.",
    subject: "its people pipeline",
  },
  {
    key: "meetings",
    privacyFeature: "meetings",
    title: "Meeting cadence",
    description:
      "How often the plant is meeting, and how attendance has been running.",
    subject: "its meeting cadence",
  },
  {
    key: "tasks",
    privacyFeature: "tasks",
    title: "Task health",
    description: "Open, completed and overdue work across the plant.",
    subject: "its task health",
  },
  {
    key: "ministry_teams",
    privacyFeature: "ministry_teams",
    title: "Ministry-team coverage",
    description: "How many teams exist, and how many of them have a leader.",
    subject: "its ministry teams",
  },
] as const;

/** Definition lookup — total over `OversightSectionKey` by construction. */
export const OVERSIGHT_SECTIONS_BY_KEY = Object.fromEntries(
  OVERSIGHT_SECTIONS.map((section) => [section.key, section])
) as Record<OversightSectionKey, OversightSectionDefinition>;

// ----------------------------------------------------------------------------
// Explain-why copy (OV-002).
//
// "Never a bare blank" is the requirement, and a bare blank includes a card
// that says only "No data". The two states answer different questions:
//
//   withheld → the section intro explains the plant's control once; each row
//               then labels the specific category as not shared.
//   empty    → they DO share this; there is simply nothing in it yet.
//
// Collapsing them would tell an admin that a plant is hiding something when it
// is not, which is the misreading most likely to cost the org a conversation.
//
// The shared-empty copy says the plant shares this category, so an oversight
// admin never mistakes absent data for a withheld decision.
// ----------------------------------------------------------------------------

/** Heading on a section the plant has not shared. */
export const WITHHELD_HEADLINE = "Not shared";

/** Heading on a shared section with nothing recorded yet. */
export const EMPTY_HEADLINE = "Nothing recorded yet";

/** Why a shared section shows nothing — sharing is on; the data is not there. */
export function emptyExplanation(
  section: OversightSectionDefinition,
  plantName: string
): string {
  return `${plantName} shares ${section.subject}, but has not recorded anything here yet.`;
}

/**
 * The sentence above the section grid.
 *
 * It describes the GATE rather than asserting that sharing happened, because a
 * plant may have every toggle off — in which case "each area below is open to
 * your network" is read as a promise the cards below then break, and an admin
 * is left thinking the page is broken rather than that the plant said no. When
 * nothing at all is shared the page says so once, up front, instead of leaving
 * the reader to infer it from four identical refusals.
 */
export function sectionsIntro(
  plantName: string,
  scopeLabel: string,
  sharedCount: number
): string {
  const totals = "Totals only — never the people behind them.";
  return sharedCount === 0
    ? `${totals} ${plantName} has not opened any of these areas to your ${scopeLabel} — each plant decides what it shares.`
    : `${totals} ${plantName} decides which of these areas are open to your ${scopeLabel}.`;
}
