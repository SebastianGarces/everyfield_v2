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
// ============================================================================

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  plantAssessments,
  plantInsights,
  type PlantAssessment,
  type PlantInsight,
} from "@/db/schema";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";
import {
  filterDirtyOrStale,
  MAX_STALENESS_MS,
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

  return filterDirtyOrStale(inputs, now, maxStalenessMs).map((p) => ({
    churchId: p.churchId,
    reason: selectionReasonFor(p, now, maxStalenessMs)!,
  }));
}
