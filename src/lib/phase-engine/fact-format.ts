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
// planter reads. All THREE surfaces that render citations — the CSF scorecard
// tiles, the Focus insight cards and the exit-criteria drill-down — go through
// it, so the fix lands once rather than per-surface. All three sit on `/phase`
// at once, which is why one citation must read as one sentence across them
// (ruled 2026-08-12 on #319; see `CitedFactSignals`).
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
//    HOW MANY rows agreed is evidence too: an insight backed by three
//    candidates says "3 leadership candidates", never "one".
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
 * Unify the two index spellings without discarding which row was cited:
 * `roles[0].filled` and `roles.0.filled` are the same path.
 *
 * Exported because the read layer walks stored snapshots by the same dotted
 * path this module keys citations under (`assessment/queries.ts`), and two
 * copies of one three-character regex are two things that can drift.
 */
export function dotIndices(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1");
}

/**
 * Collapse array indices so `leadership.candidates[0].personId` and
 * `leadership.candidates.3.personId` reach the same template. Both spellings
 * occur in stored data (the ledger emits dotted indices; the model sometimes
 * echoes bracketed ones).
 */
function normalizePath(path: string): string {
  return dotIndices(path)
    .split(".")
    .map((segment) => (/^\d+$/.test(segment) ? "#" : segment))
    .filter((segment) => segment.length > 0)
    .join(".");
}

/**
 * How one citation is identified when de-duplicating a column. The row index
 * is KEPT — unlike `normalizePath`, which collapses it to reach a template —
 * because the two questions are different: `candidates.0` and `candidates.1`
 * share a template but are two candidates, while the same citation written
 * twice is one candidate. Counting (see `formatCitedFacts`) depends on telling
 * those apart.
 */
function citationIdentity(fact: string): string {
  const { path, value } = parseCitedFact(fact);
  return `${dotIndices(path)}=${value ?? ""}`;
}

/**
 * The dotted path of a citation: its asserted value stripped, both index
 * spellings unified, the row index KEPT.
 *
 * Exported because it is the KEY a {@link CitedFactSignals} map is built under
 * in the read layer and read under here. One function for both sides, so the
 * projection that resolves `manual.attestations.1.value` and the formatter that
 * looks it up cannot disagree about what that citation is called.
 */
export function citedFactPath(fact: string): string {
  return dotIndices(parseCitedFact(fact).path);
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
// are collapsed to `#`, so a per-candidate or per-role citation is phrased by
// its subject ("one leadership candidate") rather than pretending the reader
// knows which row index 3 was.
//
// A fact that names an anonymous ROW returns a `RowPhrase` instead of a plain
// string. The phrase is then a function of how many rows cited the same thing,
// so an insight backed by three candidates reads "3 leadership candidates" and
// not "one leadership candidate" — the count is evidence, and dropping it
// understates the insight (ruling on #154).
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
 * A phrase about an anonymous row, deferred until we know how many rows cited
 * it. `render(1)` is the singular a lone citation reads as.
 */
interface RowPhrase {
  render: (rows: number) => string;
}

/** What a fact renders as: fixed prose, or prose that counts its rows. */
type Phrase = string | RowPhrase;

/** How a row's subject is named at a given count. */
type RowSubject = (rows: number) => string;

const CANDIDATES: RowSubject = (n) =>
  n === 1 ? "one leadership candidate" : `${n} leadership candidates`;

const MINISTRY_ROLES: RowSubject = (n) =>
  n === 1 ? "one ministry role" : `${n} ministry roles`;

const SELF_REPORTS: RowSubject = (n) =>
  n === 1 ? "a self-report" : `${n} self-reports`;

/** The subject of an attestation's own value, which is a thing, not a report. */
const ATTESTED_THINGS: RowSubject = (n) =>
  n === 1 ? "something" : `${n} things`;

/**
 * Build a row phrase from its subject and one template. The template receives
 * the subject already named for the count plus the count itself, so a plural
 * that needs more than an `s` ("3 leadership candidates EACH 90 days in") stays
 * a single template rather than two copies that can drift apart.
 */
function perRow(
  subject: RowSubject,
  template: (subject: string, rows: number) => string
): RowPhrase {
  return { render: (rows) => template(subject(rows), rows) };
}

/** Render a phrase for a known number of rows. Plain prose ignores the count. */
function renderPhrase(phrase: Phrase, rows: number): string {
  return typeof phrase === "string" ? phrase : phrase.render(rows);
}

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
    value
      ? perRow(SELF_REPORTS, (report) => `${report} about ${toWords(value)}`)
      : null,
  "manual.attestations.#.value": (value) => {
    const flag = toBoolean(value);
    if (flag === null) {
      return value
        ? perRow(SELF_REPORTS, (report) => `${report} of ${toWords(value)}`)
        : null;
    }
    return perRow(ATTESTED_THINGS, (thing) =>
      flag ? `${thing} you confirmed` : `${thing} you have not confirmed`
    );
  },
  "manual.attestations.#.attestedAt": date((d) =>
    perRow(SELF_REPORTS, (report) => `${report} from ${d}`)
  ),
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
  const signalKey = manualByKeySignal(normalized);
  return signalKey === null ? null : signalPhrase(signalKey, value);
}

/** The keyed spelling of an attestation: the signal is IN the path. */
const MANUAL_BY_KEY_PREFIX = "manual.byKey.";

/** The signal a `manual.byKey.<signal>` citation names, or null for any other path. */
function manualByKeySignal(normalized: string): string | null {
  if (!normalized.startsWith(MANUAL_BY_KEY_PREFIX)) return null;
  const signalKey = normalized.slice(MANUAL_BY_KEY_PREFIX.length);
  return signalKey.length > 0 ? signalKey : null;
}

/** What a citation of one manual signal reads as, keyed or not. */
function signalPhrase(signalKey: string, value: string | null): string {
  const clause = manualSignalClause(signalKey);
  const flag = toBoolean(value);
  if (flag === true) return `you confirmed ${clause}`;
  if (flag === false) return `you have not confirmed ${clause}`;
  return value ? `${clause}, reported as ${toWords(value)}` : clause;
}

/** The array spelling of the same attestation, with indices collapsed. */
const MANUAL_ATTESTATION_PREFIX = "manual.attestations.#.";

/**
 * The SAME attestation, cited the other legal way.
 *
 * The fact snapshot writes every manual attestation twice —
 * `manual.byKey.<signal>` and `manual.attestations[]` — and the judge's citable
 * ledger is the whole flattened snapshot, so both spellings are legal citations
 * of one fact (assessment/queries.ts, `normalizeManualCitation`). Attribution
 * already resolves the row to its signal so the two spellings land on the same
 * exit criterion; this is the wording half of that ruling (2026-08-10, #319):
 * having landed on the same gate, they must also READ the same. "something you
 * confirmed" beside "you confirmed your financial base is in place" is the same
 * evidence told twice, once vaguely, and the vague one is the one that makes a
 * planter doubt the specific one.
 *
 * `signalKey` is resolved by the caller against the assessment's own snapshot,
 * because which signal row N holds is a READ of that snapshot, not a syntax
 * rule this pure module could work out. Without it — an unresolvable row, or a
 * surface that has no snapshot to hand — the citation keeps the generic
 * self-report phrasing from `FACT_PHRASES` rather than guessing a signal.
 *
 * The citation itself is untouched: only the words change, never the path a
 * surface shows or the value it reads back (see `CitedFactEvidence.path`).
 */
function manualAttestationPhrase(
  normalized: string,
  value: string | null,
  signalKey: string | null | undefined
): string | null {
  if (!normalized.startsWith(MANUAL_ATTESTATION_PREFIX)) return null;

  const key = signalKey?.trim();
  if (!key) return null;

  switch (normalized.slice(MANUAL_ATTESTATION_PREFIX.length)) {
    // `…value` asserts the attestation — exactly what the keyed spelling
    // asserts, so it is exactly the sentence the keyed spelling reads as.
    case "value":
      return signalPhrase(key, value);
    // `…signalKey` names the fact and asserts nothing about it, which is what a
    // bare `manual.byKey.<signal>` citation does.
    case "signalKey":
      return signalPhrase(key, null);
    // `…attestedAt` carries WHEN, which the keyed spelling has no path for. Name
    // the signal in the same words and keep the date — dropping it would lose
    // evidence (rule 1) to buy a uniformity nothing asked for.
    case "attestedAt":
      return value && ISO_DATE_PATTERN.test(value)
        ? `${manualSignalClause(key)}, self-reported on ${toReadableDate(value)}`
        : null;
    default:
      return null;
  }
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
 * What the caller knows about a citation that this module cannot work out for
 * itself, because knowing it means reading the snapshot the citation was made
 * against.
 */
export interface CitedFactContext {
  /**
   * The manual signal an `manual.attestations.N.…` citation names, resolved out
   * of that snapshot (assessment/queries.ts). Supplying it makes the array
   * spelling read as the SAME sentence as `manual.byKey.<signal>`; omitting it
   * (or passing null, for a row that does not resolve) keeps the generic
   * self-report phrasing. Ignored for every other path.
   */
  signalKey?: string | null;
}

/**
 * The same knowledge for a WHOLE cited-facts column: the signal each citation
 * resolved to, keyed by that citation's {@link citedFactPath}.
 *
 * The insight card and the CSF scorecard render a column at a time and hold no
 * snapshot of their own, so the read layer that builds their projection resolves
 * the signals and hands the map down (ruled 2026-08-12 on #319 —
 * `AssessedInsight.citedFactSignals`). A path with no entry, or an entry of
 * `null`, is a citation that did not resolve; nothing is guessed for it.
 */
export type CitedFactSignals = Readonly<Record<string, string | null>>;

/** Resolve one citation to its phrase, or `null` when there is nothing to say. */
function buildPhrase(fact: unknown, context?: CitedFactContext): Phrase | null {
  if (typeof fact !== "string" || fact.trim() === "") return null;

  const { path, value } = parseCitedFact(fact);
  const normalized = normalizePath(path);

  // The resolved attestation wins over the anonymous row template above: it is
  // the same fact said precisely, and it is only reachable when the caller has
  // resolved the row against the snapshot.
  const known =
    manualAttestationPhrase(normalized, value, context?.signalKey) ??
    FACT_PHRASES[normalized]?.(value) ??
    manualByKeyPhrase(normalized, value);
  if (known) return known;

  const label = fallbackLabel(normalized);
  const readable = fallbackValue(value);
  return readable ? `${label}: ${readable}` : label;
}

/**
 * Turn one stored citation into a phrase a planter reads.
 *
 * Never throws and never returns ledger syntax: an unrecognised path degrades
 * to a de-camelised label plus a humanised value. Returns `""` only for an
 * empty input, which `formatCitedFacts` drops. A row fact renders as its
 * singular here — one citation is one row; counting is `formatCitedFacts`'
 * job, because only the whole column knows how many rows agreed.
 *
 * `context` carries what only the caller can know (see `CitedFactContext`); a
 * caller with no snapshot to hand omits it and every path still renders.
 */
export function formatCitedFact(
  fact: string,
  context?: CitedFactContext
): string {
  const phrase = buildPhrase(fact, context);
  return phrase === null ? "" : renderPhrase(phrase, 1);
}

/**
 * One attestation citation reduced to what folding a column needs, with the
 * spelling thrown away.
 *
 * Both legal spellings are mapped onto the ARRAY form's templates on purpose:
 * that is what puts `manual.byKey.<signal>` and `manual.attestations[N].value`
 * in ONE group, so how many attestations were cited — not which of two legal
 * spellings the model picked — decides whether the column names them or counts
 * them. Returns `null` for any citation that is not an attestation.
 */
interface AttestationCitation {
  /** The COUNTING phrase: signal-independent, so both spellings share a group. */
  counting: Phrase;
  /** What this citation reads as when it is the only one; null if unresolved. */
  specific: string | null;
  /**
   * The thing counted. The SIGNAL when it is known, so one attestation cited
   * twice — once each way — is one thing, never two.
   */
  member: string;
}

function attestationCitation(
  fact: string,
  signals: CitedFactSignals | undefined
): AttestationCitation | null {
  const { path, value } = parseCitedFact(fact);
  const normalized = normalizePath(path);

  let leaf: string;
  let signal: string | null;
  let asserted: string | null;

  const keyedSignal = manualByKeySignal(normalized);
  if (normalized.startsWith(MANUAL_ATTESTATION_PREFIX)) {
    leaf = normalized.slice(MANUAL_ATTESTATION_PREFIX.length);
    // Only the read layer can say which signal row N holds (see below).
    signal = signals?.[citedFactPath(fact)] ?? null;
    asserted = value;
  } else if (keyedSignal !== null) {
    signal = keyedSignal;
    // A keyed citation WITH a value asserts the attestation, exactly as
    // `…attestations.N.value` does; a bare one only names it, as `…signalKey`
    // does. The signal is in the path, so it never needs the map.
    leaf = value === null ? "signalKey" : "value";
    asserted = value === null ? keyedSignal : value;
  } else {
    return null;
  }

  const template = `${MANUAL_ATTESTATION_PREFIX}${leaf}`;
  const counting = FACT_PHRASES[template]?.(asserted) ?? null;
  if (counting === null) return null;

  return {
    counting,
    // The SAME call `buildPhrase` makes for `formatCitedFact(fact, { signalKey
    // })`, which is what makes "the plural formatter says what the drill-down
    // says" true by construction rather than by two templates kept in step.
    specific:
      signal === null
        ? null
        : manualAttestationPhrase(template, asserted, signal),
    member:
      signal === null
        ? `citation:${citationIdentity(fact)}`
        : `signal:${signal}`,
  };
}

/** One phrase's group while a column is being folded. */
interface CitedFactGroup {
  /** The COUNTING phrase — the group's identity and its rendering at N rows. */
  phrase: Phrase;
  /** The DISTINCT things cited: one attestation is one, however it is spelled. */
  members: Set<string>;
  /** The sentences resolved members read as; empty when none resolved. */
  specifics: Set<string>;
}

/**
 * Humanise a whole `cited_facts` column.
 *
 * Takes `unknown` because the column is `jsonb`: both render surfaces would
 * otherwise repeat the same cast, and a malformed row must degrade to "no
 * citations" rather than crash the page.
 *
 * Several per-row citations legitimately humanise to the same phrase, and
 * "one leadership candidate, one leadership candidate" reads as a bug. They
 * are therefore grouped — but a group of anonymous rows becomes a COUNT, not a
 * single row: three candidates cited render "3 leadership candidates". The
 * earlier collapse said "one", which understated the very evidence the
 * citation exists to carry (ruling on #154).
 *
 * Two de-duplications are at work and they are not the same:
 *
 *   - the SAME citation written twice is one row (`citationIdentity` keeps the
 *     index, so `candidates.0` twice counts once);
 *   - DIFFERENT rows that read alike are one phrase carrying a count
 *     (`candidates.0.tenureDays=90` and `candidates.1.tenureDays=90` are two).
 *
 * Phrases with a fixed subject — including ones that name their row, like a
 * ministry role's own label — carry no count and simply group.
 *
 * ---------------------------------------------------------------------------
 * `signals` — one voice for one citation (ruled 2026-08-12 on #319)
 * ---------------------------------------------------------------------------
 *
 * An attestation is citable two legal ways (`manual.byKey.<signal>` and
 * `manual.attestations[N]`), and until this ruling the singular formatter spoke
 * the specific sentence for both while THIS one still said "something you
 * confirmed" for the array spelling. Both live on `/phase` — the drill-down
 * beside the insight card and the scorecard — so one planter could read the
 * same fact told two ways in one screenful, decided by a spelling the model
 * happened to pick.
 *
 * Supplying `signals` closes that, and the shape of the fix is the ruling:
 *
 *   - ONE distinct attestation in a group reads the drill-down's own sentence;
 *   - MORE THAN ONE — two DIFFERENT signals, or one that resolved beside one
 *     that did not — collapses to the count ("3 things you confirmed"). THIS
 *     PATH IS A COUNTER AND NEVER BECOMES A LISTER: naming them all here would
 *     turn a chip that says how much evidence there is into a second copy of
 *     the drill-down.
 *
 * The rule is keyed on the SIGNAL, not on the rendered phrase, and that is what
 * makes it spelling-independent — the property the ruling is actually about.
 * Both spellings of one attestation are ONE member of ONE group, so:
 *
 *   - two attestations count the same whether they were cited by key or by row
 *     (keying on the phrase counted the array pair and listed the keyed pair);
 *   - an attestation cited BOTH ways beside another one counts as two things,
 *     not as one named sentence beside a count that silently included it again.
 */
export function formatCitedFacts(
  citedFacts: unknown,
  signals?: CitedFactSignals
): string[] {
  if (!Array.isArray(citedFacts)) return [];

  const groups = new Map<string, CitedFactGroup>();

  for (const fact of citedFacts) {
    if (typeof fact !== "string" || fact.trim() === "") continue;

    // An attestation is folded by signal; everything else by its own citation.
    const attestation = attestationCitation(fact, signals);
    const phrase = attestation ? attestation.counting : buildPhrase(fact);
    if (phrase === null) continue;

    // Group on the counting phrase rendered singular: it is the phrase's
    // identity, independent of how many rows end up in the group.
    const key = renderPhrase(phrase, 1);
    let group = groups.get(key);
    if (!group) {
      group = { phrase, members: new Set(), specifics: new Set() };
      groups.set(key, group);
    }
    group.members.add(attestation?.member ?? citationIdentity(fact));
    if (attestation?.specific) group.specifics.add(attestation.specific);
  }

  return Array.from(groups.values(), ({ phrase, members, specifics }) => {
    const [only] = specifics;
    return members.size === 1 && specifics.size === 1
      ? only
      : renderPhrase(phrase, members.size);
  });
}
