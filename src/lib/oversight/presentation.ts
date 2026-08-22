// ============================================================================
// Oversight plants — PRESENTATION rules (labels, countdowns, stat lists).
//
// `./read.ts` decides what an oversight user may see; this module decides how
// it reads. Everything here is pure, so the copy an admin's judgement rests on
// is unit-testable without a DATABASE_URL — the same seam
// `phase-engine/oversight/health-presentation.ts` uses.
//
// Two things are load-bearing rather than cosmetic:
//
//   1. Every date goes through `@/lib/datetime`, pinned to `APP_TIME_ZONE`.
//      A `Date` formatted in the visitor's zone on the client and in UTC on the
//      server renders two different strings and a hydration mismatch
//      (memory/invariants.md → Date & Time Rendering).
//   2. An aggregate that is ABSENT and an aggregate that is ZERO are different
//      facts, and neither may render as a blank. "Not recorded" is a statement;
//      an empty cell is a bug the reader has to guess about.
// ============================================================================

import { PHASES } from "@/lib/constants";
import { formatDate } from "@/lib/datetime";
import { STATUS_LABELS } from "@/lib/people/status.shared";
import type {
  MeetingsAggregate,
  MinistryTeamsAggregate,
  NetworkSendingChurchSummary,
  OversightAssociationProvenance,
  OversightStat,
  PeopleAggregate,
  TasksAggregate,
} from "@/lib/oversight/types";

/** Shown wherever a number was never recorded, rather than an empty cell. */
export const NOT_RECORDED = "Not recorded";

// ----------------------------------------------------------------------------
// Plant header facts.
// ----------------------------------------------------------------------------

// THE SCOPE LABEL IS NOT HERE, and is deliberately NOT re-exported from here.
// "network" / "sending church" live in the import-free leaf
// `@/lib/oversight/org-label`, because `remove-plant-dialog.tsx` is a
// `"use client"` component and this module reaches `@/db/schema` through
// `STATUS_LABELS`. Re-exporting them would make the heavy path type-check and
// work, which is exactly how a leaf stops being one (memory/invariants.md →
// Multi-Tenancy, the `register-path.ts` rule).

/**
 * "Austin, Texas, US" from whichever location parts the plant filled in.
 *
 * The three columns are INDIVIDUALLY optional by design (OB-002: a planter who
 * knows the city but not the region must not be blocked), so this joins what
 * exists rather than assuming a full address, and returns null when the plant
 * gave no location at all.
 */
export function formatPlantLocation(
  city: string | null,
  stateRegion: string | null,
  country: string | null
): string | null {
  const parts = [city, stateRegion, country]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

/** `PHASES` lookup that cannot throw on an out-of-range phase from the DB. */
export function formatPhase(phase: number): string {
  return PHASES[phase as keyof typeof PHASES] ?? `Phase ${phase}`;
}

// ----------------------------------------------------------------------------
// Portfolio phase distribution — the oversight index (`/oversight`).
//
// THE PHASE LIST IS DERIVED, NEVER COUNTED OUT BY HAND. The index used to walk
// `Array.from({ length: 7 })` and split "pre-launch" from "launched" on a bare
// `< 5`, while `PHASES` (`@/lib/constants`) is the declaration of what the
// phases ARE. `churches.current_phase` is an unconstrained `integer` column, so
// a value outside 0–6 is a value the database can hold: it was counted in the
// total, dropped from every bar — leaving the histogram silently not summing to
// the number above it — and bucketed as "launched" by accident. Deriving the
// sequence from `PHASES` and folding any out-of-range value in as its own row
// makes both halves add up whatever the column holds, and makes a seventh phase
// a one-line change in `constants.ts` rather than a hunt.
// ----------------------------------------------------------------------------

/**
 * The first phase at which a plant counts as launched (Phase 5: Launch Sunday).
 *
 * Named once because two figures on the index depend on it AND their captions
 * describe it — three places that must not be able to disagree.
 */
export const LAUNCH_PHASE = 5;

/** Every declared phase, ascending. Derived from `PHASES`, never re-typed. */
export const PHASE_SEQUENCE: readonly number[] = Object.keys(PHASES)
  .map(Number)
  .sort((a, b) => a - b);

/** One bar on the index's phase histogram. */
export interface PortfolioPhaseRow {
  phase: number;
  label: string;
  count: number;
  /** Whole percent of the portfolio, and 0 means 0 — never a token sliver. */
  percentage: number;
}

/** Everything the oversight index reads off its roster of plants. */
export interface PortfolioPhaseSummary {
  total: number;
  preLaunch: number;
  launched: number;
  /** How many distinct phases the portfolio actually occupies. */
  occupiedPhases: number;
  distribution: PortfolioPhaseRow[];
}

/**
 * The index's three cards and its histogram, from the phase column alone.
 *
 * Pure, so the arithmetic an admin's read of their whole portfolio rests on is
 * unit-tested rather than assembled inline in JSX — the same reason
 * `summarizeSendingChurchRoster` lives here.
 *
 * `distribution` covers every DECLARED phase plus any undeclared value present
 * in the data, so `distribution.reduce(count)` always equals `total`. A phase
 * nobody is in still gets a row: "nobody is at Phase 3" is an answer, and a
 * missing row reads as a rendering failure.
 */
export function summarizePortfolioPhases(
  phases: number[]
): PortfolioPhaseSummary {
  const counts = new Map<number, number>(
    PHASE_SEQUENCE.map((phase) => [phase, 0])
  );
  for (const phase of phases) {
    counts.set(phase, (counts.get(phase) ?? 0) + 1);
  }

  const total = phases.length;
  const distribution = [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([phase, count]) => ({
      phase,
      label: formatPhase(phase),
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }));

  return {
    total,
    preLaunch: phases.filter((phase) => phase < LAUNCH_PHASE).length,
    launched: phases.filter((phase) => phase >= LAUNCH_PHASE).length,
    occupiedPhases: distribution.filter((row) => row.count > 0).length,
    distribution,
  };
}

/** "Across 3 phases" — the caption under the portfolio's headline count. */
export function portfolioSpreadCaption(summary: PortfolioPhaseSummary): string {
  return `Across ${summary.occupiedPhases} ${plural(summary.occupiedPhases, "phase")}`;
}

/**
 * The two launch-split captions, derived from `LAUNCH_PHASE`.
 *
 * They name the BOUNDARY rather than enumerating the phases either side of it.
 * The enumerated form ("Plants in phases 5-6") was a second declaration of the
 * phase list that went stale the moment `PHASES` grew, and it was already false
 * for any value the unconstrained column can hold.
 */
export const PRE_LAUNCH_CAPTION = `Before phase ${LAUNCH_PHASE} — still preparing to launch`;
export const LAUNCHED_CAPTION = `Phase ${LAUNCH_PHASE} and beyond — launched or past it`;

/**
 * What an empty PLANT portfolio says — to a reader who may not be able to
 * change it.
 *
 * IT STATES THE CONDITION, IT DOES NOT ISSUE AN INSTRUCTION (#636). "Send
 * invitations to get started" is an order, and an org Member cannot follow it:
 * #500 gave them a seat that reads the portfolio and changes nothing, so the
 * page carries no invite control for them anywhere. Telling somebody to do a
 * thing the screen does not let them do reads as a broken page, not as a
 * suggestion.
 *
 * The sentence is true for an Owner and a Member alike, so it needs no seat
 * branch of its own. The CALL TO ACTION is what turns on the seat, and
 * `EmptyPortfolio` renders it gated on `org.invitation.manage`.
 *
 * WHICH SURFACES THESE SERVE, and which state their own condition on purpose.
 * These two strings are for the empty PLANT portfolio: the `/oversight` index
 * and the `/oversight/plants` directory, which said the same fact in three
 * hand-typed wordings until #636 — and the copy is always the one that misses
 * the fix, which is how the Owner's instruction outlived #500 on the index.
 *
 * The sending-church roster and `/oversight/health` are NOT behind these and
 * should not be folded in. They are different subjects with different
 * conditions — health adds "after each plant's first assessment" — and neither
 * carries an imperative, so neither was ever this defect. A shared template
 * that served all four would need a subject noun, a pronoun and a trailing
 * condition slot, which is a worse trade than three similar sentences.
 */
export const EMPTY_PORTFOLIO_HEADLINE = "No plants yet";

export function emptyPortfolioCaption(scopeLabel: string): string {
  return `A plant appears here once its planter accepts an invitation from your ${scopeLabel}.`;
}

// THE COUNTDOWN ITSELF IS NOT HERE. This module carried a byte-for-byte copy
// of `daysUntilTarget` (`src/lib/launch/countdown.ts`) — written first, in PR
// #339, and left in place when the canon was extracted. It is gone: two
// implementations of exactly this calculation is HOW #338 shipped twice, once
// in this layer and once in the phase-engine signal layer, and the copy is
// always the one that does not get the fix. Oversight's readers call the canon
// (`read.ts`), and what stays here is the SENTENCE that number is rendered as.

/** The countdown as a sentence — never a bare number with no sign. */
export function formatLaunchCountdown(days: number | null): string {
  if (days === null) return "No launch date set";
  if (days === 0) return "Launches today";
  if (days > 0) return `${days} ${plural(days, "day")} to launch`;
  const past = Math.abs(days);
  return `Launched ${past} ${plural(past, "day")} ago`;
}

/**
 * One line saying how this plant came to be the caller's (OV-001).
 *
 * Names the caller's OWN org, never another's. A missing `associatedAt` says so
 * outright: associations can predate the invitation system or arrive by
 * seeding, and "no invitation on record" is the fact, not a formatting failure.
 *
 * `viaSendingChurchName` is a position in the caller's OWN hierarchy, not a
 * causal claim about how the association was made — the read layer only ever
 * populates it with a sending church inside the caller's network
 * (`sendingChurchesInNetwork` in `./read.ts`), because the two association FKs
 * are independent and one is never the route to the other.
 */
export function formatAssociationProvenance(
  provenance: OversightAssociationProvenance
): string {
  const joined = provenance.associatedAt
    ? `Joined ${provenance.orgName} on ${formatDate(provenance.associatedAt, "short")}`
    : `Associated with ${provenance.orgName} — no invitation on record`;

  return provenance.viaSendingChurchName
    ? `${joined} · through ${provenance.viaSendingChurchName}`
    : joined;
}

// ----------------------------------------------------------------------------
// Aggregate → stat list.
//
// Each section's numbers become a flat list of labelled values, which is the
// only shape the section component can render. That is deliberate: there is no
// field on `OversightStat` a person's name could travel in, so the invariant is
// enforced by the type rather than by remembering it at every call site.
// ----------------------------------------------------------------------------

export function peopleStats(aggregate: PeopleAggregate): OversightStat[] {
  return [
    { label: "People tracked", value: String(aggregate.total) },
    ...aggregate.byStatus.map((row) => ({
      label: STATUS_LABELS[row.status],
      value: String(row.count),
    })),
  ];
}

export function meetingsStats(aggregate: MeetingsAggregate): OversightStat[] {
  return [
    { label: "Completed meetings", value: String(aggregate.completedCount) },
    { label: "Scheduled ahead", value: String(aggregate.upcomingCount) },
    {
      label: "Last meeting",
      value: aggregate.lastCompletedAt
        ? formatDate(aggregate.lastCompletedAt, "short")
        : NOT_RECORDED,
      hint:
        aggregate.daysSinceLastCompleted === null
          ? undefined
          : daysAgoHint(aggregate.daysSinceLastCompleted),
    },
    {
      label: "Average gap",
      value:
        aggregate.averageCadenceDays === null
          ? "Needs two meetings"
          : `${aggregate.averageCadenceDays} ${plural(aggregate.averageCadenceDays, "day")}`,
    },
    {
      label: "Average attendance",
      value:
        aggregate.averageAttendance === null
          ? NOT_RECORDED
          : String(aggregate.averageAttendance),
    },
  ];
}

export function tasksStats(aggregate: TasksAggregate): OversightStat[] {
  return [
    { label: "Open", value: String(aggregate.open) },
    {
      label: "Completed",
      value: String(aggregate.completed),
      hint: `of ${aggregate.total} ${plural(aggregate.total, "task")}`,
    },
    { label: "Overdue", value: String(aggregate.overdue) },
  ];
}

export function ministryTeamsStats(
  aggregate: MinistryTeamsAggregate
): OversightStat[] {
  return [
    { label: "Teams", value: String(aggregate.teamCount) },
    {
      label: "With a leader",
      value: String(aggregate.teamsWithLeader),
      hint: `of ${aggregate.teamCount} ${plural(aggregate.teamCount, "team")}`,
    },
    {
      label: "Active memberships",
      value: String(aggregate.activeMemberships),
    },
  ];
}

// ----------------------------------------------------------------------------
// Emptiness — "shared, nothing in it" vs "not shared" is decided here, once.
// ----------------------------------------------------------------------------

export function isPeopleEmpty(aggregate: PeopleAggregate): boolean {
  return aggregate.total === 0;
}

export function isMeetingsEmpty(aggregate: MeetingsAggregate): boolean {
  return aggregate.completedCount === 0 && aggregate.upcomingCount === 0;
}

export function isTasksEmpty(aggregate: TasksAggregate): boolean {
  return aggregate.total === 0;
}

export function isMinistryTeamsEmpty(
  aggregate: MinistryTeamsAggregate
): boolean {
  return aggregate.teamCount === 0 && aggregate.activeMemberships === 0;
}

// ----------------------------------------------------------------------------
// Sending-church roster (OV-009).
// ----------------------------------------------------------------------------

/**
 * The roster in one line — "4 sending churches · 17 plants · 3 invitations
 * awaiting a reply".
 *
 * Pure, so the sentence an admin skims before reading the table is unit-tested
 * rather than assembled inline in JSX. Every clause is pluralised, and a zero
 * is stated ("0 plants") rather than dropped: a missing clause reads as a
 * rendering failure, where an explicit zero is the answer.
 */
export function summarizeSendingChurchRoster(
  rows: NetworkSendingChurchSummary[]
): string {
  const plants = rows.reduce((sum, row) => sum + row.plantCount, 0);
  const pending = rows.reduce(
    (sum, row) => sum + row.pendingInvitationCount,
    0
  );

  return [
    `${rows.length} ${plural(rows.length, "sending church", "sending churches")}`,
    `${plants} ${plural(plants, "plant")}`,
    `${pending} ${plural(pending, "invitation")} awaiting a reply`,
  ].join(" · ");
}

// ----------------------------------------------------------------------------
// Internal helpers.
// ----------------------------------------------------------------------------

/**
 * `plural(1, "day")` → "day". The third argument is for nouns English does not
 * pluralise with a bare "s" — "sending church" → "sending churches" — so a
 * caller never has to hand-build the irregular form at the call site.
 */
function plural(count: number, noun: string, pluralForm?: string): string {
  if (Math.abs(count) === 1) return noun;
  return pluralForm ?? `${noun}s`;
}

function daysAgoHint(days: number): string {
  if (days <= 0) return "Today";
  return `${days} ${plural(days, "day")} ago`;
}
