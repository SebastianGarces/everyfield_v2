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
// On any failure after step 3, the pending row is marked `failed` — or
// `deferred` when the provider throttled us out of the run (#376) — status
// only. The last good complete snapshot is never touched, so instant reads keep
// serving the previous assessment (PE-011).
// ============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  plantAssessments,
  type AssessmentFailureStatus,
  type PlantAssessment,
} from "@/db/schema";
import { buildFactSnapshot } from "@/lib/phase-engine/signals";
import {
  isRateLimitDeferral,
  runAssessment,
  type AssessmentResult,
  type RateLimitEvent,
  type SchemaRejectionEvent,
  type TokenPacer,
} from "@/lib/phase-engine/judge";

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

/**
 * Per-RUN throttle state (#36) — distinct from `deps`, which are test seams.
 *
 * The cron batch creates one {@link TokenPacer} for the whole run and passes it
 * to every plant so they queue behind ONE TPM budget. Omitting it (the manual
 * trigger, a seed script) gives the judge a throwaway bucket that starts full,
 * so a single assessment never waits.
 */
export interface AssessmentRunOptions {
  pacer?: TokenPacer;
  /** Attempts, including the first, before a rate limit becomes a deferral. */
  maxAttempts?: number;
  /** Called on every 429 — lets the caller log throttling apart from failure. */
  onRateLimit?: (event: RateLimitEvent) => void;
  /**
   * Called on every draft the judge's own rules rejected (#605) — lets the
   * caller log a re-prompt, which is not a failure, apart from a run that spent
   * every draft and failed.
   */
  onSchemaRejection?: (event: SchemaRejectionEvent) => void;
  /**
   * Instant (on the pacer's clock) past which the judge's retry ladder must
   * stand down instead of holding for another TPM window. The cron batch passes
   * its run deadline; a manual trigger omits it and retries normally (#36).
   */
  deadlineAt?: number;
}

/**
 * How a run that produced no judgement is RECORDED (#376).
 *
 * ONE decision, exported, so the row an operator queries after a bad run and
 * the summary `/api/phase-engine/assess` prints during it cannot disagree: a
 * `RateLimitDeferralError` is throttling — the provider refused every attempt,
 * so we learned nothing about the judge — and everything else is a judge
 * failure. `isRateLimitDeferral` is the same predicate the runner branches on,
 * imported rather than re-derived; a second `error.name === …` copy here is how
 * the log and the table drift apart again.
 *
 * A deferral is NOT swallowed: the error is still re-thrown, so the runner
 * keeps counting it, and the plant keeps its last good `complete` snapshot,
 * stays dirty and is re-selected on the next run.
 *
 * A failure whose retry ladder was cut short by the RUN's clock
 * (`isDeadlineTruncatedFailure`) deliberately stays `failed` here, exactly as
 * it stays `failed` in the run summary: the provider answered and the answer
 * was broken. Only the deadline flavour of the WARNING differs, and that is the
 * runner's business, not the row's.
 */
export function assessmentStatusForFailure(
  error: unknown
): AssessmentFailureStatus {
  return isRateLimitDeferral(error) ? "deferred" : "failed";
}

/**
 * The status-only write that ends a run without a judgement.
 *
 * Exported as a STATEMENT rather than performed inline so its rendered SQL can
 * be asserted without a live database — the `portfolioPlantsStatement` idiom.
 * It sets `status` and nothing else: the `factSnapshot` recorded up-front stays
 * exactly as the judge saw it, and the plant's last good `complete` row is
 * never touched (PE-011).
 *
 * The write is a COMPARE-AND-SET on `status = 'pending'`, and that guard is what
 * keeps a completed run from being demoted by a failure in step 6: the `try`
 * this serves does not end at the `complete` flip — `emitPlantAssessmentCreated`
 * runs after the insights are persisted and the row is already `complete`, so a
 * throw from there would otherwise overwrite a good assessment with `failed` (or
 * `deferred`) and hide it from every read, which all name `complete` positively.
 * An empty rowcount is NOT an error: it means the run already reached a
 * judgement, which is precisely the case that must not be demoted.
 */
export function markAssessmentUnjudgedStatement(
  assessmentId: string,
  error: unknown
) {
  return db
    .update(plantAssessments)
    .set({ status: assessmentStatusForFailure(error) })
    .where(
      and(
        eq(plantAssessments.id, assessmentId),
        eq(plantAssessments.status, "pending")
      )
    );
}

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
 *         being overwritten. A `RateLimitDeferralError` travels the same path
 *         and is RECORDED APART, as `deferred` (#376): the plant keeps its last
 *         good complete snapshot, stays dirty, and is re-selected on the next
 *         run (#36).
 */
export async function generateAssessment(
  churchId: string,
  deps: GenerateAssessmentDeps = DEFAULT_DEPS,
  run: AssessmentRunOptions = {}
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
    // 4. Run the judge over the snapshot (PE-007/009), queued behind the run's
    //    shared token budget (#36).
    const result = await deps.runAssessment(snapshot, snapshot.currentPhase, {
      pacer: run.pacer,
      maxAttempts: run.maxAttempts,
      onRateLimit: run.onRateLimit,
      onSchemaRejection: run.onSchemaRejection,
      deadlineAt: run.deadlineAt,
    });

    // 5. Privacy-filter + rank, then persist insights (PE-012/013). The
    //    retrieved passages travel with the result so each insight's wiki links
    //    can be reconciled against what RAG actually returned (PE-024).
    const rows = buildInsightRows(
      pending.id,
      churchId,
      result.insights,
      result.retrievedPassages
    );
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
    // Mark the run unjudged (status only): `deferred` if the provider throttled
    // us out of this run, `failed` if the judge answered badly (#376). The last
    // good complete snapshot is untouched either way, so instant reads keep
    // serving the previous assessment (PE-011).
    await markAssessmentUnjudgedStatement(pending.id, error);
    throw error;
  }
}
