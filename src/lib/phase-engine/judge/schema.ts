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

// The register's vocabulary and its two pure checks. The back-edge is
// TYPE-ONLY (`network-register.ts` imports `Insight` from here), so it is
// erased at build time and no runtime cycle exists.
import {
  findNetworkRegisterViolations,
  findUnpairedNetworkCategories,
} from "./network-register";

import type { RetrievedPassage } from "@/lib/phase-engine/rag";

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
  "cohesion", // CSF-4
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

/**
 * THE OBSERVATION BUDGET (#478, C09/C18): one primary focus + two supplements.
 *
 * Bryan: "I already have 25 things competing for my attention. The value of
 * this tool would be telling me, 'Of everything going on, these are the 1–3
 * things that matter most right now.'" A cap in the PROMPT is a request; a cap
 * in the SCHEMA is a refusal, and an over-budget response is retried rather
 * than stored — which is the difference between a rule and a preference.
 *
 * POSITIVES ARE EXEMPT (D1). The budget is things to do; encouragement is not
 * one of them, and it lands on its own surface. So a model may return three
 * work items and as many positives as the plant has earned.
 *
 * NETWORK INSIGHTS ARE UNCAPPED HERE — that audience's rules are #482's.
 */
export const PLANTER_FOCUS_BUDGET = 3;

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
 * THE RULES A DRAFT IS HELD TO, by name (#605).
 *
 * Every refinement below tags its issue with the rule that raised it, so the
 * retry ladder and the run log can say WHICH rule rejected a draft without
 * pattern-matching the message's prose. The message is what the model is told;
 * the name is what an operator greps for.
 *
 * This array is the only place a rule name exists: `JudgeRule` is derived from
 * it, and `describeDraftRejection` (schema-rejection.ts) checks membership
 * rather than casting, so a tag that stops matching a real rule is a rule the
 * reader is told is unknown instead of one silently mislabelled.
 */
export const JUDGE_RULES = [
  "audience_coverage",
  "observation_budget",
  "network_verdict_register",
  "planter_first_pairing",
] as const;
export type JudgeRule = (typeof JUDGE_RULES)[number];

/** One refinement issue, tagged with the rule that raised it. */
function ruleIssue(rule: JudgeRule, message: string) {
  return {
    code: "custom" as const,
    path: ["insights"],
    message,
    params: { rule },
  };
}

/**
 * The full object the model is constrained to return: a list of insights plus a
 * one-line overall summary.
 *
 * EVERY RULE A DRAFT IS HELD TO IS A REFINEMENT HERE, including audience
 * coverage (PE-012), which used to be a post-parse throw in the pipeline. That
 * split cost a plant its assessment: a rule enforced after the parse is a rule
 * the retry ladder cannot see, so a missing audience was fatal on the first
 * draft while the other three rules were re-prompted (#605). One list of rules,
 * one rejection path, one place to add the next one.
 */
export const judgeOutputSchema = z
  .object({
    /** A single conservative, plain-language read of overall plant health. */
    summary: z.string().min(10).max(600),
    /** The grounded findings. At least one is required. */
    insights: z.array(insightSchema).min(1),
  })
  .superRefine((output, ctx) => {
    // Both audiences must be represented (PE-012). The object shape cannot say
    // "at least one of each", so it is said here.
    if (!hasBothAudiences(output.insights)) {
      ctx.addIssue(
        ruleIssue(
          "audience_coverage",
          "The assessment must include at least one planter AND one network insight (PE-012). One-sided assessments are not stored."
        )
      );
    }

    const work = output.insights.filter(
      (insight) =>
        insight.audience === "planter" && insight.severity !== "positive"
    );

    if (work.length > PLANTER_FOCUS_BUDGET) {
      ctx.addIssue(
        ruleIssue(
          "observation_budget",
          `The planter gets one primary focus and at most ${PLANTER_FOCUS_BUDGET - 1} supplements — ${work.length} actionable planter insights were returned. Positive observations are exempt; everything else belongs in the drill-down.`
        )
      );
    }

    // THE NETWORK REGISTER (#482). Both rules are stated in the rubric, which
    // is what teaches the model; these are what stop a bad response being
    // STORED. A violation fails the parse and the schema ladder re-prompts with
    // the message below, so an insight breaking either rule never reaches a
    // database.
    const verdicts = findNetworkRegisterViolations(output.insights);
    if (verdicts.length > 0) {
      const found = verdicts
        .map((violation) => `"${violation.phrase}" in "${violation.title}"`)
        .join("; ");
      ctx.addIssue(
        ruleIssue(
          "network_verdict_register",
          `Network-audience language must coach, never deliver a verdict. Found ${found}. Name the measured pattern and point at a coaching conversation — "Core-group momentum has slowed. This may be worth a coaching conversation" — never an organisational judgement.`
        )
      );
    }

    const unpaired = findUnpairedNetworkCategories(output.insights);
    if (unpaired.length > 0) {
      ctx.addIssue(
        ruleIssue(
          "planter_first_pairing",
          `The planter must never discover a concern through their overseer. These categories were raised to the network with nothing for the planter on the same concern: ${unpaired.join(", ")}. Different wording for each audience is expected; a concern the planter was never shown is not.`
        )
      );
    }
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
  /**
   * The methodology passages the judge was actually grounded with (PE-024).
   * Carried out of the pipeline so persistence can reconcile the model's
   * `relatedArticleSlugs` against real retrieved metadata rather than trusting
   * the model not to invent a slug. Empty when retrieval returned nothing.
   */
  retrievedPassages: RetrievedPassage[];
}

/**
 * Does this set of insights cover both required audiences (PE-012)?
 * Pure helper, unit-tested, and the body of the `audience_coverage` refinement.
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
