// ============================================================================
// The LLM-as-judge pipeline (PE-007 / PE-009 / PE-012 / AC-PE-4 / AC-PE-5 /
// NFR-PE-1 / NFR-PE-5).
//
// A plain-TypeScript pipeline (no React, no DB writes): it takes a deterministic
// fact snapshot + the plant's current phase, loads the active rubric WHOLE,
// retrieves phase-relevant methodology passages, makes a validated
// `generateObject` call (Zod-constrained to the insight shape), and returns a
// structured, audited assessment.
//
// TWO LADDERS SIT AROUND THAT CALL AND THEY ANSWER DIFFERENT QUESTIONS (#605):
//   - `runPacedCall` (#36) owns the PROVIDER — a 429 waits for Retry-After, a
//     5xx backs off, and the same prompt is sent again because the prompt was
//     never the problem.
//   - the loop below owns the OUTPUT — a draft rejected by the judge's own
//     rules is re-prompted WITH the rule it broke, because sending the same
//     prompt again just draws the same mistake. It used to do exactly that,
//     four times, and then record the plant `failed`.
//
// Hard guarantees:
//   - The judge consumes a snapshot; it NEVER recomputes facts (it doesn't even
//     import buildFactSnapshot — the snapshot is passed in).
//   - The model is constrained to the schema `judgeOutputSchemaFor` builds for
//     THIS plant; the result is valid by construction, INCLUDING every product
//     rule — audience coverage, the observation budget, the network register
//     and "unknown is not healthy" are all refinements on that schema, so
//     nothing this file returns has skipped one.
//   - The active rubric version is recorded on the result (changing the rubric
//     version changes the recorded version — AC-PE-4).
//   - Every run is traced in Langfuse when configured, and silently no-ops when
//     not (NFR-PE-5) — tracing never blocks or breaks the assessment.
// ============================================================================

import { generateObject, type LanguageModel } from "ai";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";
import { buildEvidenceProfile } from "@/lib/phase-engine/signals/evidence";
import { retrieve, type RetrievedPassage } from "@/lib/phase-engine/rag";
import { ACTIVE_RUBRIC, type Rubric } from "@/lib/phase-engine/rubric";
import { startJudgeTrace } from "@/lib/phase-engine/observability";
import { getJudgeModel, JUDGE_MODEL_ID } from "./provider";
import { runPacedCall, type RateLimitEvent } from "./paced-call";
import { TokenPacer } from "./token-pacer";
import {
  buildRetrievalQuery,
  buildSystemPrompt,
  buildUserPrompt,
} from "./prompt";
import {
  carryCorrectionForward,
  describeDraftRejection,
  SchemaRejectionError,
  type DraftCorrection,
  type SchemaRejectionEvent,
} from "./schema-rejection";
import { judgeOutputSchemaFor, type AssessmentResult } from "./schema";

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
  /**
   * The token budget this call must queue behind (#36). The cron batch creates
   * ONE pacer for the whole run and threads it through every plant, so the
   * plants share a TPM window instead of racing each other into a 429. Omitted
   * (a manual, single-plant assessment) means a throwaway bucket that starts
   * full — so a one-off run never waits.
   */
  pacer?: TokenPacer;
  /** Attempts, including the first, before a rate limit becomes a deferral. */
  maxAttempts?: number;
  /** Called on every 429, so throttling can be logged apart from failure. */
  onRateLimit?: (event: RateLimitEvent) => void;
  /**
   * Drafts, including the first, before a rejected response becomes a failure.
   * Bounded and separate from `maxAttempts` on purpose (#605): that budget is
   * for a provider that will not talk to us, this one is for a provider that
   * will not follow a rule.
   */
  maxSchemaAttempts?: number;
  /** Called on every rejected draft, so a retry is logged apart from failure. */
  onSchemaRejection?: (event: SchemaRejectionEvent) => void;
  /**
   * Instant (on the pacer's clock) past which the retry ladder must stand down
   * rather than keep holding for the TPM window. The cron batch passes its run
   * deadline so an in-plant retry can never outlive the function (#36). It
   * bounds BOTH ladders: a re-prompt is a fresh provider call, so three of them
   * inside one plant can walk a run past its budget as surely as a TPM hold.
   */
  deadlineAt?: number;
  /**
   * Override the judge model. A test seam, like `passages` — it lets the retry
   * ladder be driven against scripted drafts with no live provider. Production
   * omits it and gets `getJudgeModel()`.
   */
  model?: LanguageModel;
}

const DEFAULT_RETRIEVAL_LIMIT = 8;

/**
 * Drafts before a rejected response is a failed assessment.
 *
 * Three, not more: the rejection rate measured in #605 was roughly one draft in
 * four, and the re-prompt names the rule that rejected the last one, so a third
 * draft failing means something is wrong with the rubric or the plant's facts
 * rather than with this draft. More attempts would spend a plant's tokens and
 * the run's clock arguing with that.
 */
const DEFAULT_MAX_SCHEMA_ATTEMPTS = 3;

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
  // A throwaway bucket starts full, so a manual one-off assessment never waits;
  // the cron batch passes its shared one in (#36).
  const pacer = options.pacer ?? new TokenPacer();

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
  //    in the user message). `prompt` is rebuilt per draft: a retry carries the
  //    rule that rejected the previous one (step 5).
  const system = buildSystemPrompt(rubric);

  // WHAT EACH LENS KNOWS, COMPUTED ONCE AND USED FOR BOTH HALVES (#635). It is
  // recomputed rather than read off `snapshot.evidence` for #483's D1 reason —
  // the profile is derived from the facts beside it, so a snapshot written
  // before that field existed still gets a real one — and the SAME value then
  // grounds the prompt and holds the draft. Judging a model against a profile
  // it was never shown is the shape #538 bans: the fact ledger flattens
  // `evidence.<lens>.quality` out of the snapshot and the rubric tells the
  // model to read exactly those keys, so a stale stored profile would have the
  // judge told one thing and refused for another, with no way to see the gap.
  const evidence = buildEvidenceProfile(snapshot);
  const grounded: PlantFactSnapshot = { ...snapshot, evidence };
  const schema = judgeOutputSchemaFor(evidence);

  let prompt = buildUserPrompt(grounded, passages);

  // 3. Start tracing (no-op when Langfuse is unconfigured), tagged with rubric
  //    version + model id. The trace records what the run STARTED from; a
  //    re-prompt is reported through `onSchemaRejection`.
  const trace = startJudgeTrace({
    phase,
    rubricVersion: rubric.version,
    modelId: JUDGE_MODEL_ID,
    snapshotVersion: snapshot.snapshotVersion,
  });

  // Everything earlier drafts broke, carried forward (see the catch below).
  let correction: DraftCorrection | null = null;

  const maxSchemaAttempts = Math.max(
    1,
    options.maxSchemaAttempts ?? DEFAULT_MAX_SCHEMA_ATTEMPTS
  );

  try {
    // 4. THE SCHEMA LADDER (#605), outside the throttle ladder and bounded
    //    separately. Each turn is one validated `generateObject` call made under
    //    the run's shared TPM budget (#36): `runPacedCall` waits its turn on the
    //    bucket, honours Retry-After on a 429, and feeds the response's
    //    `x-ratelimit-*` headers back so the batch re-paces itself — but it
    //    stands down on a REJECTED DRAFT, because repeating a prompt cannot fix
    //    a response that broke a rule. Correcting it is this loop's job.
    for (let attempt = 1; ; attempt++) {
      const draftPrompt = prompt;
      try {
        const { object, usage } = await runPacedCall(
          async () => {
            const generated = await generateObject({
              model: options.model ?? getJudgeModel(),
              schema,
              system,
              prompt: draftPrompt,
              // The retry policy lives in this file and `runPacedCall`, not in
              // the SDK. The SDK's 2s/4s exponential backoff retries INSIDE the
              // same TPM minute that just refused us, so all three attempts are
              // spent before the budget could possibly have refilled — which is
              // how #36 lost plants.
              maxRetries: 0,
              // NFR-PE-4: do not let OpenAI retain this call. The AI SDK's
              // OpenAI provider resolves `openai(modelId)` to the **Responses
              // API**, which stores prompts and completions in the org's logs by
              // default — the SDK itself defaults `store` to `true`. Plant data
              // is real church data, so it is opted out explicitly here rather
              // than relying on a dashboard toggle, which does not travel with
              // the code, the key, or a new project.
              providerOptions: { openai: { store: false } },
            });
            return {
              value: { object: generated.object, usage: generated.usage },
              headers: generated.response?.headers,
              totalTokens: generated.usage?.totalTokens,
            };
          },
          {
            pacer,
            maxAttempts: options.maxAttempts,
            label: snapshot.churchId,
            onRateLimit: options.onRateLimit,
            deadlineAt: options.deadlineAt,
          }
        );

        trace.succeed(object.insights, {
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          totalTokens: usage?.totalTokens,
        });

        // The output is valid by construction — every rule the assessment is
        // held to is a refinement on this plant's schema, so reaching here means
        // all of them passed. Attach the audit metadata; the rubric version
        // recorded is the version that produced it (AC-PE-4).
        return {
          ...object,
          rubricVersion: rubric.version,
          modelId: JUDGE_MODEL_ID,
          snapshotVersion: snapshot.snapshotVersion,
          phase,
          assessedAt: new Date().toISOString(),
          // The passages that actually grounded this run (PE-024). Persistence
          // reconciles the model's cited slugs against this metadata.
          retrievedPassages: passages,
        };
      } catch (error) {
        // 5. A rejected draft, or somebody else's failure. `describeDraftRejection`
        //    is the branch test AND the description: null means a 429 deferral,
        //    a 5xx, or a broken write, none of which a re-prompt can help.
        const rejection = describeDraftRejection(error);
        if (!rejection) throw error;

        // A re-prompt is a whole extra provider call, so the run's clock bounds
        // this ladder as well as the throttle one (#375's lesson, second half):
        // three drafts inside one plant would otherwise be invisible to the run
        // budget that only projects the NEXT plant.
        const outOfBudget =
          options.deadlineAt !== undefined &&
          pacer.clock.now() + pacer.projectedWaitMs() >= options.deadlineAt;
        const exhausted = attempt >= maxSchemaAttempts || outOfBudget;

        options.onSchemaRejection?.({
          label: snapshot.churchId,
          attempt,
          maxAttempts: maxSchemaAttempts,
          rules: rejection.rules,
          issues: rejection.issues,
          exhausted,
        });

        if (exhausted) {
          throw new SchemaRejectionError(
            snapshot.churchId,
            attempt,
            rejection,
            error,
            outOfBudget ? "run_budget" : "attempts_exhausted"
          );
        }

        // Every rule broken SO FAR goes back, not just this draft's. A model
        // holding only the newest message fixes it by breaking the rule it was
        // corrected on two drafts ago, and the ladder runs out while each draft
        // was an honest attempt at what it was last told (#605).
        correction = carryCorrectionForward(correction, rejection);
        prompt = buildUserPrompt(grounded, passages, correction);
      }
    }
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
