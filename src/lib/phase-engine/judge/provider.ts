// ============================================================================
// Judge model provider seam (NFR-PE-5).
//
// The LLM-as-judge's chat model lives behind this single module so the
// provider/model is a ONE-LINE swap (FRD §10 "provider stays behind a module
// for one-line swaps"). The pipeline (run-assessment.ts) never names a model
// or imports a provider SDK directly — it asks here for `getJudgeModel()` and
// records `JUDGE_MODEL_ID`. Mirrors the embedding seam in `rag/embed.ts`.
//
// Today: OpenAI `gpt-4o` via the Vercel AI SDK v6 — strong enough to follow the
// rubric and the planter+network dual-audience contract (PE-012), and in line
// with the FRD's ~$0.03–0.05/assessment estimate. (`gpt-4o-mini` was too weak:
// it intermittently returned only one audience and tripped the pipeline guard.)
// To swap providers, change the two lines below — nothing downstream references
// the concrete model.
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * The judge model id of record. Recorded on every assessment and Langfuse trace
 * so an audit can tie an insight back to the exact model that produced it.
 */
export const JUDGE_MODEL_ID = "gpt-4o" as const;

/**
 * Resolve the judge model. Created lazily so importing this module (or the
 * schema/prompt helpers that sit beside it) never throws when the key is absent
 * — only an actual assessment run requires the key (tests stay LLM-free).
 */
export function getJudgeModel(): LanguageModel {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set — required to run a Plant Intelligence assessment."
    );
  }
  // Single swap point: change provider + model here and nowhere else.
  return createOpenAI({ apiKey })(JUDGE_MODEL_ID);
}
