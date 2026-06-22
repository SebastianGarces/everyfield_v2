// ============================================================================
// Vercel Cron: dirty-or-stale assessment runner (NFR-PE-2 / AC-PE-8 / PE-010).
//
// Invoked ~daily by Vercel Cron (see vercel.json). Selects the plants that are
// dirty-or-stale via the orchestrator's selection query and runs
// `generateAssessment` for each, bounded and sequential so:
//   - quiet plants are skipped (no material event since last assessment),
//   - each plant runs at most ~once/day with a max-staleness floor (NFR-PE-2),
//   - one slow plant cannot blow the function timeout (the batch is capped and
//     runs one-at-a-time; remaining plants roll over to the next run).
//
// Security: guarded by a CRON_SECRET bearer token. The request must carry
// `Authorization: Bearer <CRON_SECRET>` — this is the header Vercel Cron sends
// when `CRON_SECRET` is set in the project's environment variables. CRON_SECRET
// MUST be set both locally (.env / .env.local) and in the Vercel project env.
//
// There are NO per-pageview LLM calls anywhere — assessments only run here (or
// via an explicit manual trigger). `generateAssessment` makes a real OpenAI
// call per plant, so the batch is intentionally bounded.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";

import {
  generateAssessment,
  selectPlantsForAssessment,
  type SelectedPlant,
} from "@/lib/phase-engine/assessment";

// This runner orchestrates real LLM calls and DB writes — never cache it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Max number of plants assessed in a single cron run. Each plant makes a real
 * OpenAI call, so we cap the batch to keep the function well under its timeout.
 * Plants beyond the cap remain dirty/stale and are picked up on the next run.
 */
export const MAX_BATCH = 25;

/** Per-plant outcome, surfaced in the response body for observability. */
export interface AssessOutcome {
  churchId: string;
  reason: SelectedPlant["reason"];
  status: "assessed" | "failed";
  error?: string;
}

/** Summary of a single cron run. */
export interface AssessRunSummary {
  selected: number;
  attempted: number;
  assessed: number;
  failed: number;
  skipped: number;
  outcomes: AssessOutcome[];
}

/** Seams so the batch runner can be exercised without a live DB/LLM in tests. */
export interface RunAssessmentBatchDeps {
  selectPlantsForAssessment: typeof selectPlantsForAssessment;
  generateAssessment: typeof generateAssessment;
  maxBatch: number;
}

const DEFAULT_DEPS: RunAssessmentBatchDeps = {
  selectPlantsForAssessment,
  generateAssessment,
  maxBatch: MAX_BATCH,
};

/**
 * Select dirty-or-stale plants and (re-)assess each, bounded and sequential.
 *
 * Quiet, recently-assessed plants are never returned by the selection query, so
 * they are never re-assessed (PE-010). The batch is capped at `maxBatch`; any
 * plants past the cap are logged as skipped and left for the next run. A failure
 * on one plant is recorded and the run continues — `generateAssessment` already
 * marks the failed plant's row `failed` without touching its last good snapshot.
 */
export async function runAssessmentBatch(
  deps: RunAssessmentBatchDeps = DEFAULT_DEPS
): Promise<AssessRunSummary> {
  const selected = await deps.selectPlantsForAssessment();

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
  for (const plant of batch) {
    try {
      await deps.generateAssessment(plant.churchId);
      outcomes.push({
        churchId: plant.churchId,
        reason: plant.reason,
        status: "assessed",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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

  return {
    selected: selected.length,
    attempted: batch.length,
    assessed: outcomes.filter((o) => o.status === "assessed").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    skipped,
    outcomes,
  };
}

/** True when the request carries a valid `Authorization: Bearer <CRON_SECRET>`. */
export function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed: if no secret is configured, reject everything.
  if (!secret) return false;

  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
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
