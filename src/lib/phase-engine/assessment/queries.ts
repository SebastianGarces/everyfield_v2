// ============================================================================
// Assessment read queries (PE-010 / PE-011).
//
// The DB-backed reads behind the orchestrator:
//   - `getLatestAssessment` — the latest COMPLETE snapshot for instant reads,
//     with its insights, NO LLM call (PE-011). Drives every planter/oversight UI.
//   - `getLatestCompleteSnapshot` — just the prior complete `factSnapshot`, used
//     to compute the what-changed delta (PE-016).
//   - `selectPlantsForAssessment` — resolves dirty-or-stale plants (AC-PE-8) by
//     joining each church's `lastMaterialEventAt` against its latest complete
//     assessment's `generatedAt`, then applying the pure selection logic.
//   - `buildCsfScorecard` / `getCsfScorecard` — the 8-factor CSF scorecard
//     (PE-023), a pure PROJECTION of a snapshot that has already been read. It
//     computes nothing of its own: every standing is the severity the judge
//     assigned to an insight in that persisted assessment. `getCsfScorecard` is
//     the DB-backed convenience wrapper and has no runtime caller by design —
//     it is the landing-page fixture's regeneration step. Read its docblock
//     before deleting it.
//   - `buildExitCriteriaProgress` — the current phase's exit criteria, one row
//     each, with the deterministic reading from the fact snapshot and the
//     judge's standing on it (PE-022), plus the citations resolved back against
//     that same snapshot for the drill-down (PE-025). Also a pure projection.
// ============================================================================

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  plantAssessments,
  plantInsights,
  type InsightAudience,
  type InsightSeverity,
  type PlantAssessment,
  type PlantInsight,
} from "@/db/schema";
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
import { parseCitedFact } from "@/lib/phase-engine/fact-format";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";
import {
  filterDirtyOrStale,
  MAX_STALENESS_MS,
  orderByAssessmentAge,
  type PlantSelectionInput,
  type SelectionReason,
  selectionReasonFor,
} from "./dirty";

/** A complete assessment snapshot plus its insights — the instant-read payload. */
export interface LatestAssessment {
  assessment: PlantAssessment;
  insights: PlantInsight[];
}

/**
 * The latest COMPLETE assessment for a church with its insights, ordered by
 * rank (PE-011). Returns null when the plant has never completed an assessment.
 * No LLM call — pure read.
 */
export async function getLatestAssessment(
  churchId: string
): Promise<LatestAssessment | null> {
  const [assessment] = await db
    .select()
    .from(plantAssessments)
    .where(
      and(
        eq(plantAssessments.churchId, churchId),
        eq(plantAssessments.status, "complete")
      )
    )
    .orderBy(desc(plantAssessments.generatedAt))
    .limit(1);

  if (!assessment) return null;

  const insights = await db
    .select()
    .from(plantInsights)
    .where(eq(plantInsights.assessmentId, assessment.id))
    .orderBy(plantInsights.rank);

  return { assessment, insights };
}

/**
 * The `factSnapshot` of the latest COMPLETE assessment for a church, typed as a
 * {@link PlantFactSnapshot}, or null if none. Used to compute the what-changed
 * delta against the new snapshot (PE-016).
 */
export async function getLatestCompleteSnapshot(
  churchId: string
): Promise<PlantFactSnapshot | null> {
  const [row] = await db
    .select({ factSnapshot: plantAssessments.factSnapshot })
    .from(plantAssessments)
    .where(
      and(
        eq(plantAssessments.churchId, churchId),
        eq(plantAssessments.status, "complete")
      )
    )
    .orderBy(desc(plantAssessments.generatedAt))
    .limit(1);

  return row ? (row.factSnapshot as PlantFactSnapshot) : null;
}

/** A church flagged for re-assessment, with the reason it was selected. */
export interface SelectedPlant {
  churchId: string;
  reason: SelectionReason;
}

/**
 * Resolve which plants are dirty-or-stale and should be (re-)assessed (AC-PE-8).
 *
 * Reads each church's `lastMaterialEventAt` and its latest COMPLETE assessment's
 * `generatedAt`, then applies the pure selection logic in dirty.ts. A quiet,
 * recently-assessed plant is excluded; a plant with a material event since its
 * last assessment, or one past the max-staleness window, is included.
 *
 * @param now            reference time (injected for determinism/testing)
 * @param maxStalenessMs staleness window override
 */
export async function selectPlantsForAssessment(
  now: Date = new Date(),
  maxStalenessMs: number = MAX_STALENESS_MS
): Promise<SelectedPlant[]> {
  // One row per church with its `lastMaterialEventAt`.
  const churchRows = await db
    .select({
      id: churches.id,
      lastMaterialEventAt: churches.lastMaterialEventAt,
    })
    .from(churches);

  // Latest complete `generatedAt` per church.
  const assessmentRows = await db
    .select({
      churchId: plantAssessments.churchId,
      generatedAt: plantAssessments.generatedAt,
    })
    .from(plantAssessments)
    .where(eq(plantAssessments.status, "complete"))
    .orderBy(desc(plantAssessments.generatedAt));

  const latestByChurch = new Map<string, Date>();
  for (const row of assessmentRows) {
    // Rows are newest-first; keep the first seen per church.
    if (!latestByChurch.has(row.churchId)) {
      latestByChurch.set(row.churchId, row.generatedAt);
    }
  }

  const inputs: PlantSelectionInput[] = churchRows.map((c) => ({
    churchId: c.id,
    lastMaterialEventAt: c.lastMaterialEventAt,
    latestAssessmentAt: latestByChurch.get(c.id) ?? null,
  }));

  // Oldest-assessed-first, never-assessed ahead of everything. The runner caps
  // the batch at MAX_BATCH and drops the tail, so this order is what stops the
  // same plants being dropped every tick (#36) — it must be applied HERE, on
  // the full candidate set, because the caller slices what it is handed and
  // `SelectedPlant` no longer carries the timestamp to re-derive it.
  return orderByAssessmentAge(
    filterDirtyOrStale(inputs, now, maxStalenessMs)
  ).map((p) => ({
    churchId: p.churchId,
    reason: selectionReasonFor(p, now, maxStalenessMs)!,
  }));
}

// ============================================================================
// CSF scorecard (PE-023).
//
// The 8 Critical Success Factors are already encoded as rubric lenses
// (lib/phase-engine/rubric.ts, Part A) and already reach the judge's output as
// `plant_insights.category`. This section turns that into a scorecard: one
// standing per factor, always all 8, so a planter can diagnose *where* the
// composite verdict comes from instead of reading it as prose.
//
// Two rules the shape of this projection exists to enforce:
//
//   1. NOTHING IS RECOMPUTED. A factor's standing is the severity the judge
//      already assigned to an insight inside the persisted `plant_assessments`
//      snapshot. There is no second scoring pass, no threshold table, and no
//      number derived from the fact snapshot here. If the scorecard and the
//      Focus panel ever disagreed, one of them would be lying; they cannot,
//      because they read the same rows.
//
//   2. IT IS AN ASSESSMENT, NOT A MEASUREMENT. The standings are an ordinal,
//      named scale — never a percentage, index, or 0–10 score. LLM-derived
//      judgement rendered as a hard number is the failure mode for this
//      surface, so the type system does not even offer one. A factor the
//      assessment did not speak to is `not_raised`, which is deliberately
//      distinct from "healthy" and from "failing".
//
// Audience: the projection is audience-scoped and takes only the insights it
// is handed. The oversight read path (lib/phase-engine/oversight/read.ts)
// applies the `share_*` privacy gate BEFORE building a network scorecard, so a
// withheld factor reads `not_raised` — the same as a factor the judge never
// mentioned. A gated-away insight can therefore never leak through a standing.
// ============================================================================

/**
 * The 8 CSF lenses, in rubric order. These are exactly the first eight members
 * of the judge's `category` vocabulary (judge/schema.ts); the remaining
 * categories (`follow_up`, `launch_readiness`, `phase_progress`, `onboarding`)
 * are cross-cutting and deliberately have no tile — they are not CSFs.
 */
export const CSF_CATEGORIES = [
  "vision_casting",
  "shared_ownership",
  "critical_mass",
  "unity",
  "prayer",
  "generosity",
  "emerging_leadership",
  "comprehensive_training",
] as const;

export type CsfCategory = (typeof CSF_CATEGORIES)[number];

export interface CsfDefinition {
  category: CsfCategory;
  /** The number the rubric uses (CSF-1 … CSF-8). Stable; part of the vocabulary. */
  number: number;
  /** Short name, sentence case, matching the rubric's own wording. */
  name: string;
  /**
   * One line on what the factor is. Shown when the assessment raised nothing
   * for it, so an unraised tile still teaches rather than reading as a blank.
   */
  summary: string;
}

/** Rubric-v0 Part A, as presentation-ready definitions. */
export const CSF_DEFINITIONS: readonly CsfDefinition[] = [
  {
    category: "vision_casting",
    number: 1,
    name: "Vision casting",
    summary: "Vision meetings on cadence, drawing a steady flow of new people.",
  },
  {
    category: "shared_ownership",
    number: 2,
    name: "Shared ownership",
    summary:
      "Inviting and follow-up spread across the core group, not carried alone.",
  },
  {
    category: "critical_mass",
    number: 3,
    name: "Critical mass",
    summary: "Committed adults growing on a trajectory that reaches launch.",
  },
  {
    category: "unity",
    number: 4,
    name: "Unity",
    summary: "Regular core-group gatherings with consistent attendance.",
  },
  {
    category: "prayer",
    number: 5,
    name: "Prayer",
    summary: "Prayer leadership identified and prayer rhythms established.",
  },
  {
    category: "generosity",
    number: 6,
    name: "Generosity",
    summary: "A financial base in place and a viable first-year budget.",
  },
  {
    category: "emerging_leadership",
    number: 7,
    name: "Emerging leadership",
    summary: "Leaders rising from within to fill the eight ministry roles.",
  },
  {
    category: "comprehensive_training",
    number: 8,
    name: "Comprehensive training",
    summary:
      "Ministry-model and role training underway, finishing before launch.",
  },
];

/** Lookup by category, for callers that hold a raw insight category. */
export const CSF_DEFINITION_BY_CATEGORY: Record<CsfCategory, CsfDefinition> =
  Object.fromEntries(CSF_DEFINITIONS.map((d) => [d.category, d])) as Record<
    CsfCategory,
    CsfDefinition
  >;

/** Is this insight category one of the 8 CSF lenses? */
export function isCsfCategory(category: string): category is CsfCategory {
  return (CSF_CATEGORIES as readonly string[]).includes(category);
}

/**
 * How the latest assessment reads a factor. An ordinal, named scale — never a
 * number. `not_raised` is a genuinely different state from the other four: the
 * assessment said nothing about the factor, which is neither a pass nor a fail.
 */
export const CSF_STANDINGS = [
  "attention", // the judge raised something urgent here
  "watch", // medium-urgency observation
  "noted", // low-urgency observation
  "strength", // reinforcing what is going well
  "not_raised", // the assessment did not speak to this factor
] as const;

export type CsfStanding = (typeof CSF_STANDINGS)[number];

/** A standing that came from an actual insight (i.e. everything but `not_raised`). */
export type RaisedCsfStanding = Exclude<CsfStanding, "not_raised">;

/**
 * Persisted severity → standing. This is a relabelling, not a judgement: the
 * DB severity was itself mapped from the judge's own urgency word at
 * persistence time (assessment/persist.ts `mapSeverity`), where
 * `positive → info`. That is why `info` reads as a strength and `low` as a
 * neutral note — `info` is the row the judge marked as going well.
 */
const SEVERITY_STANDING: Record<InsightSeverity, RaisedCsfStanding> = {
  critical: "attention",
  high: "attention",
  medium: "watch",
  low: "noted",
  info: "strength",
};

export function standingForSeverity(
  severity: InsightSeverity
): RaisedCsfStanding {
  return SEVERITY_STANDING[severity] ?? "noted";
}

/** Scan order: what warrants attention reaches the eye before what does not. */
const STANDING_URGENCY: Record<CsfStanding, number> = {
  attention: 0,
  watch: 1,
  noted: 2,
  strength: 3,
  not_raised: 4,
};

/** Lower sorts first. Exported so the UI can order tiles without its own table. */
export function csfStandingUrgency(standing: CsfStanding): number {
  return STANDING_URGENCY[standing] ?? STANDING_URGENCY.not_raised;
}

/**
 * Most urgent first, then the judge's own rank as the tiebreak — so the leading
 * insight of any group is the one that set the group's standing.
 *
 * ONE comparator for both projections in this file (the CSF tiles and the exit
 * criteria). Two copies would let the scorecard and the criteria list disagree
 * about which finding is the headline for the same insight set, which is the
 * kind of drift a reader has no way to spot.
 */
function compareInsightUrgency(a: PlantInsight, b: PlantInsight): number {
  const byUrgency =
    csfStandingUrgency(standingForSeverity(a.severity)) -
    csfStandingUrgency(standingForSeverity(b.severity));
  return byUrgency !== 0 ? byUrgency : a.rank - b.rank;
}

/** One factor's row on the scorecard. */
export interface CsfFactorStanding extends CsfDefinition {
  standing: CsfStanding;
  /**
   * The persisted insights behind the standing, most urgent first. These are
   * the exact `plant_insights` rows from the assessment — the trace from a
   * standing back to the judgement that produced it. Empty iff `not_raised`.
   */
  insights: PlantInsight[];
}

/**
 * The scorecard: 8 factors plus the identity of the snapshot they were read
 * from. The assessment metadata is not decoration — it is what makes the
 * scorecard traceable and dateable rather than a floating verdict.
 */
export interface CsfScorecard {
  /** The `plant_assessments` row every standing below came from. */
  assessmentId: string;
  generatedAt: Date;
  rubricVersion: string;
  phase: number;
  /** Which audience's insights this scorecard was built from. */
  audience: InsightAudience;
  /** Always all 8 factors, in rubric order. */
  factors: CsfFactorStanding[];
  /** How many of the 8 the assessment actually spoke to. */
  raisedCount: number;
}

/**
 * Project a persisted assessment onto the 8 CSF lenses (PE-023).
 *
 * Pure — no DB, no LLM, no recomputation. Returns `null` when the plant has no
 * complete assessment, which the UI must render as a cold-start state: eight
 * `not_raised` rows would claim the engine looked and found nothing, and it
 * has not looked at all.
 *
 * @param latest   the latest COMPLETE snapshot + its insights, or null
 * @param audience which audience's insights to build from. Callers passing
 *                 `"network"` must hand in an already privacy-gated payload.
 */
export function buildCsfScorecard(
  latest: LatestAssessment | null,
  audience: InsightAudience = "planter"
): CsfScorecard | null {
  if (!latest) return null;

  const byCategory = new Map<CsfCategory, PlantInsight[]>();
  for (const insight of latest.insights) {
    if (insight.audience !== audience) continue;
    if (!isCsfCategory(insight.category)) continue;
    const bucket = byCategory.get(insight.category);
    if (bucket) bucket.push(insight);
    else byCategory.set(insight.category, [insight]);
  }

  const factors = CSF_DEFINITIONS.map((definition) => {
    // Most urgent first, then the judge's own rank within a severity, so the
    // leading insight the tile shows is the one that set the standing.
    const insights = [...(byCategory.get(definition.category) ?? [])].sort(
      compareInsightUrgency
    );

    return {
      ...definition,
      standing: insights[0]
        ? standingForSeverity(insights[0].severity)
        : ("not_raised" as const),
      insights,
    } satisfies CsfFactorStanding;
  });

  return {
    assessmentId: latest.assessment.id,
    generatedAt: latest.assessment.generatedAt,
    rubricVersion: latest.assessment.rubricVersion,
    phase: latest.assessment.phase,
    audience,
    factors,
    raisedCount: factors.filter((f) => f.standing !== "not_raised").length,
  };
}

/**
 * The PLANTER's CSF scorecard for a church, read from its latest COMPLETE
 * assessment (PE-023). Zero LLM calls — one snapshot read plus a pure
 * projection.
 *
 * WHY IT HAS NO CALLER IN `src/`, AND WHY IT MUST STAY EXPORTED. Grepping for
 * call sites finds none, because this is a DEVELOPER entry point rather than a
 * runtime one. It is the documented regeneration step for the landing page's
 * frozen scorecard fixture,
 * `src/app/(marketing)/_components/vignettes/csf-fixture.ts`: that file's
 * header instructs whoever refreshes the marketing embed to re-run
 * `getCsfScorecard(churchId)` against the source church, then paste the result
 * back over the exported constant. The marketing page renders the constant, so
 * it issues no assessment read of its own and never calls this — which is
 * exactly why the symbol looks dead and has already been proposed for deletion
 * once (#155, resolved: keep and document).
 *
 * Deleting it therefore does not remove dead code; it breaks a documented
 * procedure and leaves the fixture unreproducible. Keep it exported from
 * `./index.ts` as well — the fixture imports its types from that barrel, so the
 * barrel is where the note's reader will look for the function too.
 *
 * Deliberately has no `audience` parameter. This is the only function in this
 * section that touches the DB, and `getLatestAssessment` returns every insight
 * on the assessment — including network-audience rows that have NOT passed the
 * `share_*` privacy gate. An `audience: "network"` option here would therefore
 * be a one-argument bypass of that gate, sitting right where a future oversight
 * UI would reach for it.
 *
 * A network scorecard is built the only safe way instead: gate first with the
 * oversight read path (`oversight/read.ts:gateNetworkInsights`, reached via
 * `getOversightPlantHealth`), then hand the surviving rows to
 * {@link buildCsfScorecard} with `audience: "network"`. That projection is
 * pure — it can only ever show what the caller already decided is shareable.
 *
 * Callers that already hold the snapshot (the /phase page reads it for the
 * Focus panel) should call {@link buildCsfScorecard} directly rather than
 * paying for a second identical read.
 */
export async function getCsfScorecard(
  churchId: string
): Promise<CsfScorecard | null> {
  return buildCsfScorecard(await getLatestAssessment(churchId), "planter");
}

// ============================================================================
// Exit-criteria progress with fact drill-down (PE-022 + PE-025).
//
// The composite verdict answers "how is the plant doing". It does not answer
// the question a planter in phase 2 actually asks: "what is left before I can
// move to phase 3?" Rubric-v0 Part B already names those gates per phase
// ("Readiness for 2->3: all 8 team leaders assigned, launch date set"); this
// section turns that prose into rows a planter can read one at a time, and lets
// each row be opened onto the facts underneath it.
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
// emit. Ruled 2026-08-10 on #319.
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

// ----------------------------------------------------------------------------
// Reading the persisted snapshot by path.
// ----------------------------------------------------------------------------

/** One deterministic reading taken out of the persisted fact snapshot. */
export interface SnapshotFact {
  /** The dotted path read, e.g. `coreGroup.committedCount`. */
  path: string;
  /**
   * The path RESOLVED inside the stored snapshot. False means this snapshot
   * predates the field (or the path is not a fact at all) — materially
   * different from the snapshot storing `null` there.
   */
  present: boolean;
  /**
   * The scalar at that path as a string; `null` when the snapshot stores null,
   * when the path did not resolve, or when the value is an object/array (a
   * container is not a fact). `present: true` with `value: null` is a real
   * reading — "no launch date set" is an answer.
   */
  value: string | null;
}

/** `roles[0].filled` and `roles.0.filled` are the same path. */
function dottedPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1");
}

/** A scalar rendered for display/comparison; containers are not facts. */
function scalarToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return String(value);
  return null;
}

/** Walk a dotted path through the stored snapshot JSON. Never throws. */
function resolveSnapshotPath(
  snapshot: unknown,
  path: string
): { found: boolean; value: unknown } {
  const segments = dottedPath(path)
    .split(".")
    .filter((segment) => segment.length > 0);

  let cursor: unknown = snapshot;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object") {
      return { found: false, value: undefined };
    }
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        return { found: false, value: undefined };
      }
      cursor = cursor[index];
      continue;
    }
    const record = cursor as Record<string, unknown>;
    if (!(segment in record)) return { found: false, value: undefined };
    cursor = record[segment];
  }

  return { found: cursor !== undefined, value: cursor };
}

/** Read one fact out of a persisted snapshot. Pure; safe on any stored shape. */
export function readSnapshotFact(
  snapshot: unknown,
  path: string
): SnapshotFact {
  const normalized = dottedPath(path);
  const { found, value } = resolveSnapshotPath(snapshot, normalized);
  return {
    path: normalized,
    present: found,
    value: found ? scalarToString(value) : null,
  };
}

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
      const { found, value: rows } = resolveSnapshotPath(snapshot, arrayPath);
      if (!found || !Array.isArray(rows)) return null;
      const index = rows.findIndex(
        (row) =>
          row !== null &&
          typeof row === "object" &&
          scalarToString((row as Record<string, unknown>)[field]) === value
      );
      return index === -1 ? null : index;
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
 * The manual block is written into the snapshot TWICE — `manual.byKey.<signal>`
 * and `manual.attestations[]` (signals/build-fact-snapshot.ts) — and the judge's
 * citable ledger is the whole flattened snapshot, so BOTH spellings are legal
 * citations of the same attestation.
 */
const MANUAL_ATTESTATIONS_PREFIX = "manual.attestations.";

/**
 * Rewrite an `manual.attestations.N.…` citation onto the `manual.byKey.<signal>`
 * form the attested criteria declare, by resolving entry N's `signalKey` in the
 * snapshot the insight was made against (ruled 2026-08-10 on #319).
 *
 * ATTRIBUTION ONLY. This normalisation exists so the standing column names the
 * criterion the judge actually spoke to; it never touches the drill-down, where
 * `buildEvidence` still resolves the citation EXACTLY as the judge wrote it. The
 * planter therefore reads the real citation and its real snapshot value, while
 * the row it lands on is decided by which signal it names.
 *
 * Why by signal and not by widening the criteria to the `manual` prefix: the
 * three attested gates each measure ONE signal, so a prefix rule would light all
 * three up for a citation of any manual signal at all — telling a planter the
 * engine addressed their financial base because it mentioned something else.
 * Resolving the row gives full recall with no precision lost.
 *
 * Returns `null` when the citation names no resolvable entry — an out-of-range
 * index, a non-numeric one, or a snapshot whose row carries no `signalKey`. An
 * unresolvable citation attributes to NOTHING rather than guessing a gate; the
 * criterion then reads `not_addressed`, which is the honest answer.
 */
function normalizeManualCitation(
  citedPath: string,
  snapshot: unknown
): string | null {
  if (!citedPath.startsWith(MANUAL_ATTESTATIONS_PREFIX)) return citedPath;

  const [index] = citedPath.slice(MANUAL_ATTESTATIONS_PREFIX.length).split(".");
  if (!/^\d+$/.test(index)) return null;

  const signalKey = readSnapshotFact(
    snapshot,
    `${MANUAL_ATTESTATIONS_PREFIX}${index}.signalKey`
  );
  if (!signalKey.present || signalKey.value === null) return null;

  const key = signalKey.value.trim();
  return key.length > 0 ? `manual.byKey.${key}` : null;
}

/**
 * The cited paths of one insight, normalised for ATTRIBUTION; tolerates a
 * malformed column. `snapshot` is the assessment's own fact snapshot — the one
 * the judge cited — because resolving an attestation row to its signal is a read
 * of that snapshot, not a syntax rule.
 */
function citedPathsOf(insight: PlantInsight, snapshot: unknown): string[] {
  const facts = insight.citedFacts;
  if (!Array.isArray(facts)) return [];
  return facts
    .filter((fact): fact is string => typeof fact === "string")
    .map((fact) => dottedPath(parseCitedFact(fact).path))
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
    const normalized = dottedPath(path);
    if (normalized.length === 0) continue;

    const stored = readSnapshotFact(snapshot, normalized);
    evidence.push({
      insightId: insight.id,
      path: normalized,
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
