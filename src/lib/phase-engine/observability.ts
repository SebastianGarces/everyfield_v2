// ============================================================================
// Phase Engine observability — Langfuse tracing (NFR-PE-5).
//
// Every judge run is traced in Langfuse, tagged with the rubric version + model
// id, WHEN Langfuse is configured. When the LANGFUSE_* env vars are absent (they
// are not configured yet), this module MUST no-op silently — it never throws,
// never blocks, and never delays an assessment. Tracing is observability, not a
// dependency of the result.
//
// The seam is a tiny `JudgeTrace` interface so the pipeline calls the same
// methods whether or not Langfuse is live; the no-op implementation is a
// constant. The real client is created lazily and defensively — any failure to
// construct or emit a trace is swallowed and the assessment proceeds.
// ============================================================================

import { startObservation } from "@langfuse/tracing";

import {
  forceFlushLangfuse,
  initializeLangfuseTracing,
} from "@/lib/observability/langfuse";

import type { Insight } from "./judge/schema";

/** Inputs recorded at the start of a traced judge run. */
export interface JudgeTraceInput {
  phase: number;
  rubricVersion: string;
  modelId: string;
  snapshotVersion: string;
}

/** Token usage to record on the generation, when available. */
export interface JudgeTraceUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * A handle the pipeline drives. Every method is fire-and-forget and guaranteed
 * not to throw — the no-op and live implementations both honor that contract.
 */
export interface JudgeTrace {
  /** Record a successful run: the produced insights + token usage. */
  succeed(insights: Insight[], usage?: JudgeTraceUsage): void;
  /** Record a failed run with the error. */
  fail(error: unknown): void;
}

/** The no-op handle used whenever Langfuse is not configured (or errors). */
const NOOP_TRACE: JudgeTrace = {
  succeed: () => {},
  fail: () => {},
};

/**
 * Start a judge trace. Returns a {@link JudgeTrace} handle. When Langfuse is not
 * configured (or anything goes wrong constructing the client / trace), returns
 * the no-op handle so the caller's code path is identical either way.
 *
 * The trace is tagged with the rubric version and model id (NFR-PE-5).
 */
export function startJudgeTrace(input: JudgeTraceInput): JudgeTrace {
  if (initializeLangfuseTracing().status !== "configured") return NOOP_TRACE;

  try {
    const trace = startObservation("phase-engine.assessment", {
      metadata: {
        phase: input.phase,
        rubricVersion: input.rubricVersion,
        modelId: input.modelId,
        snapshotVersion: input.snapshotVersion,
      },
    });
    const generation = trace.startObservation(
      "phase-engine.judge.generateObject",
      {
        model: input.modelId,
        metadata: { rubricVersion: input.rubricVersion },
      },
      { asType: "generation" }
    );

    const flush = () => {
      try {
        void forceFlushLangfuse().catch(() => {});
      } catch {
        /* ignore */
      }
    };

    return {
      succeed(insights, usage) {
        try {
          generation.update({
            usageDetails: usage
              ? {
                  input: usage.inputTokens ?? 0,
                  output: usage.outputTokens ?? 0,
                  total: usage.totalTokens ?? 0,
                }
              : undefined,
          });
          generation.end();
          trace.update({
            metadata: {
              result: "succeeded",
              insightCount: insights.length,
              rubricVersion: input.rubricVersion,
            },
          });
          trace.end();
        } catch {
          /* tracing must never break the result */
        } finally {
          flush();
        }
      },
      fail(_error) {
        try {
          generation.update({
            level: "ERROR",
            statusMessage: "judge_failed",
          });
          generation.end();
          trace.update({
            level: "ERROR",
            statusMessage: "judge_failed",
            metadata: {
              result: "failed",
              rubricVersion: input.rubricVersion,
            },
          });
          trace.end();
        } catch {
          /* ignore */
        } finally {
          flush();
        }
      },
    };
  } catch {
    // Any failure building the trace degrades to no-op — assessment proceeds.
    return NOOP_TRACE;
  }
}
