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
import type { UserRole } from "@/db/schema";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Shown wherever a number was never recorded, rather than an empty cell. */
export const NOT_RECORDED = "Not recorded";

// ----------------------------------------------------------------------------
// Plant header facts.
// ----------------------------------------------------------------------------

/**
 * The caller's own org in the reader's words. Used in the explain-why copy, so
 * an admin is told who the plant declined to share with in the same words the
 * rest of the oversight surface uses.
 */
export function scopeLabelForRole(role: UserRole): string {
  return role === "network_admin" ? "network" : "sending church";
}

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

/**
 * Whole days from `asOf` to a yyyy-mm-dd launch date; negative once past.
 *
 * The date is parsed at UTC midnight, which is `APP_TIME_ZONE`, so the
 * countdown does not shift with the server's `TZ` — the same `parseDateOnly`
 * the phase-engine signal layer uses for the identical fact.
 */
export function daysUntilLaunch(
  launchDate: string | null,
  asOf: Date
): number | null {
  if (!launchDate) return null;
  const target = new Date(`${launchDate}T00:00:00.000Z`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.floor((target.getTime() - asOf.getTime()) / MS_PER_DAY);
}

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
