// ============================================================================
// Exit-criteria progress with fact drill-down (PE-022 + PE-025).
//
// The composite verdict answers "how is the plant doing". It does not answer
// the question a planter in phase 2 actually asks: "what is left before I can
// move to phase 3?" Rubric-v0 Part B already names those gates per phase
// ("Readiness for 2->3: all 8 team leaders assigned, launch date set"); this
// module turns that prose into rows a planter can read one at a time, and lets
// each row be opened onto the facts underneath it.
//
// It is a PROJECTION of a persisted assessment, like the CSF scorecard next
// door in `queries.ts` — no DB and no LLM of its own. It shares that file's
// severity relabelling (`standingForSeverity`, `compareInsightUrgency`) and
// `snapshot-fact.ts`'s reader, so two projections of one assessment cannot end
// up with two vocabularies. Everything below leaves through `./index.ts`, which
// is what every caller outside this folder imports.
//
// TWO INDEPENDENT AXES, AND KEEPING THEM APART IS THE WHOLE POINT.
//
//   1. THE MEASUREMENT is deterministic and comes from the persisted
//      `fact_snapshot` — SQL-derived, reproducible, never a model output. Every
//      value rendered for a criterion is read out of that snapshot BY PATH:
//      `measure` is handed a lens, not the snapshot, and the lens records each
//      path it is asked for. So `measurement.facts` is not a claim that the
//      numbers came from the snapshot — it is the log of the reads that
//      produced them. A criterion the snapshot cannot speak to is
//      `not_tracked`, and one whose paths are missing from an older stored
//      snapshot is `unknown`. Neither is a failure.
//
//   2. THE STANDING is the judge's, and only the judge's — the severity it
//      assigned to an insight that spoke to this criterion, relabelled through
//      the same `standingForSeverity` the CSF scorecard uses. A criterion no
//      insight spoke to is `not_addressed`, which is deliberately NOT
//      `not_met`: the assessment saying nothing about a gate is not the
//      assessment failing it, and rendering silence as a red mark would be the
//      engine inventing a judgement it never made.
//
// WHICH gate a judgement lands on is decided by the paths it cited, and the
// snapshot spells some facts two ways — a manual attestation is written to both
// `manual.byKey.<signal>` and `manual.attestations[]`, and the judge may cite
// either. Citations are therefore normalised onto ONE spelling before they are
// matched (`normalizeManualCitation`), so the gate a planter sees a standing on
// does not depend on which of two equally legal forms the model happened to
// emit. The drill-down's WORDS are unified from the same reading — each
// citation carries the signal it resolved to (`CitedFactEvidence.signalKey`) —
// while the citation itself is still shown verbatim. Ruled 2026-08-10 on #319.
//
// A criterion can therefore read "met" with no standing at all (the snapshot
// clears the gate and the judge had nothing to add), or "not tracked" with a
// standing of "needs attention" (EveryField cannot measure it, the judge still
// raised it). Both are honest; a single blended score could express neither.
//
// THE DRILL-DOWN (PE-025) IS A VERIFICATION, NOT A QUOTE. The judge chooses
// WHICH fact backs its finding; it never supplies the value. So every citation
// is re-resolved against the persisted snapshot and the SNAPSHOT's value is
// what the UI shows (`snapshotValue`). `citedValue` is kept beside it only so a
// disagreement can be surfaced as a disagreement — the cited number is never
// the one presented as fact, and a path that is not in the snapshot at all is
// marked `inSnapshot: false` rather than rendered as evidence.
// ============================================================================

import type { InsightAudience, PlantInsight } from "@/db/schema";
import { formatDate } from "@/lib/datetime";
// The one parser for `launches.target_date`. That column is a DAY, not an
// instant, and memory/invariants/dates-times.md forbids round-tripping it
// through a bare `Date` — countdown.ts's header records the two releases that
// duplication already cost (#303, #338). This module reads the same day out of
// the fact snapshot, so it reads it through the same owner.
import { parseTargetDate } from "@/lib/launch/countdown";
// The citation parser, shared with the humanising formatter the UI renders
// through. One reader of `plant_insights.cited_facts` syntax, so the read layer
// and the surfaces above it can never disagree about where a path ends and a
// quoted value begins.
import {
  citedFactPath,
  dotIndices,
  parseCitedFact,
} from "@/lib/phase-engine/fact-format";
// The judge's severity, relabelled — the SAME relabelling and the SAME order the
// CSF scorecard reads its tiles through, so the two projections of one
// assessment cannot disagree about which finding is the headline.
import {
  compareInsightUrgency,
  standingForSeverity,
  type LatestAssessment,
} from "./queries";
import {
  attestationSignalKey,
  findSnapshotRowIndex,
  MANUAL_ATTESTATIONS_PREFIX,
  readSnapshotFact,
  type SnapshotFact,
} from "./snapshot-fact";

// ----------------------------------------------------------------------------
// The lens: the only door a criterion has onto the snapshot.
// ----------------------------------------------------------------------------

/**
 * The only way a criterion's `measure` may touch the snapshot.
 *
 * It reads by path and it records what it read, which is what makes
 * "every value is SQL-derived from the fact snapshot" a property of the code
 * rather than a promise in a comment: a measure cannot produce a number the
 * lens did not hand it, and the facts reported alongside the reading are the
 * lens's own log.
 */
interface FactLens {
  /** Read a path, recording it as evidence for the reading. */
  read(path: string): SnapshotFact;
  /**
   * Index of the row in the array at `arrayPath` whose `field` equals `value`
   * (e.g. the `worship` entry of `ministryRoles.roles`), or null. Deliberately
   * NOT recorded: it locates a row, the caller still has to read the fact.
   */
  rowIndex(arrayPath: string, field: string, value: string): number | null;
}

function factLens(snapshot: unknown): {
  lens: FactLens;
  facts: () => SnapshotFact[];
} {
  const readFacts = new Map<string, SnapshotFact>();

  const lens: FactLens = {
    read(path) {
      const fact = readSnapshotFact(snapshot, path);
      if (!readFacts.has(fact.path)) readFacts.set(fact.path, fact);
      return fact;
    },
    rowIndex(arrayPath, field, value) {
      return findSnapshotRowIndex(snapshot, arrayPath, field, value);
    },
  };

  return { lens, facts: () => [...readFacts.values()] };
}

// ----------------------------------------------------------------------------
// The criteria themselves — rubric-v0 Part B, as data.
// ----------------------------------------------------------------------------

/** What the deterministic snapshot says about a gate. Never a judgement. */
export const EXIT_CRITERION_MEASURE_STATUSES = [
  "met", // the snapshot clears the gate
  "not_met", // the snapshot is recorded and falls short
  "unknown", // the gate is measurable but this snapshot has no reading
  "not_tracked", // EveryField holds no deterministic signal for this gate
] as const;

export type ExitCriterionMeasureStatus =
  (typeof EXIT_CRITERION_MEASURE_STATUSES)[number];

/** A reading a `measure` may return — `not_tracked` is the absence of one. */
interface MeasuredReading {
  status: Exclude<ExitCriterionMeasureStatus, "not_tracked">;
  /** A sentence fragment naming the reading, built from the values read. */
  reading: string;
}

/** One phase gate: what it is, how it is measured, how the judge reaches it. */
export interface ExitCriterionDefinition {
  /** Stable key — a test hook and a React key, never shown to a planter. */
  key: string;
  /** Short name, sentence case. */
  label: string;
  /** One line on what clearing it means. */
  detail: string;
  /**
   * Snapshot paths that BELONG to this criterion. A judge citation at (or
   * under) one of them is a judgement about this gate — that is what makes the
   * standing per-criterion rather than per-phase. A prefix counts: an insight
   * citing `ministryRoles.roles.2.filled` speaks to `ministryRoles`.
   *
   * A manual gate declares only the `manual.byKey.<signal>` spelling. It does
   * not need the other one: `manual.attestations.N.…` citations are rewritten
   * onto it first (`normalizeManualCitation`), so one declared path catches both
   * legal ways of citing the same attestation.
   */
  factPaths: readonly string[];
  /**
   * Insight categories that reach this criterion — the fallback handle, used
   * ONLY by gates with no `factPaths`. A gate the snapshot measures is
   * addressed when the judge cited that measurement and not merely when it
   * talked about the neighbourhood; without that rule one launch remark would
   * be attributed to every launch gate in the phase at once. A gate the
   * snapshot cannot measure has no other handle, so its category is how the
   * judge is heard on it at all.
   */
  categories: readonly string[];
  /** Absent = `not_tracked`: EveryField has no deterministic signal for it. */
  measure?: (lens: FactLens) => MeasuredReading;
}

/** Committed adults the rubric wants before phase 1 -> 2 (rubric-v0 Part B). */
const CORE_GROUP_GATE = 30;

/** "3–4 weeks to launch" as the outer bound, in days (rubric-v0 Part B). */
const LAUNCH_WINDOW_DAYS = 28;

/** A self-attestation gate (PE-005): the planter's own yes/no is the reading. */
function attested(
  path: string,
  phrases: { met: string; notMet: string; unknown: string }
): (lens: FactLens) => MeasuredReading {
  return (lens) => {
    const fact = lens.read(path);
    if (fact.value === "true") return { status: "met", reading: phrases.met };
    if (fact.value === "false")
      return { status: "not_met", reading: phrases.notMet };
    return { status: "unknown", reading: phrases.unknown };
  };
}

/** Parse a fact's value as a number, or null when it is not one. */
function factNumber(fact: SnapshotFact): number | null {
  if (fact.value === null || fact.value.trim() === "") return null;
  const parsed = Number(fact.value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The exit criteria per phase, in the order a planter should read them.
 *
 * Keyed by the phase being LEFT. Phase 6 is deliberately absent: it is the
 * terminal phase and has no gate, which `buildExitCriteriaProgress` reports as
 * such rather than as an empty list of requirements.
 */
export const PHASE_EXIT_CRITERIA: Record<
  number,
  readonly ExitCriterionDefinition[]
> = {
  // Phase 0 · Discovery -> Core Group Development
  0: [
    {
      key: "values_documented",
      label: "Core values documented",
      detail: "Your foundations are written down, not just discussed.",
      factPaths: ["manual.byKey.values_documented"],
      categories: [],
      measure: attested("manual.byKey.values_documented", {
        met: "you confirmed your core values are documented",
        notMet: "you have not confirmed your core values are documented",
        unknown: "you have not answered this on the phase page yet",
      }),
    },
    {
      key: "foundations_complete",
      label: "Foundational modules complete",
      detail: "The Discovery reading and exercises are behind you.",
      factPaths: [],
      categories: ["onboarding"],
    },
    {
      key: "coach_assigned",
      label: "Coach assigned",
      detail: "A coach is walking with you before you start gathering.",
      factPaths: [],
      categories: ["onboarding"],
    },
  ],

  // Phase 1 · Core Group Development -> Launch Team Formation
  1: [
    {
      key: "committed_adults",
      label: `${CORE_GROUP_GATE} committed adults`,
      detail: `The rubric asks for ${CORE_GROUP_GATE}–40 committed adults before the launch team forms.`,
      factPaths: ["coreGroup"],
      categories: [],
      measure: (lens) => {
        const fact = lens.read("coreGroup.committedCount");
        const committed = factNumber(fact);
        if (committed === null) {
          return {
            status: "unknown",
            reading: "no committed core-group members recorded yet",
          };
        }
        return {
          status: committed >= CORE_GROUP_GATE ? "met" : "not_met",
          reading: `${committed} of ${CORE_GROUP_GATE} committed core-group members`,
        };
      },
    },
    {
      key: "financial_base",
      label: "Financial base in place",
      detail: "Giving and a first-year budget you can plant on.",
      factPaths: ["manual.byKey.financial_base_established"],
      categories: [],
      measure: attested("manual.byKey.financial_base_established", {
        met: "you confirmed your financial base is in place",
        notMet: "you have not confirmed your financial base is in place",
        unknown: "you have not answered this on the phase page yet",
      }),
    },
    {
      key: "worship_leader",
      label: "Worship leader identified",
      detail: "The first of the eight ministry roles has someone leading it.",
      factPaths: ["ministryRoles"],
      categories: [],
      measure: (lens) => {
        const index = lens.rowIndex("ministryRoles.roles", "key", "worship");
        if (index === null) {
          const empty = lens.read("ministryRoles.isEmpty");
          return {
            status: empty.present ? "not_met" : "unknown",
            reading: "no worship ministry team on record yet",
          };
        }
        const filled = lens.read(`ministryRoles.roles.${index}.filled`);
        if (filled.value === null) {
          return {
            status: "unknown",
            reading: "worship leadership not recorded",
          };
        }
        return filled.value === "true"
          ? { status: "met", reading: "a leader is assigned to worship" }
          : {
              status: "not_met",
              reading: "the worship team has no leader yet",
            };
      },
    },
    {
      key: "geographic_area",
      label: "Geographic area set",
      detail: "You know the ground you are planting on.",
      factPaths: [],
      categories: ["phase_progress"],
    },
  ],

  // Phase 2 · Launch Team Formation -> Training & Preparation
  2: [
    {
      key: "all_team_leaders",
      label: "All eight team leaders assigned",
      detail: "Every ministry role has a leader, not just a team.",
      factPaths: ["ministryRoles"],
      categories: [],
      measure: (lens) => {
        const filled = factNumber(lens.read("ministryRoles.filledCount"));
        const total = factNumber(lens.read("ministryRoles.totalRoles"));
        if (filled === null || total === null || total === 0) {
          return {
            status: "unknown",
            reading: "no ministry teams recorded yet",
          };
        }
        return {
          status: filled >= total ? "met" : "not_met",
          reading: `${filled} of ${total} ministry roles filled`,
        };
      },
    },
    {
      key: "launch_date_set",
      label: "Launch date set",
      detail: "A named day, so the countdown can drive the rest.",
      factPaths: ["launch.launchDate", "launch.isEmpty", "launch.status"],
      categories: [],
      measure: (lens) => {
        const fact = lens.read("launch.launchDate");
        if (!fact.present) {
          return {
            status: "unknown",
            reading: "this assessment recorded no launch information",
          };
        }
        if (fact.value === null) {
          return { status: "not_met", reading: "no launch date set yet" };
        }
        // A stored day, parsed at UTC midnight by its single owner; the guard
        // keeps a snapshot holding something that is not a day readable rather
        // than printing "Invalid Date".
        const parsed = parseTargetDate(fact.value);
        const readable = Number.isNaN(parsed.getTime())
          ? fact.value
          : formatDate(parsed, "long");
        return { status: "met", reading: `a launch date of ${readable}` };
      },
    },
  ],

  // Phase 3 · Training & Preparation -> Pre-Launch
  3: [
    {
      key: "training_complete",
      label: "Team training complete",
      detail: "Every required program finished across your committed people.",
      factPaths: ["training"],
      categories: [],
      measure: (lens) => {
        const rate = factNumber(lens.read("training.requiredCompletionRate"));
        if (rate === null) {
          return {
            status: "unknown",
            reading: "no required training programs set up yet",
          };
        }
        return {
          status: rate >= 1 ? "met" : "not_met",
          reading: `${Math.round(rate * 100)}% of required training complete`,
        };
      },
    },
    {
      key: "systems_tested",
      label: "Systems tested",
      detail: "Giving, check-in and the rest have been run for real.",
      factPaths: ["manual.byKey.systems_tested"],
      categories: [],
      measure: attested("manual.byKey.systems_tested", {
        met: "you confirmed your launch systems have been tested",
        notMet: "you have not confirmed your launch systems have been tested",
        unknown: "you have not answered this on the phase page yet",
      }),
    },
    {
      key: "launch_window",
      label: "Inside the final launch window",
      detail: `Pre-Launch is the last ${LAUNCH_WINDOW_DAYS} days before the day itself.`,
      factPaths: ["launch.daysUntilLaunch", "launch.isPastDue"],
      categories: [],
      measure: (lens) => {
        const days = factNumber(lens.read("launch.daysUntilLaunch"));
        if (days === null) {
          return { status: "unknown", reading: "no launch date set yet" };
        }
        if (days < 0) {
          const past = Math.abs(days);
          return {
            status: "met",
            reading:
              past === 1
                ? "1 day past your launch date"
                : `${past} days past your launch date`,
          };
        }
        return {
          status: days <= LAUNCH_WINDOW_DAYS ? "met" : "not_met",
          reading:
            days === 1 ? "1 day until launch" : `${days} days until launch`,
        };
      },
    },
  ],

  // Phase 4 · Pre-Launch -> Launch Sunday
  4: [
    {
      key: "readiness_milestones",
      label: "Launch readiness checklist complete",
      detail: "The Playbook milestones seeded when you set the date.",
      factPaths: [
        "launch.readinessCompletedCount",
        "launch.readinessTotalCount",
        "launch.readinessCompletionRate",
      ],
      categories: [],
      measure: (lens) => {
        const done = factNumber(lens.read("launch.readinessCompletedCount"));
        const total = factNumber(lens.read("launch.readinessTotalCount"));
        if (done === null || total === null || total === 0) {
          return {
            status: "unknown",
            reading: "no readiness milestones seeded for this launch",
          };
        }
        return {
          status: done >= total ? "met" : "not_met",
          reading: `${done} of ${total} readiness milestones complete`,
        };
      },
    },
    {
      key: "prelaunch_services",
      label: "Pre-launch services held",
      detail: "You have practised the whole service, front to back.",
      factPaths: [],
      categories: ["launch_readiness"],
    },
    {
      key: "promotion_executed",
      label: "Promotion executed",
      detail: "The invitation plan for launch day has been carried out.",
      factPaths: [],
      categories: ["launch_readiness"],
    },
  ],

  // Phase 5 · Launch Sunday -> Post-Launch
  5: [
    {
      key: "first_service_complete",
      label: "First service held",
      detail: "Launch day happened and you recorded it.",
      factPaths: ["launch.status", "launch.isCompleted"],
      categories: [],
      measure: (lens) => {
        const status = lens.read("launch.status");
        if (!status.present) {
          return {
            status: "unknown",
            reading: "this assessment recorded no launch status",
          };
        }
        if (status.value === "completed") {
          return { status: "met", reading: "your launch is recorded as held" };
        }
        return {
          status: "not_met",
          reading:
            status.value === null
              ? "no launch has been planned yet"
              : `your launch is ${status.value}`,
        };
      },
    },
    {
      key: "guest_data_entered",
      label: "Guest data entered",
      detail: "Who came on the day is in EveryField, not on paper.",
      factPaths: ["launch.attendanceCount", "launch.decisionsCount"],
      categories: [],
      measure: (lens) => {
        const attendance = lens.read("launch.attendanceCount");
        if (!attendance.present) {
          return {
            status: "unknown",
            reading: "this assessment recorded no launch-day attendance field",
          };
        }
        const counted = factNumber(attendance);
        if (counted === null) {
          return {
            status: "not_met",
            reading: "launch-day attendance has not been recorded",
          };
        }
        return {
          status: "met",
          reading:
            counted === 1
              ? "1 person recorded on launch day"
              : `${counted} people recorded on launch day`,
        };
      },
    },
    {
      key: "debrief_done",
      label: "Debrief done",
      detail: "The outcome of the day is written down.",
      factPaths: ["launch.outcomeRecorded"],
      categories: [],
      measure: (lens) => {
        const fact = lens.read("launch.outcomeRecorded");
        if (!fact.present) {
          return {
            status: "unknown",
            reading: "this assessment recorded no launch outcome field",
          };
        }
        return fact.value === "true"
          ? { status: "met", reading: "your launch outcome is recorded" }
          : { status: "not_met", reading: "no launch outcome recorded yet" };
      },
    },
  ],
};

// ----------------------------------------------------------------------------
// The judge's standing on a criterion.
// ----------------------------------------------------------------------------

/**
 * How the latest assessment reads a gate. The first four are relabelled judge
 * severities (`standingForSeverity`, shared with the CSF scorecard).
 * `not_addressed` is the fifth state and the one this requirement exists for:
 * the assessment said nothing about this gate, which is neither a pass nor a
 * fail and must never render as either.
 */
export const EXIT_CRITERION_STANDINGS = [
  "attention",
  "watch",
  "noted",
  "strength",
  "not_addressed",
] as const;

export type ExitCriterionStanding = (typeof EXIT_CRITERION_STANDINGS)[number];

/**
 * One citation from the judge, re-resolved against the persisted snapshot
 * (PE-025). `snapshotValue` is the value a surface may render; `citedValue` is
 * kept only so a disagreement can be shown as one.
 */
export interface CitedFactEvidence {
  /**
   * The MOST URGENT insight that cited this `path=value`, not the only one.
   * A criterion's evidence list is deduped by the citation itself (see
   * `buildExitCriteriaProgress` step 3), because two insights quoting the same
   * fact are one piece of evidence to a reader, not two. When several cited it,
   * the surviving row carries whichever insight sorted first under
   * `compareInsightUrgency` — so treat this as "one insight that cited it",
   * never as an exhaustive trace back to a single judgement.
   */
  insightId: string;
  /** The cited path, indices normalised to dots. */
  path: string;
  /**
   * The manual signal an `manual.attestations.N.…` citation names, resolved out
   * of this snapshot; `null` for every other citation and for a row that does
   * not resolve.
   *
   * It is carried so a surface can read the array spelling of an attestation in
   * the SAME words as the `manual.byKey.<signal>` spelling of it (ruled
   * 2026-08-10 on #319) — `formatCitedFact`'s `signalKey` context. It never
   * replaces `path`, which stays exactly as the judge wrote it: attribution and
   * wording are unified, the citation itself is still shown verbatim.
   */
  signalKey: string | null;
  /** What the assessment quoted, verbatim. `null` when it cited a bare key. */
  citedValue: string | null;
  /** What the persisted fact snapshot holds at that path. THE value to show. */
  snapshotValue: string | null;
  /** The path resolves inside the persisted snapshot. */
  inSnapshot: boolean;
  /**
   * The quoted value matches the snapshot. `true` when nothing was quoted (no
   * claim to disagree with); `false` whenever the path is not in the snapshot,
   * because an unverifiable citation has not been verified.
   */
  agrees: boolean;
}

/** One exit criterion, as the UI renders it. */
export interface ExitCriterionProgress extends Omit<
  ExitCriterionDefinition,
  "measure"
> {
  /** What the deterministic fact snapshot says about the gate. */
  measurement: ExitCriterionMeasureStatus;
  /** The reading in words, built from the values read; null when not tracked. */
  reading: string | null;
  /** The snapshot reads that produced `measurement`/`reading`. Empty if untracked. */
  facts: SnapshotFact[];
  /** The judge's standing, or `not_addressed`. */
  standing: ExitCriterionStanding;
  /** The insights that addressed this gate, most urgent first. */
  insights: PlantInsight[];
  /** Their citations, verified against the snapshot (PE-025). */
  evidence: CitedFactEvidence[];
}

/** The current phase's gates, plus the identity of the snapshot behind them. */
export interface ExitCriteriaProgress {
  assessmentId: string;
  generatedAt: Date;
  rubricVersion: string;
  /** The phase these gates lead OUT of — the assessment's own phase. */
  phase: number;
  /** The phase they lead into; null at the terminal phase. */
  nextPhase: number | null;
  /** Which audience's insights the standings were built from. */
  audience: InsightAudience;
  /** True at the terminal phase, where `criteria` is empty BY DEFINITION. */
  isTerminalPhase: boolean;
  criteria: ExitCriterionProgress[];
  /** How many the snapshot measures as cleared. */
  metCount: number;
  /** How many the snapshot measures at all (`met` + `not_met`). */
  measuredCount: number;
  /** How many the assessment spoke to. */
  addressedCount: number;
}

/** Does a citation belong to this criterion? Prefix match on the fact path. */
function citationMatchesPath(citedPath: string, factPath: string): boolean {
  return citedPath === factPath || citedPath.startsWith(`${factPath}.`);
}

/**
 * Rewrite an `manual.attestations.N.…` citation onto the `manual.byKey.<signal>`
 * form the attested criteria declare, by resolving entry N's `signalKey` in the
 * snapshot the insight was made against (ruled 2026-08-10 on #319).
 *
 * ATTRIBUTION ONLY. This normalisation exists so the standing column names the
 * criterion the judge actually spoke to; it never touches the drill-down, where
 * `buildEvidence` still resolves the citation EXACTLY as the judge wrote it. The
 * planter therefore reads the real citation and its real snapshot value, while
 * the row it lands on is decided by which signal it names. The WORDS that
 * citation is read in are unified separately, and non-destructively: the
 * resolved signal rides along on `CitedFactEvidence.signalKey` so the drill-down
 * can phrase both spellings alike without either path being rewritten.
 *
 * Why by signal and not by widening the criteria to the `manual` prefix: the
 * three attested gates each measure ONE signal, so a prefix rule would light all
 * three up for a citation of any manual signal at all — telling a planter the
 * engine addressed their financial base because it mentioned something else.
 * Resolving the row gives full recall with no precision lost.
 *
 * Returns `null` when the citation names no resolvable entry. An unresolvable
 * citation attributes to NOTHING rather than guessing a gate; the criterion then
 * reads `not_addressed`, which is the honest answer.
 */
function normalizeManualCitation(
  citedPath: string,
  snapshot: unknown
): string | null {
  if (!citedPath.startsWith(MANUAL_ATTESTATIONS_PREFIX)) return citedPath;

  const key = attestationSignalKey(citedPath, snapshot);
  return key === null ? null : `manual.byKey.${key}`;
}

/**
 * The cited paths of one insight, normalised for ATTRIBUTION; tolerates a
 * malformed column. `snapshot` is the assessment's own fact snapshot — the one
 * the judge cited — because resolving an attestation row to its signal is a read
 * of that snapshot, not a syntax rule.
 *
 * The path is taken through `citedFactPath`, the same function
 * {@link resolveCitedFactSignals} keys its map under and the formatter looks it
 * up under: attribution and wording are two halves of one ruling, so they must
 * not hold two ideas of what a citation's path is.
 */
function citedPathsOf(insight: PlantInsight, snapshot: unknown): string[] {
  const facts = insight.citedFacts;
  if (!Array.isArray(facts)) return [];
  return facts
    .filter((fact): fact is string => typeof fact === "string")
    .map(citedFactPath)
    .filter((path) => path.length > 0)
    .map((path) => normalizeManualCitation(path, snapshot))
    .filter((path): path is string => path !== null);
}

/**
 * Does this insight address this criterion? Fact paths where the criterion has
 * them, category only where it has none — see `ExitCriterionDefinition`.
 */
function addressesCriterion(
  insight: PlantInsight,
  definition: ExitCriterionDefinition,
  citedPaths: string[]
): boolean {
  if (definition.factPaths.length > 0) {
    return definition.factPaths.some((factPath) =>
      citedPaths.some((cited) => citationMatchesPath(cited, factPath))
    );
  }
  return definition.categories.includes(insight.category);
}

/** Numbers compare as numbers; everything else as trimmed, case-folded text. */
function valuesAgree(cited: string, stored: string): boolean {
  const citedNumber = Number(cited);
  const storedNumber = Number(stored);
  if (
    cited.trim() !== "" &&
    stored.trim() !== "" &&
    Number.isFinite(citedNumber) &&
    Number.isFinite(storedNumber)
  ) {
    return citedNumber === storedNumber;
  }
  return cited.trim().toLowerCase() === stored.trim().toLowerCase();
}

/** Resolve one insight's citations against the snapshot, in cited order. */
function buildEvidence(
  insight: PlantInsight,
  snapshot: unknown
): CitedFactEvidence[] {
  const facts = insight.citedFacts;
  if (!Array.isArray(facts)) return [];

  const evidence: CitedFactEvidence[] = [];
  for (const raw of facts) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const { path, value } = parseCitedFact(raw);
    const normalized = dotIndices(path);
    if (normalized.length === 0) continue;

    const stored = readSnapshotFact(snapshot, normalized);
    evidence.push({
      insightId: insight.id,
      path: normalized,
      signalKey: attestationSignalKey(normalized, snapshot),
      citedValue: value,
      snapshotValue: stored.value,
      inSnapshot: stored.present,
      agrees:
        value === null
          ? true
          : stored.present &&
            stored.value !== null &&
            valuesAgree(value, stored.value),
    });
  }
  return evidence;
}

/**
 * Project a persisted assessment onto the current phase's exit criteria
 * (PE-022 + PE-025).
 *
 * Pure — no DB, no LLM, no recomputation of anything the judge decided and no
 * fact that is not already in the stored snapshot. Returns `null` when the
 * plant has never completed an assessment, which the UI must render as a
 * cold-start state: a list of unmet gates would claim the engine looked, and it
 * has not.
 *
 * The phase is the ASSESSMENT's phase, not the church row's. The whole card is
 * a reading of one snapshot, and quietly re-pointing it at a phase that
 * snapshot never evaluated would put the judge's standings against gates it
 * never saw. A planter who has advanced since sees the gates as of the last
 * assessment, dated by `generatedAt`, until the next one runs.
 *
 * @param latest   the latest COMPLETE snapshot + its insights, or null
 * @param audience which audience's insights the standings come from. Callers
 *                 passing `"network"` must hand in an already privacy-gated
 *                 payload (see {@link buildCsfScorecard}).
 */
export function buildExitCriteriaProgress(
  latest: LatestAssessment | null,
  audience: InsightAudience = "planter"
): ExitCriteriaProgress | null {
  if (!latest) return null;

  const { assessment } = latest;
  const snapshot = assessment.factSnapshot;
  const definitions = PHASE_EXIT_CRITERIA[assessment.phase];
  const isTerminalPhase = definitions === undefined;

  const audienceInsights = latest.insights.filter(
    (insight) => insight.audience === audience
  );
  const citedPathsByInsight = new Map<string, string[]>(
    audienceInsights.map((insight) => [
      insight.id,
      citedPathsOf(insight, snapshot),
    ])
  );

  const criteria = (definitions ?? []).map((definition) => {
    // 1. The deterministic reading. The lens is the only door to the snapshot,
    //    and `facts` is its log — so nothing here can be a value the snapshot
    //    did not supply.
    const { measure, ...presentable } = definition;
    const { lens, facts } = factLens(snapshot);
    const measured = measure?.(lens) ?? null;

    // 2. The judge's standing, over the insights that addressed this gate.
    const insights = audienceInsights
      .filter((insight) =>
        addressesCriterion(
          insight,
          definition,
          citedPathsByInsight.get(insight.id) ?? []
        )
      )
      .sort(compareInsightUrgency);

    // 3. The drill-down: every citation, verified against the same snapshot.
    //    Deduped on the CITATION (`path=value`) and deliberately not on the
    //    insight: the same fact quoted by two insights is one piece of evidence
    //    to the planter reading the row. `insights` above already runs most
    //    urgent first, so the row that survives carries the most urgent citer —
    //    see `CitedFactEvidence.insightId` for what that field does and does
    //    not promise.
    const evidence: CitedFactEvidence[] = [];
    const seen = new Set<string>();
    for (const insight of insights) {
      for (const item of buildEvidence(insight, snapshot)) {
        const identity = `${item.path}=${item.citedValue ?? ""}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        evidence.push(item);
      }
    }

    return {
      ...presentable,
      measurement: measured?.status ?? "not_tracked",
      reading: measured?.reading ?? null,
      facts: measured ? facts() : [],
      standing: insights[0]
        ? standingForSeverity(insights[0].severity)
        : ("not_addressed" as const),
      insights,
      evidence,
    } satisfies ExitCriterionProgress;
  });

  return {
    assessmentId: assessment.id,
    generatedAt: assessment.generatedAt,
    rubricVersion: assessment.rubricVersion,
    phase: assessment.phase,
    nextPhase: isTerminalPhase ? null : assessment.phase + 1,
    audience,
    isTerminalPhase,
    criteria,
    metCount: criteria.filter((c) => c.measurement === "met").length,
    measuredCount: criteria.filter(
      (c) => c.measurement === "met" || c.measurement === "not_met"
    ).length,
    addressedCount: criteria.filter((c) => c.standing !== "not_addressed")
      .length,
  };
}
