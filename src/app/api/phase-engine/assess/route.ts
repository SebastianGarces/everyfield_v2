// ============================================================================
// Scheduled: dirty-or-stale assessment runner (NFR-PE-2 / AC-PE-8 / PE-010).
//
// Ticked twice daily (07:00 and 19:00 UTC) by
// `.github/workflows/phase-engine-assess.yml` — NOT by a Vercel cron; see the
// cadence note below. Selects the plants that are
// dirty-or-stale via the orchestrator's selection query and runs
// `generateAssessment` for each, bounded, sequential and PACED so:
//   - quiet plants are skipped (no material event since last assessment),
//   - each plant runs at most ~once/day with a max-staleness floor (NFR-PE-2),
//   - one slow plant cannot blow the function timeout (the batch is capped and
//     runs one-at-a-time; remaining plants roll over to the next run),
//   - the batch stays inside the OpenAI TPM ceiling instead of tripping it and
//     losing plants to 429s (#36).
//
// Security: guarded by a CRON_SECRET bearer token. The request must carry
// `Authorization: Bearer <CRON_SECRET>` — this is the header Vercel Cron sends
// when `CRON_SECRET` is set in the project's environment variables. CRON_SECRET
// MUST be set both locally (.env / .env.local) and in the Vercel project env.
// The comparison is CONSTANT-TIME (#266) and shared with
// `/api/notifications/dispatch`: the same secret opens both routes, so a timing
// oracle on either one leaks the key to both. See
// `src/lib/security/constant-time.ts`.
//
// There are NO per-pageview LLM calls anywhere — assessments only run here (or
// via an explicit manual trigger). `generateAssessment` makes a real OpenAI
// call per plant, so the batch is intentionally bounded.
//
// ---------------------------------------------------------------------------
// Pacing arithmetic (#36) — why MAX_BATCH is what it is
// ---------------------------------------------------------------------------
// One assessment costs ~13.5k tokens (whole rubric + fact ledger + up to 8
// retrieved passages + structured output) against a 30k TPM key. The bucket
// refills at 30000/60s = 500 tokens/s, and a run starts against an unspent
// window, so N plants can only start once the budget for them exists:
//
//     tokens(N) = 13500N            must satisfy  13500N ≤ 30000 + 500·t
//     t(N)      = (13500N - 30000) / 500  =  27N - 60   seconds
//     total(N)  = t(N) + one call's latency (~10s)
//
// Against the 300s function ceiling, with a 270s soft budget (10% headroom for
// selection, the DB writes and the event bus):
//
//     N = 10 → 210 + 10 = 220s   ✅
//     N = 11 → 237 + 10 = 247s   ✅
//     N = 12 → 264 + 10 = 274s   ❌ over the soft budget
//
// 11 is the true maximum, so MAX_BATCH = 10 — one whole call of headroom,
// because judge latency is the variable nobody controls.
//
// The old MAX_BATCH of 25 needed 27×25 − 60 + 10 = 625s: more than twice the
// ceiling, which is exactly why the tail of every batch was lost.
//
// None of those constants are load-bearing at runtime: RUN_BUDGET_MS is the
// real guard, and the pacer re-derives the ceiling and the per-call cost from
// the provider's own `x-ratelimit-*` headers, so a tier upgrade to 150k TPM
// makes the batch five times faster with no code change (the budget stop then
// lets all 10 through in ~60s). MAX_BATCH is the hard ceiling for the tier we
// are actually on.
//
// ---------------------------------------------------------------------------
// Cadence (#36, ruled 2026-08-09) — why the schedule moved out of vercel.json
// ---------------------------------------------------------------------------
// MAX_BATCH=10 against a ~10-15 plant alpha cohort means one tick a day cannot
// clear the cohort, and the fix is frequency, not a bigger batch: the batch
// size is pinned by the arithmetic above and raising it just gets the tail
// killed by the function timeout instead of the cap.
//
// The Hobby plan accepts at most ONE cron invocation per day per job and
// REJECTS anything more frequent — the deployment fails with it, it is not
// throttled. So a twice-daily schedule cannot live in vercel.json at all. It is
// a GitHub Actions schedule instead, exactly like `/api/notifications/dispatch`
// (ruled 2026-07-27). vercel.json now declares no crons: two schedulers for one
// route would double the token spend and race each other's pacer windows, so
// the Actions tick is the SINGLE driver.
//
// Two ticks × 10 plants covers 15 plants a day with headroom, and the
// oldest-assessed-first ordering below decides who rides in which tick.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";

import {
  generateAssessment,
  selectPlantsForAssessment,
  type SelectedPlant,
} from "@/lib/phase-engine/assessment";
import {
  isRateLimitDeferral,
  TokenPacer,
  type RateLimitEvent,
} from "@/lib/phase-engine/judge";
import { matchesBearerSecret } from "@/lib/security/constant-time";

// This runner orchestrates real LLM calls and DB writes — never cache it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The function's own ceiling. Stated here rather than inherited so the batch
 * arithmetic above and the platform agree in one place.
 */
export const maxDuration = 300;

/**
 * Max number of plants assessed in a single cron run. Derived from the pacing
 * arithmetic in the header comment: at 30k TPM and ~13.5k tokens per
 * assessment, 10 plants fill the 300s function budget. Plants beyond the cap
 * remain dirty/stale and are picked up on the next run.
 */
export const MAX_BATCH = 10;

/**
 * Hard-ish wall-clock deadline for one run — 90% of `maxDuration`.
 *
 * Two guards share this instant, and BOTH are needed:
 *
 *   1. the loop below stops STARTING a plant once the projected pacing wait
 *      would cross it;
 *   2. `runPacedCall` stops RETRYING inside a plant on the same test.
 *
 * Guard 1 alone is not enough, and that was the #36 rework: once a plant has
 * started, the retry ladder can add `MAX_ATTEMPTS_PER_PLANT - 1` further pacer
 * holds, each up to a whole TPM window (60s at 30k), entirely outside a budget
 * that only reserved 30s. A second consumer on the same OPENAI_API_KEY (RAG
 * embeddings, the manual trigger, a second cron tick) drains the window mid-run
 * and makes that ladder real: measured 382s against a 300s ceiling.
 *
 * With guard 2 in place the worst case past the deadline is ONE in-flight call
 * — every sleep in the run is deadline-bounded, so only the latency of the last
 * request can overshoot. 300 - 270 = 30s of headroom for one judge call, which
 * is why 270_000 is the right number and not a hopeful one. `MAX_SINGLE_WAIT_MS`
 * caps any single pacer hold at 120s on BOTH branches so an absurd Retry-After
 * hint cannot sleep through the ceiling either.
 *
 * The run therefore always returns a summary instead of being killed mid-plant
 * (a killed run leaves a `pending` row nobody flips to `failed`); the plants it
 * stood down on are `deferred`, stay dirty, and roll over.
 */
export const RUN_BUDGET_MS = 270_000;

/** Attempts per plant, including the first, before a 429 becomes a deferral. */
export const MAX_ATTEMPTS_PER_PLANT = 4;

/** Why a selected plant was not attempted in this run. */
export type DeferralReason = "rate_limit" | "time_budget";

/** Per-plant outcome, surfaced in the response body for observability. */
export interface AssessOutcome {
  churchId: string;
  reason: SelectedPlant["reason"];
  /**
   * `deferred` is NOT a failure: the provider throttled us, or the run ran out
   * of wall clock. The plant keeps its last good snapshot, stays dirty, and is
   * re-selected next run. Keeping it out of `failed` is the point — a
   * throttled run must not read as a broken judge (#36).
   */
  status: "assessed" | "failed" | "deferred";
  deferralReason?: DeferralReason;
  error?: string;
}

/** Summary of a single cron run. */
export interface AssessRunSummary {
  selected: number;
  attempted: number;
  assessed: number;
  failed: number;
  /** Selected, over the cap, never attempted. */
  skipped: number;
  /** Attempted-or-reached but stood down: throttled or out of time. */
  deferred: number;
  /** Subset of `deferred` caused by provider throttling. */
  rateLimited: number;
  /** Milliseconds this run spent waiting on the token bucket. */
  pacedWaitMs: number;
  /** The TPM ceiling the run actually paced against (header-derived). */
  tpmLimit: number;
  /** The per-call token cost the pacer learned from the provider's usage. */
  tokensPerAssessment: number;
  outcomes: AssessOutcome[];
}

/** Seams so the batch runner can be exercised without a live DB/LLM in tests. */
export interface RunAssessmentBatchDeps {
  selectPlantsForAssessment: typeof selectPlantsForAssessment;
  generateAssessment: typeof generateAssessment;
  maxBatch: number;
  /** The run's shared token budget. Defaults to a fresh real-clock pacer. */
  pacer?: TokenPacer;
  /** Wall clock for the run budget. Defaults to the pacer's clock. */
  now?: () => number;
  /** Soft wall-clock budget for the whole run. */
  runBudgetMs?: number;
  maxAttempts?: number;
}

const DEFAULT_DEPS: RunAssessmentBatchDeps = {
  selectPlantsForAssessment,
  generateAssessment,
  maxBatch: MAX_BATCH,
};

/**
 * Select dirty-or-stale plants and (re-)assess each, bounded, sequential and
 * paced against the provider's TPM ceiling.
 *
 * Quiet, recently-assessed plants are never returned by the selection query, so
 * they are never re-assessed (PE-010). The batch is capped at `maxBatch`; any
 * plants past the cap are logged as skipped and left for the next run.
 *
 * Three ways a plant can come out of this loop, and they are deliberately NOT
 * the same thing:
 *   - `assessed` — the judge ran and persisted.
 *   - `failed`   — the judge or persistence broke. `generateAssessment` already
 *                  marked the row `failed` without touching the last good
 *                  snapshot; the run continues to the next plant.
 *   - `deferred` — the provider throttled us past our retries, or the run's
 *                  wall-clock budget ran out. Nothing is broken. The plant is
 *                  still dirty and comes back next run.
 *
 * Rollover is identical in all three non-assessed cases (selection joins on the
 * latest COMPLETE assessment), so a deferral costs staleness, never data.
 */
export async function runAssessmentBatch(
  deps: RunAssessmentBatchDeps = DEFAULT_DEPS
): Promise<AssessRunSummary> {
  const pacer = deps.pacer ?? new TokenPacer();
  const now = deps.now ?? (() => pacer.clock.now());
  const runBudgetMs = deps.runBudgetMs ?? RUN_BUDGET_MS;
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS_PER_PLANT;

  const startedAt = now();
  const deadlineAt = startedAt + runBudgetMs;

  const selected = await deps.selectPlantsForAssessment();

  // The selection already arrives oldest-assessed-first (never-assessed ahead
  // of everything) — `orderByAssessmentAge` in assessment/dirty.ts. That is
  // load-bearing for the slice on the next line: the cap drops the tail, so an
  // unordered selection would drop the SAME tail every tick and starve it
  // outright (#36). The order is asserted in dirty.test.ts and end-to-end here
  // in route.test.ts.
  const batch = selected.slice(0, deps.maxBatch);
  const skipped = selected.length - batch.length;

  if (skipped > 0) {
    console.warn(
      `[phase-engine/assess] ${skipped} dirty/stale plant(s) over the ${deps.maxBatch} cap; deferring to next run.`
    );
  }

  const outcomes: AssessOutcome[] = [];

  // Sequential on purpose: one slow plant must not blow the timeout via a
  // fan-out of concurrent OpenAI calls, and back-pressure is preferable here.
  // The pacing wait happens inside the judge (`runPacedCall`), so the loop only
  // has to decide whether the NEXT plant still fits in the run's budget.
  for (const [index, plant] of batch.entries()) {
    const projectedWaitMs = pacer.projectedWaitMs();

    // Always attempt at least one plant — a run that assesses nothing is worse
    // than a run that overshoots its soft budget by one call.
    if (index > 0 && now() + projectedWaitMs >= deadlineAt) {
      const remaining = batch.slice(index);
      console.warn(
        `[phase-engine/assess] run budget spent after ${index} plant(s) ` +
          `(next plant needs ${Math.round(projectedWaitMs / 1000)}s of pacing); ` +
          `deferring ${remaining.length} plant(s) to the next run.`
      );
      for (const deferredPlant of remaining) {
        outcomes.push({
          churchId: deferredPlant.churchId,
          reason: deferredPlant.reason,
          status: "deferred",
          deferralReason: "time_budget",
        });
      }
      break;
    }

    const onRateLimit = (event: RateLimitEvent) => {
      // Distinct from `console.error` below on purpose: this line means the
      // provider is throttling, not that the judge is broken.
      console.warn(
        `[phase-engine/assess] rate limited on church ${plant.churchId} ` +
          `(attempt ${event.attempt}/${event.maxAttempts}, ` +
          `retry-after ${event.retryAfterMs ?? "unstated"}ms, ` +
          `waiting ${Math.round(event.waitMs)}ms)`
      );
    };

    try {
      await deps.generateAssessment(plant.churchId, undefined, {
        pacer,
        maxAttempts,
        onRateLimit,
        // The same deadline the loop guard uses, handed to the retry ladder so
        // an in-plant hold can never outlive the run (see RUN_BUDGET_MS).
        deadlineAt,
      });
      outcomes.push({
        churchId: plant.churchId,
        reason: plant.reason,
        status: "assessed",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isRateLimitDeferral(error)) {
        // A ladder that stopped because the next hold would have crossed the
        // run deadline is a TIME deferral that happened to be throttled — it
        // says nothing about how hard the provider is limiting us, so it is
        // counted apart from `rateLimited`.
        const deferralReason: DeferralReason =
          error.reason === "run_budget" ? "time_budget" : "rate_limit";
        console.warn(
          `[phase-engine/assess] rate-limit deferral for church ${plant.churchId} (${plant.reason}, ${deferralReason}): ` +
            `${message} The plant stays dirty and is retried on the next run.`
        );
        outcomes.push({
          churchId: plant.churchId,
          reason: plant.reason,
          status: "deferred",
          deferralReason,
          error: message,
        });
        continue;
      }

      console.error(
        `[phase-engine/assess] assessment failed for church ${plant.churchId} (${plant.reason}):`,
        message
      );
      outcomes.push({
        churchId: plant.churchId,
        reason: plant.reason,
        status: "failed",
        error: message,
      });
    }
  }

  const stats = pacer.stats;

  return {
    selected: selected.length,
    attempted: outcomes.filter((o) => o.status !== "deferred").length,
    assessed: outcomes.filter((o) => o.status === "assessed").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    skipped,
    deferred: outcomes.filter((o) => o.status === "deferred").length,
    rateLimited: outcomes.filter((o) => o.deferralReason === "rate_limit")
      .length,
    pacedWaitMs: stats.totalWaitMs,
    tpmLimit: stats.limitTokens,
    tokensPerAssessment: stats.estimatedTokensPerCall,
    outcomes,
  };
}

/** True when the request carries a valid `Authorization: Bearer <CRON_SECRET>`. */
export function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed: if no secret is configured, reject everything.
  if (!secret) return false;

  // Constant-time, and shared with `/api/notifications/dispatch` so the two
  // consumers of this one secret cannot diverge (#266).
  return matchesBearerSecret(request.headers.get("authorization"), secret);
}

/**
 * GET /api/phase-engine/assess
 *
 * Vercel Cron entrypoint. Vercel sends `Authorization: Bearer <CRON_SECRET>`
 * when `CRON_SECRET` is set in the environment; we require it.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runAssessmentBatch();
    return NextResponse.json({
      ok: true,
      ...summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[phase-engine/assess] run failed:", error);
    return NextResponse.json(
      { error: "Assessment run failed" },
      { status: 500 }
    );
  }
}
