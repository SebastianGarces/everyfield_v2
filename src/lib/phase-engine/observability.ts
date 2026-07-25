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

import { Langfuse } from "langfuse";
import type { Insight } from "./judge/schema";

/** Inputs recorded at the start of a traced judge run. */
export interface JudgeTraceInput {
  churchId: string;
  phase: number;
  rubricVersion: string;
  modelId: string;
  snapshotVersion: string;
  systemPrompt: string;
  userPrompt: string;
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
 * True only when all required Langfuse env vars are present. We never partially
 * initialize — missing config means tracing is simply off.
 */
function isLangfuseConfigured(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
  );
}

// Lazily-constructed singleton client. Constructed only once, and only when
// Langfuse is configured — keeping the happy path (no Langfuse) allocation-free.
let cachedClient: Langfuse | undefined;
let clientInitFailed = false;

function getClient(): Langfuse | undefined {
  if (clientInitFailed) return undefined;
  if (cachedClient) return cachedClient;
  try {
    cachedClient = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL,
    });
    return cachedClient;
  } catch {
    // Constructor threw — degrade to no-op for the rest of the process.
    clientInitFailed = true;
    return undefined;
  }
}

/**
 * Start a judge trace. Returns a {@link JudgeTrace} handle. When Langfuse is not
 * configured (or anything goes wrong constructing the client / trace), returns
 * the no-op handle so the caller's code path is identical either way.
 *
 * The trace is tagged with the rubric version and model id (NFR-PE-5).
 */
export function startJudgeTrace(input: JudgeTraceInput): JudgeTrace {
  if (!isLangfuseConfigured()) return NOOP_TRACE;

  const client = getClient();
  if (!client) return NOOP_TRACE;

  try {
    // Type the slice of the Langfuse surface we use, narrowly + defensively, so
    // we never couple to the full SDK type (which shifts across versions).
    const lf = client as unknown as {
      trace: (args: unknown) => {
        generation: (args: unknown) => {
          end: (args: unknown) => void;
        };
        update: (args: unknown) => void;
      };
      flushAsync?: () => Promise<unknown>;
    };

    const trace = lf.trace({
      name: "phase-engine.assessment",
      tags: [`rubric:${input.rubricVersion}`, `model:${input.modelId}`],
      metadata: {
        churchId: input.churchId,
        phase: input.phase,
        rubricVersion: input.rubricVersion,
        modelId: input.modelId,
        snapshotVersion: input.snapshotVersion,
      },
    });

    const generation = trace.generation({
      name: "judge.generateObject",
      model: input.modelId,
      input: {
        system: input.systemPrompt,
        user: input.userPrompt,
      },
      metadata: { rubricVersion: input.rubricVersion },
    });

    const flush = () => {
      // Fire-and-forget; never await in the request path, never throw.
      try {
        lf.flushAsync?.()?.catch(() => {});
      } catch {
        /* ignore */
      }
    };

    return {
      succeed(insights, usage) {
        try {
          generation.end({
            output: insights,
            usage: usage
              ? {
                  input: usage.inputTokens,
                  output: usage.outputTokens,
                  total: usage.totalTokens,
                }
              : undefined,
          });
          trace.update({ output: { insightCount: insights.length } });
        } catch {
          /* tracing must never break the result */
        } finally {
          flush();
        }
      },
      fail(error) {
        try {
          generation.end({
            level: "ERROR",
            statusMessage:
              error instanceof Error ? error.message : String(error),
          });
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
