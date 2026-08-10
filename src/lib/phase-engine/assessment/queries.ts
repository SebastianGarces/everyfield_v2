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
//     assigned to an insight in that persisted assessment.
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
      (a, b) => {
        const byUrgency =
          csfStandingUrgency(standingForSeverity(a.severity)) -
          csfStandingUrgency(standingForSeverity(b.severity));
        return byUrgency !== 0 ? byUrgency : a.rank - b.rank;
      }
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
