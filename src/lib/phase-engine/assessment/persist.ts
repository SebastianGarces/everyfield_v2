// ============================================================================
// Assessment persistence (PE-009 / PE-012/013 / PE-016) — pure transforms +
// the DB write seam.
//
// The pure pieces (severity mapping, privacy filtering, ranking, what-changed
// delta) live here as exported functions so they can be unit-tested with no DB
// or LLM. The single DB write (`persistInsights`) is kept thin and isolated.
// ============================================================================

import {
  plantInsights,
  type InsightSeverity as DbInsightSeverity,
  type NewPlantInsight,
} from "@/db/schema";
import type {
  Insight,
  InsightSeverity as JudgeSeverity,
} from "@/lib/phase-engine/judge";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";

// ----------------------------------------------------------------------------
// Severity mapping (judge enum → DB enum).
//
// The judge speaks a small urgency vocabulary (positive|info|watch|urgent); the
// plant_insights column persists info|low|medium|high|critical. We map as:
//
//   positive → info     (reinforcing what's going well; lowest urgency)
//   info     → low
//   watch    → medium
//   urgent   → high
//
// `critical` is intentionally NOT produced by this mapping — it is reserved for
// future, explicitly-escalated findings so it stays meaningful in the UI.
// ----------------------------------------------------------------------------
const SEVERITY_MAP: Record<JudgeSeverity, DbInsightSeverity> = {
  positive: "info",
  info: "low",
  watch: "medium",
  urgent: "high",
};

/** Map a judge severity onto the persisted DB severity enum (documented above). */
export function mapSeverity(severity: JudgeSeverity): DbInsightSeverity {
  return SEVERITY_MAP[severity];
}

// ----------------------------------------------------------------------------
// Privacy filtering (PE-012/013).
//
// Planter insights are ALWAYS persisted. Network-audience insights must exclude
// any individual-person finding: a network insight that cites a person-level
// fact (e.g. a `leadership.candidates[].personId`) leaks an individual into the
// oversight surface and is dropped at persistence time.
// ----------------------------------------------------------------------------

/**
 * Heuristic: does a cited fact reference an individual person? The deterministic
 * snapshot only exposes person identity via the leadership candidates' `personId`
 * (see signals/types.ts). A cited fact that names a candidate row or a personId
 * is an individual-person finding.
 */
function citesIndividualPerson(citedFact: string): boolean {
  const f = citedFact.toLowerCase();
  return (
    f.includes("personid") ||
    f.includes("person_id") ||
    f.includes("leadership.candidates")
  );
}

/** True when a NETWORK insight must be withheld because it names an individual. */
export function isIndividualPersonFinding(insight: Insight): boolean {
  return (insight.citedFacts ?? []).some(citesIndividualPerson);
}

/**
 * Apply the privacy rule (PE-012/013): keep every planter insight; drop network
 * insights that surface an individual-person finding. Pure over its input.
 */
export function filterInsightsForPersistence(insights: Insight[]): Insight[] {
  return insights.filter((insight) => {
    if (insight.audience === "planter") return true;
    // audience === "network": withhold individual-person findings.
    return !isIndividualPersonFinding(insight);
  });
}

// ----------------------------------------------------------------------------
// Ranking + row mapping.
// ----------------------------------------------------------------------------

/** Numeric weight per judge severity for prioritization (higher = more urgent). */
const SEVERITY_WEIGHT: Record<JudgeSeverity, number> = {
  urgent: 3,
  watch: 2,
  info: 1,
  positive: 0,
};

/**
 * Build the persistable insight rows for an assessment: privacy-filter, order by
 * urgency (stable), then assign a 0-based `rank` (lower = higher priority).
 */
export function buildInsightRows(
  assessmentId: string,
  churchId: string,
  insights: Insight[]
): NewPlantInsight[] {
  const kept = filterInsightsForPersistence(insights);

  // Stable sort by descending severity weight; preserve judge order within ties.
  const ordered = kept
    .map((insight, originalIndex) => ({ insight, originalIndex }))
    .sort((a, b) => {
      const weightDiff =
        SEVERITY_WEIGHT[b.insight.severity] -
        SEVERITY_WEIGHT[a.insight.severity];
      return weightDiff !== 0 ? weightDiff : a.originalIndex - b.originalIndex;
    });

  return ordered.map(({ insight }, rank) => ({
    assessmentId,
    churchId,
    audience: insight.audience,
    category: insight.category,
    severity: mapSeverity(insight.severity),
    title: insight.title,
    body: insight.body,
    citedFacts: insight.citedFacts,
    relatedArticleSlugs: insight.relatedArticleSlugs,
    rank,
  }));
}

/**
 * Insert the prepared insight rows. Thin DB seam (no transforms).
 *
 * `@/db` is imported lazily so the pure transforms above (severity mapping,
 * privacy filtering, ranking, delta) can be unit-tested without constructing a
 * neon client / requiring a DATABASE_URL at module load.
 */
export async function persistInsights(rows: NewPlantInsight[]): Promise<void> {
  if (rows.length === 0) return;
  const { db } = await import("@/db");
  await db.insert(plantInsights).values(rows);
}

// ----------------------------------------------------------------------------
// What-changed delta vs. the prior snapshot (PE-016).
//
// Compares two fact snapshots and reports the load-bearing numeric movements.
// Pure: takes the prior + current snapshots and returns a structured delta the
// UI/judge-context can render ("core group +3, vision-meeting attendance −5").
// ----------------------------------------------------------------------------

export interface SnapshotDeltaField {
  /** Dotted path of the fact, e.g. "coreGroup.committedCount". */
  path: string;
  previous: number | null;
  current: number | null;
  /** current − previous when both are numbers; null otherwise. */
  delta: number | null;
}

export interface SnapshotDelta {
  /** True when there was no prior complete snapshot to compare against. */
  isFirstAssessment: boolean;
  /** Only the fields that actually moved (or appeared/disappeared). */
  changed: SnapshotDeltaField[];
}

/** The numeric facts we track movement on, by dotted path. */
function trackedNumericFacts(
  snapshot: PlantFactSnapshot
): Array<{ path: string; value: number | null }> {
  return [
    { path: "currentPhase", value: snapshot.currentPhase },
    {
      path: "coreGroup.committedCount",
      value: snapshot.coreGroup.committedCount,
    },
    {
      path: "coreGroup.launchTeamCount",
      value: snapshot.coreGroup.launchTeamCount,
    },
    {
      path: "visionMeetings.totalCompleted",
      value: snapshot.visionMeetings.totalCompleted,
    },
    {
      path: "visionMeetings.latestAttendance",
      value: snapshot.visionMeetings.latestAttendance,
    },
    { path: "followUp.openCount", value: snapshot.followUp.openCount },
    { path: "followUp.staleCount", value: snapshot.followUp.staleCount },
    {
      path: "ministryRoles.filledCount",
      value: snapshot.ministryRoles.filledCount,
    },
    {
      path: "training.completionCount",
      value: snapshot.training.completionCount,
    },
    { path: "launch.daysUntilLaunch", value: snapshot.launch.daysUntilLaunch },
  ];
}

/**
 * Compute the what-changed delta between the prior complete snapshot and the
 * current one (PE-016). When there is no prior snapshot, returns an empty delta
 * flagged `isFirstAssessment`.
 */
export function computeSnapshotDelta(
  previous: PlantFactSnapshot | null,
  current: PlantFactSnapshot
): SnapshotDelta {
  if (previous === null) {
    return { isFirstAssessment: true, changed: [] };
  }

  const prevFacts = new Map(
    trackedNumericFacts(previous).map((f) => [f.path, f.value])
  );

  const changed: SnapshotDeltaField[] = [];
  for (const { path, value: current_ } of trackedNumericFacts(current)) {
    const previous_ = prevFacts.get(path) ?? null;
    if (previous_ === current_) continue;

    const delta =
      typeof previous_ === "number" && typeof current_ === "number"
        ? current_ - previous_
        : null;

    changed.push({ path, previous: previous_, current: current_, delta });
  }

  return { isFirstAssessment: false, changed };
}
