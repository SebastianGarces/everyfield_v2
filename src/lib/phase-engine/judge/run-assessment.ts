// ============================================================================
// The LLM-as-judge pipeline (PE-007 / PE-009 / PE-012 / AC-PE-4 / AC-PE-5 /
// NFR-PE-1 / NFR-PE-5).
//
// A plain-TypeScript pipeline (no React, no DB writes): it takes a deterministic
// fact snapshot + the plant's current phase, loads the active rubric WHOLE,
// retrieves phase-relevant methodology passages, makes ONE validated
// `generateObject` call (Zod-constrained to the insight shape), and returns a
// structured, audited assessment.
//
// Hard guarantees:
//   - The judge consumes a snapshot; it NEVER recomputes facts (it doesn't even
//     import buildFactSnapshot — the snapshot is passed in).
//   - The model is constrained to `judgeOutputSchema`; the result is Zod-valid
//     by construction.
//   - Both planter and network audiences are present (asserted post-parse).
//   - The active rubric version is recorded on the result (changing the rubric
//     version changes the recorded version — AC-PE-4).
//   - Every run is traced in Langfuse when configured, and silently no-ops when
//     not (NFR-PE-5) — tracing never blocks or breaks the assessment.
// ============================================================================

import { generateObject } from "ai";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";
import { retrieve, type RetrievedPassage } from "@/lib/phase-engine/rag";
import { ACTIVE_RUBRIC, type Rubric } from "@/lib/phase-engine/rubric";
import { startJudgeTrace } from "@/lib/phase-engine/observability";
import { getJudgeModel, JUDGE_MODEL_ID } from "./provider";
import {
  buildRetrievalQuery,
  buildSystemPrompt,
  buildUserPrompt,
} from "./prompt";
import {
  judgeOutputSchema,
  hasBothAudiences,
  type AssessmentResult,
} from "./schema";

/** Knobs for a run; all optional so the common call is `runAssessment(snapshot)`. */
export interface RunAssessmentOptions {
  /** Override the rubric (defaults to the active one). For replaying versions. */
  rubric?: Rubric;
  /** Max methodology passages to ground with. */
  retrievalLimit?: number;
  /**
   * Inject passages instead of retrieving (used to keep this function pure in
   * tests/eval harnesses). When omitted, the pipeline calls `retrieve()`.
   */
  passages?: RetrievedPassage[];
}

const DEFAULT_RETRIEVAL_LIMIT = 8;

/**
 * Run a Plant Intelligence assessment over a deterministic fact snapshot.
 *
 * @param snapshot the deterministic facts (from `buildFactSnapshot` upstream)
 * @param phase    the plant's current phase (defaults to the snapshot's phase)
 * @returns a Zod-validated {@link AssessmentResult} with audit metadata
 */
export async function runAssessment(
  snapshot: PlantFactSnapshot,
  phase: number = snapshot.currentPhase,
  options: RunAssessmentOptions = {}
): Promise<AssessmentResult> {
  const rubric = options.rubric ?? ACTIVE_RUBRIC;

  // 1. Retrieve phase-relevant methodology passages to ground the insights
  //    (unless the caller supplied them). Retrieval failures must not sink the
  //    assessment — the judge can still reason over facts alone.
  const passages =
    options.passages ??
    (await safeRetrieve(
      buildRetrievalQuery(snapshot),
      phase,
      options.retrievalLimit ?? DEFAULT_RETRIEVAL_LIMIT
    ));

  // 2. Build the prompts (whole rubric in the system message; facts + passages
  //    in the user message).
  const system = buildSystemPrompt(rubric);
  const user = buildUserPrompt(snapshot, passages);

  // 3. Start tracing (no-op when Langfuse is unconfigured), tagged with rubric
  //    version + model id.
  const trace = startJudgeTrace({
    churchId: snapshot.churchId,
    phase,
    rubricVersion: rubric.version,
    modelId: JUDGE_MODEL_ID,
    snapshotVersion: snapshot.snapshotVersion,
    systemPrompt: system,
    userPrompt: user,
  });

  try {
    // 4. The single validated generateObject call — Zod-constrained output.
    const { object, usage } = await generateObject({
      model: getJudgeModel(),
      schema: judgeOutputSchema,
      system,
      prompt: user,
    });

    // 5. Coverage guard (PE-012): both audiences must be represented. The schema
    //    can't express "at least one of each", so we assert it here and fail
    //    loudly rather than silently shipping a one-sided assessment.
    if (!hasBothAudiences(object.insights)) {
      throw new Error(
        "Judge output is missing a required audience: the assessment must include at least one planter AND one network insight (PE-012)."
      );
    }

    trace.succeed(object.insights, {
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
    });

    // 6. Attach audit metadata. The rubric version recorded here is the version
    //    that produced the assessment (AC-PE-4).
    return {
      ...object,
      rubricVersion: rubric.version,
      modelId: JUDGE_MODEL_ID,
      snapshotVersion: snapshot.snapshotVersion,
      phase,
      assessedAt: new Date().toISOString(),
    };
  } catch (error) {
    trace.fail(error);
    throw error;
  }
}

/**
 * Retrieval that degrades gracefully: a RAG failure (e.g. DB hiccup) should not
 * block the assessment — the judge still reasons over the facts, just without
 * methodology citations.
 */
async function safeRetrieve(
  query: string,
  phase: number,
  limit: number
): Promise<RetrievedPassage[]> {
  try {
    return await retrieve(query, { phase, limit });
  } catch {
    return [];
  }
}
