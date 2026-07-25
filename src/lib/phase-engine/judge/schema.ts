// ============================================================================
// Judge output schema (PE-007 / PE-009 / PE-012).
//
// The LLM-as-judge is constrained to emit *exactly* this shape via the Vercel
// AI SDK `generateObject` call (judge/run-assessment.ts). Keeping the schema in
// its own module lets it be unit-tested in isolation (no live LLM call) and
// imported by both the prompt builder and the pipeline.
//
// Design rules baked in:
//   - Every insight must cite the facts that drove it (`citedFacts`) so the
//     reasoning is auditable and grounded in the deterministic snapshot
//     (AC-PE-5 / NFR-PE-1). The judge never invents counts or dates; it only
//     references facts it was given.
//   - Each insight is tagged with an `audience` (planter | network) so the UI
//     can surface planter-facing coaching separately from the conservative,
//     network-facing health read (PE-012, rubric-v0 Part B privacy framing).
//   - `relatedArticleSlugs` link back to the methodology wiki passages the RAG
//     layer supplied, so insights are clickable/citable (PE-008).
// ============================================================================

import { z } from "zod";

/** Who the insight is phrased for (rubric-v0: planter coaching vs. network health). */
export const insightAudienceSchema = z.enum(["planter", "network"]);
export type InsightAudience = z.infer<typeof insightAudienceSchema>;

/**
 * The 8 CSF lenses (rubric-v0 Part A) plus cross-cutting categories the judge
 * uses to classify an insight. Constrains the model to a known vocabulary so
 * the UI can group/route insights without free-text parsing.
 */
export const insightCategorySchema = z.enum([
  "vision_casting", // CSF-1
  "shared_ownership", // CSF-2
  "critical_mass", // CSF-3
  "unity", // CSF-4
  "prayer", // CSF-5
  "generosity", // CSF-6
  "emerging_leadership", // CSF-7
  "comprehensive_training", // CSF-8
  "follow_up",
  "launch_readiness",
  "phase_progress",
  "onboarding", // cold-start guidance (PE-018)
]);
export type InsightCategory = z.infer<typeof insightCategorySchema>;

/** Relative urgency. `positive` is reserved for reinforcing what's going well. */
export const insightSeveritySchema = z.enum([
  "positive",
  "info",
  "watch",
  "urgent",
]);
export type InsightSeverity = z.infer<typeof insightSeveritySchema>;

/** A single grounded assessment finding. */
export const insightSchema = z.object({
  /** Planter-facing coaching vs. conservative network-facing health read. */
  audience: insightAudienceSchema,
  /** Which rubric lens / dimension this insight speaks to. */
  category: insightCategorySchema,
  /** Relative urgency for ordering and UI treatment. */
  severity: insightSeveritySchema,
  /** Short, scannable headline (no invented numbers). */
  title: z.string().min(3).max(140),
  /** The full insight: the observation + the recommended next step. */
  body: z.string().min(10).max(1200),
  /**
   * The exact snapshot facts that drove this insight (e.g.
   * "coreGroup.committedCount=22", "launch.daysUntilLaunch=112"). Must be
   * non-empty — an insight with no cited fact is, by contract, ungrounded.
   */
  citedFacts: z.array(z.string().min(1)).min(1),
  /**
   * Wiki article slugs (from the supplied RAG passages) that back the advice.
   * Always present; the model returns an empty array when no passage was
   * relevant. NOT `.optional()`/`.default()` — OpenAI strict structured output
   * requires every property to be in `required`, so the key must always be
   * emitted (an empty array is allowed).
   */
  relatedArticleSlugs: z.array(z.string().min(1)),
});
export type Insight = z.infer<typeof insightSchema>;

/**
 * The full object the model is constrained to return: a list of insights plus a
 * one-line overall summary. Audience coverage (both planter AND network) is a
 * product requirement (PE-012) enforced in the pipeline rather than the schema,
 * so a missing audience fails loudly with a clear, actionable error rather than
 * a generic Zod parse failure.
 */
export const judgeOutputSchema = z.object({
  /** A single conservative, plain-language read of overall plant health. */
  summary: z.string().min(10).max(600),
  /** The grounded findings. At least one is required. */
  insights: z.array(insightSchema).min(1),
});
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

/**
 * The pipeline's public return type: the validated model output plus the audit
 * metadata the caller persists (PE-006 / AC-PE-4 — rubric version is recorded
 * alongside every assessment).
 */
export interface AssessmentResult extends JudgeOutput {
  /** Version string of the rubric that produced this assessment (e.g. "v0"). */
  rubricVersion: string;
  /** The judge model id of record (for audit + tracing). */
  modelId: string;
  /** Snapshot-shape version the judge reasoned over. */
  snapshotVersion: string;
  /** The phase the plant was in at assessment time. */
  phase: number;
  /** ISO timestamp the assessment completed. */
  assessedAt: string;
}

/**
 * Does this set of insights cover both required audiences (PE-012)?
 * Pure helper, unit-tested, reused by the pipeline to assert coverage.
 */
export function hasBothAudiences(insights: Insight[]): boolean {
  let planter = false;
  let network = false;
  for (const i of insights) {
    if (i.audience === "planter") planter = true;
    else if (i.audience === "network") network = true;
    if (planter && network) return true;
  }
  return false;
}
