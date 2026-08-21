// ============================================================================
// The cited-fact VOCABULARY (PE, issue #154).
//
// One entry per path in the deterministic snapshot (signals/types.ts), plus the
// small machinery those entries are written in: the value parsers, the
// row-counting `Phrase` type, and the `numeric`/`boolean`/`date` builders.
//
// Split out of `fact-format.ts` because the two halves change for entirely
// different reasons (structural finding on #319). THIS file grows when the fact
// SNAPSHOT grows — a new signal, a new leaf, a new CSF. `fact-format.ts` changes
// when a ruling about CITATIONS lands: how a spelling is classified, how a
// column folds, what one citation asserts. Keeping them together meant every
// ruling edited a 1000-line file whose bulk was a lookup table it never touched.
//
// The `manual.attestations.#.*` leaves are deliberately NOT in `FACT_PHRASES`:
// they obey rules the rest of this table does not (never `null`, always drop
// their specifics above one row) and they answer three questions rather than
// one, so they live in `attestation-citation.ts` as a single table that makes
// both rules structural. See that module's header.
//
// Pure and IO-free — no DB, no DOM, no LLM.
// ============================================================================

import { formatDate } from "@/lib/datetime";
// The ONE manual-signal vocabulary — key, copy and the clause a citation of the
// signal reads back as. A VALUE import, and it introduces no new edge:
// `manual-signals.ts` is import-free on purpose (a `"use client"` island renders
// its labels).
import { MANUAL_SIGNALS } from "@/lib/phase-engine/manual-signals";
import { MINISTRY_ROLE_KEYS } from "@/lib/phase-engine/signals/types";

// ----------------------------------------------------------------------------
// Small value helpers.
// ----------------------------------------------------------------------------

/** `1 meeting` / `2 meetings` — a full phrase per branch, never concatenated. */
function count(n: number, singular: string, plural: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural}`;
}

/** Parse a numeric fact value; `null` when the value is not a finite number. */
export function toNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse a boolean fact value; `null` when the value is not a boolean. */
export function toBoolean(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-][\d:]+)?)?$/;

/**
 * Format a stored ISO date/datetime for reading. Goes through `lib/datetime`
 * so the zone is pinned to `APP_TIME_ZONE` — an unpinned formatter renders one
 * string on the server and another after hydration (memory/invariants.md →
 * Date & Time Rendering). An unparseable value falls back to itself.
 */
export function toReadableDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatDate(parsed, "short");
}

/** `financialBaseInPlace` / `financial_base_in_place` → `financial base in place`. */
export function toWords(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ----------------------------------------------------------------------------
// Phrases that count their rows.
//
// A fact that names an anonymous ROW returns a `RowPhrase` instead of a plain
// string. The phrase is then a function of how many rows cited the same thing,
// so an insight backed by three candidates reads "3 leadership candidates" and
// not "one leadership candidate" — the count is evidence, and dropping it
// understates the insight (ruling on #154).
// ----------------------------------------------------------------------------

/**
 * A phrase about an anonymous row, deferred until we know how many rows cited
 * it. `render(1)` is the singular a lone citation reads as.
 */
export interface RowPhrase {
  render: (rows: number) => string;
}

/** What a fact renders as: fixed prose, or prose that counts its rows. */
export type Phrase = string | RowPhrase;

/** How a row's subject is named at a given count. */
export type RowSubject = (rows: number) => string;

const CANDIDATES: RowSubject = (n) =>
  n === 1 ? "one leadership candidate" : `${n} leadership candidates`;

const MINISTRY_ROLES: RowSubject = (n) =>
  n === 1 ? "one ministry role" : `${n} ministry roles`;

export const SELF_REPORTS: RowSubject = (n) =>
  n === 1 ? "a self-report" : `${n} self-reports`;

/** The subject of an attestation's own value, which is a thing, not a report. */
export const ATTESTED_THINGS: RowSubject = (n) =>
  n === 1 ? "something" : `${n} things`;

/**
 * Build a row phrase from its subject and one template. The template receives
 * the subject already named for the count plus the count itself, so a plural
 * that needs more than an `s` ("3 leadership candidates EACH 90 days in") stays
 * a single template rather than two copies that can drift apart.
 */
export function perRow(
  subject: RowSubject,
  template: (subject: string, rows: number) => string
): RowPhrase {
  return { render: (rows) => template(subject(rows), rows) };
}

/** Render a phrase for a known number of rows. Plain prose ignores the count. */
export function renderPhrase(phrase: Phrase, rows: number): string {
  return typeof phrase === "string" ? phrase : phrase.render(rows);
}

// ----------------------------------------------------------------------------
// Manual self-attestation wording.
// ----------------------------------------------------------------------------

/** Always 8 (CSF-7): the roles a plant must cover before launch. */
const TOTAL_MINISTRY_ROLES = MINISTRY_ROLE_KEYS.length;

/**
 * What each curated self-attestation asserts, as a clause that completes
 * "you confirmed …".
 *
 * NOT A SECOND DECLARATION: the clauses are the fourth string every signal owns
 * and they live with the other three, in `manual-signals.ts` — the one module
 * the toggle card, the phase gate and the write schema all read. Wording has to
 * track the label the planter answered, and a `satisfies Record<ManualSignalKey,
 * string>` in a second file catches a MISSING clause while catching nothing at
 * all about a drifted one, which is the only property the pair exists for.
 *
 * A `Map`, not an object — see {@link FACT_PHRASES}: the key is a path segment
 * out of an LLM-authored citation, so `manual.byKey.toString` indexed an object
 * straight into `Object.prototype` and read "you confirmed function
 * toString() { [native code] }" to a planter. It is keyed by plain `string`,
 * because what is LOOKED UP is a segment of an LLM-written citation and may be
 * anything at all.
 */
const MANUAL_SIGNAL_CLAUSES: ReadonlyMap<string, string> = new Map(
  MANUAL_SIGNALS.map((signal) => [signal.key, signal.clause])
);

/** The clause one manual signal reads as; an unknown key de-camelises. */
export function manualSignalClause(key: string): string {
  return MANUAL_SIGNAL_CLAUSES.get(key) ?? toWords(key);
}

// ----------------------------------------------------------------------------
// Known facts.
//
// Indices are collapsed to `#`, so a per-candidate or per-role citation is
// phrased by its subject ("one leadership candidate") rather than pretending the
// reader knows which row index 3 was.
// ----------------------------------------------------------------------------

/**
 * A phrase builder for one known fact path. Returns `null` when the value is
 * not the shape this fact expects (a count that is not a number, say), which
 * hands the citation to the generic fallback instead of printing nonsense.
 */
type FactPhrase = (value: string | null) => Phrase | null;

/** Build a phrase from a numeric value, or defer to the fallback. */
function numeric(phrase: (n: number) => Phrase): FactPhrase {
  return (value) => {
    const n = toNumber(value);
    return n === null ? null : phrase(n);
  };
}

/** Build a phrase from a boolean value, or defer to the fallback. */
function boolean(whenTrue: Phrase, whenFalse: Phrase): FactPhrase {
  return (value) => {
    const flag = toBoolean(value);
    if (flag === null) return null;
    return flag ? whenTrue : whenFalse;
  };
}

/** Build a phrase from a date value, or defer to the fallback. */
function date(phrase: (readable: string) => Phrase): FactPhrase {
  return (value) => {
    if (!value || !ISO_DATE_PATTERN.test(value)) return null;
    return phrase(toReadableDate(value));
  };
}

/**
 * The phrases themselves, written as a literal because that is how a table of
 * 40-odd paths stays readable. Nothing reads it directly — {@link FACT_PHRASES}
 * below is the lookup, and it is a `Map` for a reason.
 */
const FACT_PHRASE_TABLE: Record<string, FactPhrase> = {
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
  // The flat streak and its two levels (#471). The phrases report the STREAK;
  // which of "slowed" and "stalled" it earns is the rubric's call, not a phrase.
  "coreGroup.daysSinceLastNewCommitment": numeric((n) =>
    n === 0
      ? "a new committed adult today"
      : n === 1
        ? "1 day since your last new committed adult"
        : `${n} days since your last new committed adult`
  ),
  "coreGroup.slowedThresholdDays": numeric(
    (n) => `${n} days flat before momentum counts as slowed`
  ),
  "coreGroup.stalledThresholdDays": numeric(
    (n) => `${n} days flat before growth counts as stalled`
  ),
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
  // The two levels of a cadence slip (#486). Named separately so the judge
  // cites the one it is actually invoking rather than "the threshold".
  "visionMeetings.cadenceWatchDays": numeric(
    (n) => `${n} days without a vision meeting before it is worth noticing`
  ),
  "visionMeetings.cadenceDirectDays": numeric(
    (n) => `${n} days without a vision meeting before it needs saying plainly`
  ),
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
  // Measured ownership (#470). Every phrase here reports an ASSIGNMENT — none
  // of them says who is at fault, because the count does not know.
  "followUp.unownedCount": numeric((n) =>
    n === 1
      ? "1 follow-up with no clear owner"
      : `${n} follow-ups with no clear owner`
  ),
  "followUp.staleUnownedCount": numeric((n) =>
    n === 1
      ? "1 follow-up past the window with no clear owner"
      : `${n} follow-ups past the window with no clear owner`
  ),
  "followUp.distinctOwnerCount": numeric((n) =>
    n === 1
      ? "1 person owning follow-ups"
      : `${n} people owning follow-ups between them`
  ),
  "followUp.planterOwnedCount": numeric((n) =>
    count(n, "follow-up you own", "follow-ups you own")
  ),
  // Warmth (#486). A contact who just came to a vision meeting goes stale
  // faster than one who has been on the list since spring.
  "followUp.warmCount": numeric((n) =>
    n === 1
      ? "1 contact who came to a vision meeting recently"
      : `${n} contacts who came to a vision meeting recently`
  ),
  "followUp.staleWarmCount": numeric((n) =>
    n === 1
      ? "1 warm contact past the 7-day window"
      : `${n} warm contacts past the 7-day window`
  ),
  "followUp.seriouslyStaleWarmCount": numeric((n) =>
    n === 1
      ? "1 warm contact untouched for two weeks"
      : `${n} warm contacts untouched for two weeks`
  ),
  "followUp.staleColdCount": numeric((n) =>
    n === 1
      ? "1 colder contact past the follow-up window"
      : `${n} colder contacts past the follow-up window`
  ),
  "followUp.warmWindowDays": numeric(
    (n) => `a contact counts as warm for ${n} days after a vision meeting`
  ),
  "followUp.warmStaleThresholdDays": numeric(
    (n) => `a ${n}-day window for a warm contact`
  ),
  "followUp.isEmpty": boolean(
    "no open follow-ups",
    "open follow-ups on your list"
  ),

  // -- cohesion (CSF-4) ------------------------------------------------------
  // Every phrase here reports ATTENDANCE. None of them says why somebody is
  // absent, because the data does not know (#473).
  "cohesion.activeCommittedCount": numeric((n) =>
    count(n, "active committed member", "active committed members")
  ),
  "cohesion.disengagedCount": numeric((n) =>
    n === 1
      ? "1 committed member who has stopped attending"
      : `${n} committed members who have stopped attending`
  ),
  "cohesion.disengagedShare": (value) => {
    const share = toNumber(value);
    return share === null
      ? null
      : `${Math.round(share * 100)}% of your active committed members`;
  },
  "cohesion.disengagedIncludesLeader": boolean(
    "a ministry-team leader among them",
    "no ministry-team leader among them"
  ),
  "cohesion.disengagedShareThreshold": (value) => {
    const share = toNumber(value);
    return share === null
      ? null
      : `${Math.round(share * 100)}% of the active group as the level worth naming`;
  },
  "cohesion.disengagedMinimumCount": numeric(
    (n) => `never fewer than ${n} people, however small the plant`
  ),
  "cohesion.windowDays": numeric((n) => `a ${n}-day attendance window`),
  "cohesion.isEmpty": boolean(
    "no active committed members to read",
    "active committed members on record"
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
    perRow(
      MINISTRY_ROLES,
      (role, n) => `${n === 1 ? "a team" : "teams"} in place for ${role}`
    ),
    perRow(
      MINISTRY_ROLES,
      (role, n) => `${n === 1 ? "no team" : "no teams"} yet for ${role}`
    )
  ),
  "ministryRoles.roles.#.filled": boolean(
    perRow(
      MINISTRY_ROLES,
      (role, n) => `${n === 1 ? "a leader" : "leaders"} in place for ${role}`
    ),
    perRow(
      MINISTRY_ROLES,
      (role, n) => `${n === 1 ? "no leader" : "no leaders"} yet for ${role}`
    )
  ),
  "ministryRoles.isEmpty": boolean(
    "no ministry teams set up yet",
    "ministry teams on record"
  ),

  // -- leadership (CSF-5) ----------------------------------------------------
  // Per-candidate facts stay anonymous: the snapshot's only person handle is a
  // UUID, which reads as noise and names an individual. Anonymous does not mean
  // uncounted — how MANY candidates back the insight is evidence the planter
  // needs, so these count rather than collapse.
  "leadership.candidates.#.personId": () => perRow(CANDIDATES, (who) => who),
  "leadership.candidates.#.status": (value) =>
    value
      ? perRow(CANDIDATES, (who) => `${who} at the ${toWords(value)} stage`)
      : null,
  "leadership.candidates.#.tenureDays": numeric((days) =>
    perRow(
      CANDIDATES,
      (who, n) =>
        `${who}${n === 1 ? "" : " each"} ${count(days, "day", "days")} in`
    )
  ),
  "leadership.candidates.#.meetingsAttended": numeric((meetings) =>
    perRow(
      CANDIDATES,
      (who, n) =>
        `${who}${n === 1 ? "" : " each"} at ${count(meetings, "vision meeting", "vision meetings")}`
    )
  ),
  "leadership.candidates.#.activeMemberships": numeric((teams) =>
    perRow(
      CANDIDATES,
      (who, n) =>
        `${who}${n === 1 ? "" : " each"} on ${count(teams, "ministry team", "ministry teams")}`
    )
  ),
  "leadership.candidates.#.hasCommitment": boolean(
    perRow(
      CANDIDATES,
      (who, n) =>
        `${who} with ${n === 1 ? "a signed commitment" : "signed commitments"}`
    ),
    perRow(
      CANDIDATES,
      (who, n) =>
        `${who} without ${n === 1 ? "a signed commitment" : "signed commitments"}`
    )
  ),
  "leadership.candidates.#.leadsTeam": boolean(
    perRow(
      CANDIDATES,
      (who, n) => `${who} already leading ${n === 1 ? "a team" : "teams"}`
    ),
    perRow(
      CANDIDATES,
      (who, n) => `${who} not yet leading ${n === 1 ? "a team" : "teams"}`
    )
  ),
  // The RECORDED HUMAN JUDGMENTS (#476). These read as what somebody wrote down,
  // never as a conclusion the engine reached: "an interview on record", not
  // "assessed as suitable". A candidate with none is a next step, not a mark.
  "leadership.candidates.#.interviewCount": numeric((n) =>
    n === 0
      ? perRow(CANDIDATES, (who) => `${who} with no interview on record`)
      : perRow(
          CANDIDATES,
          (who, rows) =>
            `${who}${rows === 1 ? "" : " each"} with ${count(n, "interview", "interviews")} on record`
        )
  ),
  "leadership.candidates.#.lastInterviewResult": (value) =>
    value
      ? perRow(
          CANDIDATES,
          (who) => `${who} whose last interview was recorded ${toWords(value)}`
        )
      : null,
  "leadership.candidates.#.lastInterviewDate": (value) =>
    value && ISO_DATE_PATTERN.test(value)
      ? perRow(
          CANDIDATES,
          (who) => `${who} interviewed on ${toReadableDate(value)}`
        )
      : null,
  "leadership.candidates.#.assessmentCount": numeric((n) =>
    n === 0
      ? perRow(CANDIDATES, (who) => `${who} with no 4 C's assessment on record`)
      : perRow(
          CANDIDATES,
          (who, rows) =>
            `${who}${rows === 1 ? "" : " each"} with ${count(n, "4 C's assessment", "4 C's assessments")} on record`
        )
  ),
  "leadership.candidates.#.lastAssessmentTotal": numeric((total) =>
    perRow(CANDIDATES, (who) => `${who} scoring ${total} on their last 4 C's`)
  ),
  "leadership.candidates.#.lastAssessmentDate": (value) =>
    value && ISO_DATE_PATTERN.test(value)
      ? perRow(
          CANDIDATES,
          (who) => `${who} assessed on ${toReadableDate(value)}`
        )
      : null,
  "leadership.candidateThresholdDays": numeric(
    (n) => `${n} days of attendance and serving before a candidate signal fires`
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
  //
  // The per-attestation LEAVES (`value`, `signalKey`, `attestedAt`) are NOT
  // here: they live in `attestation-citation.ts`, which answers all three
  // questions about a leaf (group identity, counting phrase, specific sentence)
  // from one row so a fourth leaf cannot be half-added. Only the block-level
  // fact belongs to this table.
  "manual.isEmpty": boolean(
    "nothing self-reported yet",
    "self-reports on record"
  ),
};

/**
 * One phrase per snapshot path — the lookup every caller uses.
 *
 * A `Map`, not the literal above, and that is load-bearing: the key is an
 * LLM-authored citation path (`plant_insights.cited_facts`), so indexing an
 * object with it reaches `Object.prototype`. A judge citing `constructor=4` or
 * `valueOf=1` pulled a native function out of the table and THREW inside
 * `formatCitedFact`/`formatCitedFacts` — a crashed `/phase`, since all three
 * render surfaces call them — while `toString=x` printed "[object Object]".
 * A `Map` has no prototype keys to reach, so rule 2 of `fact-format.ts` (an
 * unknown shape degrades, it never throws and never leaks syntax) holds by
 * construction instead of by a guard the next reader has to remember.
 */
export const FACT_PHRASES: ReadonlyMap<string, FactPhrase> = new Map(
  Object.entries(FACT_PHRASE_TABLE)
);
