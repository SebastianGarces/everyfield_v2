// ============================================================================
// Assessment orchestrator (PE-009 / PE-011 / PE-012/013 / PE-016).
//
// Ties the deterministic Signal layer, the LLM-as-judge, and persistence into
// one auditable run:
//
//   1. read the PRIOR complete snapshot (for the what-changed delta)
//   2. build the fresh deterministic fact snapshot
//   3. insert a `pending` plant_assessment recording the snapshot + phase
//   4. run the judge over the snapshot
//   5. privacy-filter + rank insights, persist them, annotate the stored
//      snapshot with the what-changed delta, mark the assessment `complete`
//   6. emit `plant.assessment.created`
//
// On any failure after step 3, the pending row is marked `failed` (status only)
// — the last good complete snapshot is never touched, so instant reads keep
// serving the previous assessment (PE-011).
// ============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { plantAssessments, type PlantAssessment } from "@/db/schema";
import { buildFactSnapshot } from "@/lib/phase-engine/signals";
import { runAssessment, type AssessmentResult } from "@/lib/phase-engine/judge";

import { emitPlantAssessmentCreated } from "../events";
import { getLatestCompleteSnapshot } from "./queries";
import {
  buildInsightRows,
  computeSnapshotDelta,
  persistInsights,
  type SnapshotDelta,
} from "./persist";

/** Seams so the orchestrator can be exercised without live DB/LLM in tests. */
export interface GenerateAssessmentDeps {
  buildFactSnapshot: typeof buildFactSnapshot;
  runAssessment: typeof runAssessment;
  getLatestCompleteSnapshot: typeof getLatestCompleteSnapshot;
}

const DEFAULT_DEPS: GenerateAssessmentDeps = {
  buildFactSnapshot,
  runAssessment,
  getLatestCompleteSnapshot,
};

export interface GenerateAssessmentResult {
  assessment: PlantAssessment;
  result: AssessmentResult;
  delta: SnapshotDelta;
  /** Insights persisted after privacy filtering (PE-012/013). */
  persistedInsightCount: number;
}

/**
 * Run and persist a Plant Intelligence assessment for a single church (PE-009).
 *
 * @throws re-throws the underlying error AFTER the pending row is marked
 *         `failed`, so callers can observe/retry without the last good snapshot
 *         being overwritten.
 */
export async function generateAssessment(
  churchId: string,
  deps: GenerateAssessmentDeps = DEFAULT_DEPS
): Promise<GenerateAssessmentResult> {
  // 1. Prior complete snapshot for the what-changed delta (PE-016). Read BEFORE
  //    we insert the new pending row so it reflects the last GOOD assessment.
  const priorSnapshot = await deps.getLatestCompleteSnapshot(churchId);

  // 2. Fresh deterministic fact snapshot.
  const snapshot = await deps.buildFactSnapshot(churchId);
  const delta = computeSnapshotDelta(priorSnapshot, snapshot);

  // 3. Insert the pending row. The snapshot column is NOT NULL, so the facts the
  //    judge will reason over are recorded up-front for auditability.
  const [pending] = await db
    .insert(plantAssessments)
    .values({
      churchId,
      phase: snapshot.currentPhase,
      // rubricVersion is required; replaced with the judge's recorded version on
      // completion. Use the snapshot version as a provisional placeholder.
      rubricVersion: snapshot.snapshotVersion,
      factSnapshot: snapshot,
      status: "pending",
    })
    .returning();

  try {
    // 4. Run the judge over the snapshot (PE-007/009).
    const result = await deps.runAssessment(snapshot, snapshot.currentPhase);

    // 5. Privacy-filter + rank, then persist insights (PE-012/013).
    const rows = buildInsightRows(pending.id, churchId, result.insights);
    await persistInsights(rows);

    // Annotate the stored snapshot with the what-changed delta (PE-016) and
    // flip to complete with the judge's audit metadata.
    const [completed] = await db
      .update(plantAssessments)
      .set({
        status: "complete",
        rubricVersion: result.rubricVersion,
        modelId: result.modelId,
        factSnapshot: { ...snapshot, _delta: delta },
      })
      .where(eq(plantAssessments.id, pending.id))
      .returning();

    // 6. Emit (PE-009).
    await emitPlantAssessmentCreated({
      assessmentId: completed.id,
      churchId,
      phase: completed.phase,
      rubricVersion: completed.rubricVersion,
      modelId: completed.modelId ?? null,
      insightCount: rows.length,
    });

    return {
      assessment: completed,
      result,
      delta,
      persistedInsightCount: rows.length,
    };
  } catch (error) {
    // Mark failed (status only). The last good complete snapshot is untouched,
    // so instant reads keep serving the previous assessment (PE-011).
    await db
      .update(plantAssessments)
      .set({ status: "failed" })
      .where(eq(plantAssessments.id, pending.id));
    throw error;
  }
}
