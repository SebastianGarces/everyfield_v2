// ============================================================================
// Cited-fact humanising (PE, issue #154).
//
// The judge is required to cite the exact fact keys that drove an insight
// (judge/prompt.ts, rule 3), so `plant_insights.cited_facts` holds strings in
// the fact ledger's own syntax: `ministryRoles.filledCount=4`. That syntax is
// the right contract for the model and for the reviewer who checks a citation
// against the snapshot. It is the wrong thing to put in front of a planter:
//
//   - "Based on ministryRoles.filledCount=4" is field syntax, not evidence.
//     The Plant Intelligence surface is the one a planter is meant to ACT on,
//     and a dotted path is the opposite of actionable.
//   - It leaks the shape of the fact store to end users.
//
// This module is the ONE place that turns a stored citation into a phrase a
// planter reads. Both surfaces that render citations — the CSF scorecard tiles
// and the Focus insight cards — go through it, so the fix lands once rather
// than per-surface.
//
// ---------------------------------------------------------------------------
// The rules this file is written against
// ---------------------------------------------------------------------------
//
// 1. HUMANISING MUST NOT DROP THE EVIDENCE. "Your ministry roles need work" is
//    not a citation. Every phrase for a counted fact carries its number, so the
//    planter can still check the claim against what they know. The only values
//    deliberately withheld are opaque identifiers (a personId is a UUID: it is
//    unreadable to a planter and it names an individual — see
//    assessment/persist.ts, which drops network insights that cite one).
//
// 2. AN UNKNOWN SHAPE DEGRADES, IT NEVER THROWS AND NEVER LEAKS SYNTAX. The
//    snapshot grows, and a model can cite a key that no longer exists or was
//    never in the ledger. Anything this module does not recognise still comes
//    out as words: the path is de-camelised into a label, the value is
//    humanised, and the `=` is gone. A citation is evidence — silently dropping
//    an unrecognised one would weaken the insight it belongs to.
//
// 3. THE OUTPUT IS A SENTENCE FRAGMENT, NOT A SENTENCE. Both callers introduce
//    the list themselves ("Based on …"), so every phrase reads as a
//    continuation: it starts with a digit or a lowercase word, and it carries
//    no trailing period. That is one capitalisation policy across both
//    surfaces (better-writing §8) rather than two.
//
// Pure and IO-free — no DB, no DOM, no LLM — so it is unit-testable under the
// repo's node:test harness, which only runs `src/**/*.test.ts`.
// ============================================================================

import { formatDate } from "@/lib/datetime";
import { MINISTRY_ROLE_KEYS } from "@/lib/phase-engine/signals/types";

// ----------------------------------------------------------------------------
// Parsing.
// ----------------------------------------------------------------------------

/** A citation split into the fact it names and the value it asserts. */
export interface ParsedCitedFact {
  /** The dotted fact path, e.g. `ministryRoles.filledCount`. */
  path: string;
  /** The asserted value as written, or `null` when the citation had no `=`. */
  value: string | null;
}

/**
 * Split `key=value` on the FIRST `=` only: the key never contains one, the
 * value theoretically can. A citation with no `=` (the model cited a bare key)
 * parses to a null value rather than failing.
 */
export function parseCitedFact(fact: string): ParsedCitedFact {
  const trimmed = fact.trim();
  const separator = trimmed.indexOf("=");
  if (separator === -1) return { path: trimmed, value: null };
  return {
    path: trimmed.slice(0, separator).trim(),
    value: trimmed.slice(separator + 1).trim(),
  };
}

/**
 * Collapse array indices so `leadership.candidates[0].personId` and
 * `leadership.candidates.3.personId` reach the same template. Both spellings
 * occur in stored data (the ledger emits dotted indices; the model sometimes
 * echoes bracketed ones).
 */
function normalizePath(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => (/^\d+$/.test(segment) ? "#" : segment))
    .filter((segment) => segment.length > 0)
    .join(".");
}

// ----------------------------------------------------------------------------
// Small value helpers.
// ----------------------------------------------------------------------------

/** `1 meeting` / `2 meetings` — a full phrase per branch, never concatenated. */
function count(n: number, singular: string, plural: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural}`;
}

/** Parse a numeric fact value; `null` when the value is not a finite number. */
function toNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse a boolean fact value; `null` when the value is not a boolean. */
function toBoolean(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-][\d:]+)?)?$/;

/**
 * Format a stored ISO date/datetime for reading. Goes through `lib/datetime`
 * so the zone is pinned to `APP_TIME_ZONE` — an unpinned formatter renders one
 * string on the server and another after hydration (memory/invariants.md →
 * Date & Time Rendering). An unparseable value falls back to itself.
 */
function toReadableDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatDate(parsed, "short");
}

/** `financialBaseInPlace` / `financial_base_in_place` → `financial base in place`. */
function toWords(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ----------------------------------------------------------------------------
// Known facts.
//
// One entry per path in the deterministic snapshot (signals/types.ts). Indices
// are collapsed to `#`, so a per-candidate or per-role citation is phrased as
// "one …" rather than pretending the reader knows which row index 3 was.
// ----------------------------------------------------------------------------

/** Always 8 (CSF-7): the roles a plant must cover before launch. */
const TOTAL_MINISTRY_ROLES = MINISTRY_ROLE_KEYS.length;

/**
 * What each curated self-attestation asserts, as a clause that completes
 * "you confirmed …". Wording tracks the toggle labels the planter answered
 * (components/phase-engine/signal-toggles.tsx) so the evidence uses the same
 * words as the control that produced it.
 */
const MANUAL_SIGNAL_CLAUSES: Record<string, string> = {
  values_documented: "your core values are documented",
  financial_base_established: "your financial base is in place",
  prayer_leader_assigned: "a prayer leader is assigned",
  systems_tested: "your launch systems have been tested",
};

function manualSignalClause(key: string): string {
  return MANUAL_SIGNAL_CLAUSES[key] ?? toWords(key);
}

/**
 * A phrase builder for one known fact path. Returns `null` when the value is
 * not the shape this fact expects (a count that is not a number, say), which
 * hands the citation to the generic fallback instead of printing nonsense.
 */
type FactPhrase = (value: string | null) => string | null;

/** Build a phrase from a numeric value, or defer to the fallback. */
function numeric(phrase: (n: number) => string): FactPhrase {
  return (value) => {
    const n = toNumber(value);
    return n === null ? null : phrase(n);
  };
}

/** Build a phrase from a boolean value, or defer to the fallback. */
function boolean(whenTrue: string, whenFalse: string): FactPhrase {
  return (value) => {
    const flag = toBoolean(value);
    if (flag === null) return null;
    return flag ? whenTrue : whenFalse;
  };
}

/** Build a phrase from a date value, or defer to the fallback. */
function date(phrase: (readable: string) => string): FactPhrase {
  return (value) => {
    if (!value || !ISO_DATE_PATTERN.test(value)) return null;
    return phrase(toReadableDate(value));
  };
}

const FACT_PHRASES: Record<string, FactPhrase> = {
  // -- the plant itself ------------------------------------------------------
  currentPhase: numeric((n) => `you are in phase ${n}`),
  isColdStart: boolean(
    "no activity recorded yet",
    "activity recorded across your plant"
  ),
  generatedAt: date((d) => `assessed on ${d}`),
  snapshotVersion: (value) =>
    value ? `snapshot version ${value}` : "a snapshot version",
  // A church id says nothing a planter looking at their own plant needs.
  churchId: () => "your plant",

  // -- core group (CSF-2) ----------------------------------------------------
  "coreGroup.committedCount": numeric((n) =>
    count(n, "committed core-group member", "committed core-group members")
  ),
  "coreGroup.launchTeamCount": numeric((n) =>
    count(n, "launch-team member", "launch-team members")
  ),
  "coreGroup.growthDelta": numeric((n) => {
    if (n > 0) return `${n} more committed than the window before`;
    if (n < 0) return `${Math.abs(n)} fewer committed than the window before`;
    return "0 change in committed members since the window before";
  }),
  "coreGroup.growthWindowDays": numeric((n) => `a ${n}-day growth window`),
  "coreGroup.isEmpty": boolean(
    "no core-group commitments recorded yet",
    "core-group commitments on record"
  ),

  // -- vision meetings (CSF-3) ----------------------------------------------
  "visionMeetings.totalCompleted": numeric((n) =>
    count(n, "vision meeting held", "vision meetings held")
  ),
  "visionMeetings.lastMeetingAt": date(
    (d) => `your last vision meeting on ${d}`
  ),
  "visionMeetings.daysSinceLastMeeting": numeric((n) =>
    n === 1
      ? "1 day since your last vision meeting"
      : `${n} days since your last vision meeting`
  ),
  "visionMeetings.averageCadenceDays": numeric((n) =>
    n === 1
      ? "a vision meeting about every day"
      : `a vision meeting about every ${n} days`
  ),
  "visionMeetings.latestAttendance": numeric((n) =>
    n === 1
      ? "1 person at your latest vision meeting"
      : `${n} people at your latest vision meeting`
  ),
  "visionMeetings.previousAttendance": numeric((n) =>
    n === 1
      ? "1 person at the vision meeting before that"
      : `${n} people at the vision meeting before that`
  ),
  "visionMeetings.attendanceTrend": (value) => {
    if (value === "up") return "vision-meeting attendance rising";
    if (value === "down") return "vision-meeting attendance falling";
    if (value === "flat") return "vision-meeting attendance holding steady";
    return null;
  },
  "visionMeetings.isEmpty": boolean(
    "no vision meetings held yet",
    "vision meetings on record"
  ),

  // -- follow-up (CSF-4) -----------------------------------------------------
  "followUp.openCount": numeric((n) =>
    count(n, "open follow-up", "open follow-ups")
  ),
  "followUp.stalestDays": numeric((n) =>
    n === 1
      ? "1 day since your longest-waiting contact was last touched"
      : `${n} days since your longest-waiting contact was last touched`
  ),
  "followUp.staleCount": numeric((n) =>
    n === 1
      ? "1 contact waiting longer than your follow-up window"
      : `${n} contacts waiting longer than your follow-up window`
  ),
  "followUp.staleThresholdDays": numeric((n) => `a ${n}-day follow-up window`),
  "followUp.isEmpty": boolean(
    "no open follow-ups",
    "open follow-ups on your list"
  ),

  // -- ministry roles (CSF-7) ------------------------------------------------
  "ministryRoles.filledCount": numeric(
    (n) => `${n} of ${TOTAL_MINISTRY_ROLES} ministry roles filled`
  ),
  "ministryRoles.totalRoles": numeric((n) =>
    count(n, "ministry role to cover", "ministry roles to cover")
  ),
  "ministryRoles.roles.#.key": (value) =>
    value ? `the ${toWords(value)} ministry role` : null,
  "ministryRoles.roles.#.label": (value) =>
    value ? `the ${value.toLowerCase()} ministry role` : null,
  "ministryRoles.roles.#.teamPresent": boolean(
    "a team in place for one ministry role",
    "no team yet for one ministry role"
  ),
  "ministryRoles.roles.#.filled": boolean(
    "a leader in place for one ministry role",
    "no leader yet for one ministry role"
  ),
  "ministryRoles.isEmpty": boolean(
    "no ministry teams set up yet",
    "ministry teams on record"
  ),

  // -- leadership (CSF-5) ----------------------------------------------------
  // Per-candidate facts stay anonymous: the snapshot's only person handle is a
  // UUID, which reads as noise and names an individual.
  "leadership.candidates.#.personId": () => "one leadership candidate",
  "leadership.candidates.#.status": (value) =>
    value ? `one leadership candidate at the ${toWords(value)} stage` : null,
  "leadership.candidates.#.tenureDays": numeric((n) =>
    n === 1
      ? "one leadership candidate 1 day in"
      : `one leadership candidate ${n} days in`
  ),
  "leadership.candidates.#.meetingsAttended": numeric((n) =>
    n === 1
      ? "one leadership candidate at 1 vision meeting"
      : `one leadership candidate at ${n} vision meetings`
  ),
  "leadership.candidates.#.activeMemberships": numeric((n) =>
    n === 1
      ? "one leadership candidate on 1 ministry team"
      : `one leadership candidate on ${n} ministry teams`
  ),
  "leadership.candidates.#.hasCommitment": boolean(
    "one leadership candidate with a signed commitment",
    "one leadership candidate without a signed commitment"
  ),
  "leadership.candidates.#.leadsTeam": boolean(
    "one leadership candidate already leading a team",
    "one leadership candidate not yet leading a team"
  ),
  "leadership.isEmpty": boolean(
    "no leadership candidates yet",
    "leadership candidates on your list"
  ),

  // -- training (CSF-8) ------------------------------------------------------
  "training.programCount": numeric((n) =>
    count(n, "training program", "training programs")
  ),
  "training.requiredProgramCount": numeric((n) =>
    count(n, "required training program", "required training programs")
  ),
  "training.completionCount": numeric((n) =>
    count(n, "training completion", "training completions")
  ),
  "training.requiredCompletionRate": numeric(
    (n) => `${Math.round(n * 100)}% of required training complete`
  ),
  "training.isEmpty": boolean(
    "no training programs set up yet",
    "training programs on record"
  ),

  // -- launch ----------------------------------------------------------------
  "launch.launchDate": date((d) => `a launch date of ${d}`),
  "launch.daysUntilLaunch": numeric((n) => {
    if (n > 0) return n === 1 ? "1 day until launch" : `${n} days until launch`;
    if (n < 0) {
      const past = Math.abs(n);
      return past === 1
        ? "1 day past your launch date"
        : `${past} days past your launch date`;
    }
    return "0 days until launch — launch day is today";
  }),
  "launch.isPastDue": boolean(
    "your launch date has passed",
    "your launch date is still ahead"
  ),
  "launch.isEmpty": boolean(
    "no launch date set yet",
    "a launch date on record"
  ),

  // -- manual self-attestations ---------------------------------------------
  "manual.attestations.#.signalKey": (value) =>
    value ? `a self-report about ${toWords(value)}` : null,
  "manual.attestations.#.value": (value) => {
    const flag = toBoolean(value);
    if (flag === null) return value ? `a self-report of ${value}` : null;
    return flag
      ? "something you confirmed"
      : "something you have not confirmed";
  },
  "manual.attestations.#.attestedAt": date((d) => `a self-report from ${d}`),
  "manual.isEmpty": boolean(
    "nothing self-reported yet",
    "self-reports on record"
  ),
};

/**
 * `manual.byKey.<signalKey>` is an open map, so it cannot live in the table
 * above — the key is data, not a fixed path.
 */
function manualByKeyPhrase(
  normalized: string,
  value: string | null
): string | null {
  const prefix = "manual.byKey.";
  if (!normalized.startsWith(prefix)) return null;
  const signalKey = normalized.slice(prefix.length);
  if (!signalKey) return null;

  const clause = manualSignalClause(signalKey);
  const flag = toBoolean(value);
  if (flag === true) return `you confirmed ${clause}`;
  if (flag === false) return `you have not confirmed ${clause}`;
  return value ? `${clause}, reported as ${toWords(value)}` : clause;
}

// ----------------------------------------------------------------------------
// The fallback: an unrecognised shape still comes out as words.
// ----------------------------------------------------------------------------

/**
 * Humanise a value with no template behind it. Opaque identifiers resolve to
 * `null` (render the label alone) rather than putting a UUID in front of a
 * planter.
 */
function fallbackValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "undefined") {
    return "not recorded";
  }
  if (trimmed === "true") return "yes";
  if (trimmed === "false") return "no";
  if (UUID_PATTERN.test(trimmed)) return null;
  if (ISO_DATE_PATTERN.test(trimmed)) return toReadableDate(trimmed);
  if (toNumber(trimmed) !== null) return trimmed;
  // Anything else is prose or an enum: de-camelise it and strip any stray `=`
  // so no fragment of ledger syntax survives.
  return toWords(trimmed.replace(/=+/g, " ")) || "not recorded";
}

/**
 * Turn an unrecognised path into a label: the leaf names the thing, the branch
 * it hangs off gives it context. `generosity.financialBaseInPlace` becomes
 * "financial base in place (generosity)".
 */
function fallbackLabel(normalized: string): string {
  const segments = normalized
    .split(".")
    .filter((segment) => segment.length > 0 && segment !== "#")
    .map(toWords)
    .filter(Boolean);

  if (segments.length === 0) return "an unnamed detail";

  const leaf = segments[segments.length - 1];
  const context = segments.slice(0, -1).join(" ");
  return context ? `${leaf} (${context})` : leaf;
}

// ----------------------------------------------------------------------------
// Public API.
// ----------------------------------------------------------------------------

/**
 * Turn one stored citation into a phrase a planter reads.
 *
 * Never throws and never returns ledger syntax: an unrecognised path degrades
 * to a de-camelised label plus a humanised value. Returns `""` only for an
 * empty input, which `formatCitedFacts` drops.
 */
export function formatCitedFact(fact: string): string {
  if (typeof fact !== "string" || fact.trim() === "") return "";

  const { path, value } = parseCitedFact(fact);
  const normalized = normalizePath(path);

  const known =
    FACT_PHRASES[normalized]?.(value) ?? manualByKeyPhrase(normalized, value);
  if (known) return known;

  const label = fallbackLabel(normalized);
  const readable = fallbackValue(value);
  return readable ? `${label}: ${readable}` : label;
}

/**
 * Humanise a whole `cited_facts` column.
 *
 * Takes `unknown` because the column is `jsonb`: both render surfaces would
 * otherwise repeat the same cast, and a malformed row must degrade to "no
 * citations" rather than crash the page. Duplicates are collapsed — several
 * per-row citations can legitimately humanise to the same phrase, and "one
 * leadership candidate, one leadership candidate" reads as a bug.
 */
export function formatCitedFacts(citedFacts: unknown): string[] {
  if (!Array.isArray(citedFacts)) return [];

  const phrases: string[] = [];
  const seen = new Set<string>();

  for (const fact of citedFacts) {
    if (typeof fact !== "string") continue;
    const phrase = formatCitedFact(fact);
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    phrases.push(phrase);
  }

  return phrases;
}
