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
  NETWORK_VERDICT_PHRASES,
} from "./network-register";

import {
  EVIDENCE_LENSES,
  type EvidenceLens,
  type EvidenceProfile,
} from "@/lib/phase-engine/signals/evidence";
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
  "unknown_lens_not_healthy",
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
 * The shape alone — a list of insights plus a one-line overall summary. Nothing
 * calls this directly; {@link judgeOutputSchemaFor} is the schema, and the type
 * below is inferred from the shape because a refinement does not change it.
 */
const judgeOutputShape = z.object({
  /** A single conservative, plain-language read of overall plant health. */
  summary: z.string().min(10).max(600),
  /** The grounded findings. At least one is required. */
  insights: z.array(insightSchema).min(1),
});
export type JudgeOutput = z.infer<typeof judgeOutputShape>;

/** Is this insight category one of the eight lenses the profile speaks for? */
function lensOf(category: InsightCategory): EvidenceLens | null {
  return (EVIDENCE_LENSES as readonly string[]).includes(category)
    ? (category as EvidenceLens)
    : null;
}

/**
 * The full object the model is constrained to return, held to the rules THIS
 * PLANT's facts make available.
 *
 * A FUNCTION OF THE EVIDENCE PROFILE, and there is deliberately no snapshot-free
 * spelling of this schema (#635). "Unknown is not healthy" cannot be asked of a
 * draft without knowing what each lens knows, and the version of this file that
 * had a constant schema is the version where that rule lived in rubric prose
 * only — a request the model could talk itself out of on the one plant where it
 * matters most. A cold-start plant was told its vision casting was GOING WELL,
 * on the evidence line "based on no activity recorded yet".
 *
 * EVERY RULE A DRAFT IS HELD TO IS A REFINEMENT HERE, including audience
 * coverage (PE-012), which used to be a post-parse throw in the pipeline. That
 * split cost a plant its assessment: a rule enforced after the parse is a rule
 * the retry ladder cannot see, so a missing audience was fatal on the first
 * draft while the other three rules were re-prompted (#605). One list of rules,
 * one rejection path, one place to add the next one.
 */
export function judgeOutputSchemaFor(evidence: EvidenceProfile) {
  return judgeOutputShape.superRefine((output, ctx) => {
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
    const unpaired = findUnpairedNetworkCategories(output.insights);

    // THE LENSES THAT KNOW NOTHING, read once because three of the messages
    // below have to agree about them (#635). The free-pairing device — pair a
    // network concern with a "positive" planter insight, which the budget does
    // not count — is illegal in exactly these categories, and a message that
    // recommends it there sends the model at a rule that will refuse it.
    const blind = EVIDENCE_LENSES.filter(
      (lens) => evidence[lens].quality === "unknown"
    );
    const blindList = blind.join(", ");

    if (work.length > PLANTER_FOCUS_BUDGET) {
      ctx.addIssue(
        ruleIssue(
          "observation_budget",
          `The planter gets one primary focus and at most ${PLANTER_FOCUS_BUDGET - 1} supplements — ${work.length} actionable planter insights were returned. Positive observations are exempt; everything else belongs in the drill-down.` +
            // THE TWO RULES LOOK LIKE THEY PULL AGAINST EACH OTHER AND ONLY
            // THIS FUNCTION CAN SEE THAT THEY DO NOT (#605). Pairing wants a
            // planter insight in every network concern's category; the budget
            // counts only NON-POSITIVE planter insights. So a positive planter
            // insight pairs a network concern for free, and the two rules never
            // actually collide. A model told about each separately cannot know
            // that: EVAL-05 softened its verdict language, came back over
            // budget, dropped a planter item, and came back unpaired. The way
            // out is stated here, where both counts are in hand.
            (unpaired.length > 0
              ? ` The pairing rule failed too, and the two are not in conflict: this budget counts only NON-POSITIVE planter insights, so pairing a network concern with a "positive" planter insight in the same category costs nothing against it. Reach for that before dropping anything.` +
                // …EXCEPT WHERE THE LENS KNOWS NOTHING (#635). A "positive"
                // insight there is refused outright, so recommending the free
                // device in a blind category walks the model into the other
                // rule — the same two-rule ping-pong this paragraph exists to
                // stop, one lens over.
                (blind.length > 0
                  ? ` The one place that device is unavailable: ${blindList} have nothing measured and nothing attested, so NO "positive" insight may sit in them. Pair a concern there with an "info" insight — which DOES take one of your three slots — or raise it under a cross-cutting category instead.`
                  : "")
              : "")
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
          // THE WHOLE BAN-LIST, NOT JUST THE WORD THAT WAS CAUGHT (#605). The
          // message used to name only the phrase found, so a corrected draft
          // dropped that one and reached for the next entry: EVAL-09, the
          // fleet's most troubled plant, spent all three drafts swapping one
          // banned word for another. Interpolated from `NETWORK_VERDICT_PHRASES`
          // rather than retyped, which is the same rule the rubric body follows
          // (#538) and for the same reason — a hand-kept second copy went short
          // by two phrases and the judge was rejected for a word it was never
          // shown.
          `Network-audience language must coach, never deliver a verdict. Found ${found}. NONE of these phrases may appear in network-audience text, so swapping the one above for another of them will be rejected again: ${NETWORK_VERDICT_PHRASES.join(", ")}. Name the measured pattern and point at a coaching conversation — "Core-group momentum has slowed. This may be worth a coaching conversation" — never an organisational judgement.`
        )
      );
    }

    if (unpaired.length > 0) {
      // BOTH SIDES OF THE COMPARISON, AND THE WAYS OUT (#605). The message used
      // to name only the offending categories, and EVAL-11 broke this rule on
      // three drafts running: it could see what was wrong and kept guessing at
      // the remedy, rewriting the network insight instead of pairing it. A model
      // cannot close a gap it is shown one side of, so the planter's categories
      // are listed too and the two legal fixes are named.
      const planterCategories = [
        ...new Set(
          output.insights
            .filter((insight) => insight.audience === "planter")
            .map((insight) => insight.category)
        ),
      ].sort();

      ctx.addIssue(
        ruleIssue(
          "planter_first_pairing",
          `The planter must never discover a concern through their overseer. These categories were raised to the network with nothing for the planter on the same concern: ${unpaired.join(", ")}. Your planter insights currently cover: ${planterCategories.join(", ") || "(none)"}. Fix it one of two ways: ADD a planter insight in each missing category (any severity counts, including "positive"), or, if it is not really a concern, mark the network insight "positive" or drop it. Different wording for each audience is expected; a concern the planter was never shown is not.` +
            // BOTH OF THOSE OUTS NAME "positive", AND BOTH ARE CLOSED ON A
            // BLIND LENS (#635) — for either audience, since an overseer reads
            // the same eight tiles the planter does. Say so here rather than
            // letting the model discover it as a second rejection.
            (blind.length > 0
              ? ` Note: ${blindList} have nothing measured and nothing attested, so neither out may use "positive" there — for either audience. In those categories, pair with an "info" insight or drop the network concern.`
              : "")
        )
      );
    }

    // UNKNOWN IS NOT HEALTHY (#483 C17, enforced by #635). The rubric has said
    // this since v1 shipped — "for an unknown lens, produce at most an
    // insufficient-evidence statement, never a quiet pass, a blank, or an
    // encouraging remark" — and prose is where it stayed. Seven lenses obeyed
    // it on the cold-start plant and the eighth did not, which is what a rule
    // with nothing behind it looks like: it holds until the one plant where the
    // model has nothing else to say.
    //
    // A "positive" severity is a VERDICT, and the scorecard renders it as the
    // words GOING WELL over the lead insight's own evidence line. On a lens with
    // nothing measured and nothing attested, the only line available is the
    // absence itself, so the tile read "Going well · Based on no activity
    // recorded yet". THAT SENTENCE IS NOW UNWRITABLE: `isColdStart` is true only
    // when every signal block is empty (build-fact-snapshot.ts), which makes
    // every one of the eight lenses `unknown`, which this rule refuses to let a
    // positive insight land in.
    //
    // ONLY THE POSITIVE BAND. A lens the engine cannot see may still be spoken
    // about — "we don't have enough information to assess prayer yet" is the
    // sentence #483 exists to produce, and it is severity "info". Refusing that
    // too would trade a false pass for the blank it replaced.
    const unhealthy = output.insights.filter((insight) => {
      const lens = lensOf(insight.category);
      return (
        insight.severity === "positive" &&
        lens !== null &&
        evidence[lens].quality === "unknown"
      );
    });

    if (unhealthy.length > 0) {
      // BOTH SIDES AND THE WAY OUT, the shape #605 settled on: the lenses that
      // know nothing, the insights that claimed otherwise, and the severity to
      // reach for instead. The way out is stated at its REAL price — an "info"
      // insight pairs a network concern just as well as a "positive" one, but
      // it is not exempt from the observation budget the way a positive is, and
      // a message that says otherwise walks the model into a budget rejection
      // that then recommends the positive this rule refuses.
      const claimed = unhealthy
        .map((insight) => `"${insight.title}" (${insight.category})`)
        .join("; ");

      ctx.addIssue(
        ruleIssue(
          "unknown_lens_not_healthy",
          `Absence of evidence is not evidence of health. These lenses have nothing measured and nothing attested for this plant, so they are UNKNOWN: ${blindList}. A "positive" insight in an unknown lens is a verdict resting on an absence, and is not stored: ${claimed}. For an unknown lens produce at most an insufficient-evidence statement at severity "info" — "we don't have enough information to assess this yet" — or leave the lens out of the assessment entirely. Never cite the absence itself as the basis for an encouraging read. If one of these was pairing a network concern, an "info" insight pairs it just as well — but unlike a "positive" one it DOES take one of your three planter focus slots, so drop something else or raise the concern under a cross-cutting category (onboarding, follow_up, launch_readiness, phase_progress), which this rule does not touch.`
        )
      );
    }
  });
}

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
