// ============================================================================
// Scheduled notification dispatcher (N-003, N-004, N-017).
//
// The recurring job that drains due notifications to email and to the in-app
// feed. All of the interesting behaviour — the row claim, the per-channel
// claim, batching, the still-live re-check, bounded retry — lives in
// `src/lib/notifications/dispatch.ts`; this file is the guard, not the logic.
//
// The ONE piece of wiring it owns: `registerNotificationConsumers()` below. A
// predicate that is not registered in THIS process does not exist, whatever any
// feature module does at its own import time.
//
// Security: `Authorization: Bearer <CRON_SECRET>`. It FAILS CLOSED — an unset
// secret rejects everything rather than opening the endpoint, because this
// route sends email to real users and an open one is a spam cannon pointed at
// the cohort. Same contract as `/api/phase-engine/assess` — literally the same
// code now: both routes call `matchesBearerSecret`, whose comparison is
// CONSTANT-TIME (#266). See `src/lib/security/constant-time.ts` for why `===`
// and a plain length guard are both oracles.
//
// It also carries BOTH digest sweeps — the daily oversight activity digest
// (ruled 2026-08-01) and the recurring planter digest (N-013). Neither is a
// second job bolted on: each needs a recurring trigger, this app has no
// scheduler to spare, and each sweep's "already done for this period" test is
// derived from the rows it writes — so hanging them off a 15-minute tick
// produces exactly one digest per plant per day and one per recipient per
// period. See `sweepOversightDigests` and `sweepPlanterDigests` below.
//
// Schedule: every 15 minutes, from `.github/workflows/notifications-dispatch.yml`
// — NOT from vercel.json, which since #36 carries no crons at all (the phase
// engine moved to its own Actions schedule for the same reason). The
// Hobby plan caps Vercel crons at one invocation per day and rejects the
// deployment outright rather than throttling, and a daily tick would make a
// meeting reminder arrive a day late. GitHub's scheduler has no such cap, at
// the cost of being best-effort about the exact minute. This runs far more
// often than the daily Plant Intelligence job for that same reason: these are
// time-sensitive. Growth is absorbed by MORE TICKS, not longer runs — the batch
// bound stays put and the remainder rolls over (N-017), which is also what
// makes a late or dropped tick a delay rather than a loss.
//
// Overlap: a tick that starts while the previous one is still running is safe
// by construction — `claimDue` is a single atomic statement, so the second run
// gets a disjoint set of rows or none at all. There is no run lock and none is
// needed; see the dispatch module header.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";

import {
  dispatchNotifications,
  MAX_DISPATCH_BATCH,
  RUN_BUDGET_MS,
  type DispatchRunSummary,
} from "@/lib/notifications/dispatch";
import {
  runDailyPlanterDigestSweep,
  type PlanterDigestSweepSummary,
} from "@/lib/notifications/digest";
import {
  runDailyOversightDigestSweep,
  type OversightDigestSweepSummary,
} from "@/lib/notifications/oversight-digest";
import { registerNotificationConsumers } from "@/lib/notifications/register-consumers";
import { matchesBearerSecret } from "@/lib/security/constant-time";

// Claims rows and calls a provider — never cache it, never prerender it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// N-014, ARMED. `resolveLiveness` treats a type with no registered predicate as
// LIVE, so this call is what stops a completed task or a cancelled meeting being
// emailed off a row a run had already claimed. It has to be HERE, in the
// dispatcher's own entrypoint: the feature modules used to arm themselves as a
// load-time side effect, this file imports neither of them, and so all six types
// were unregistered in the cron runtime while both feature suites passed (they
// register by hand). Idempotent — registration replaces rather than stacks.
// `route.test.ts` asserts the six over THIS module's graph.
registerNotificationConsumers();

/**
 * Platform function timeout. `RUN_BUDGET_MS` sits under it deliberately: the
 * run stops itself and releases what it claimed rather than being killed
 * mid-batch with rows stranded in `claimed`.
 */
export const maxDuration = 60;

/** True when the request carries a valid `Authorization: Bearer <CRON_SECRET>`. */
export function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed: with no secret configured, nothing is authorised.
  if (!secret) return false;

  // Constant-time, and shared with `/api/phase-engine/assess` so the two
  // consumers of this one secret cannot diverge (#266).
  return matchesBearerSecret(request.headers.get("authorization"), secret);
}

export interface DispatchResponseBody extends DispatchRunSummary {
  ok: true;
  timestamp: string;
  /**
   * The oversight digest sweep this tick performed, or null if it threw. The
   * summary is here — not in a separate endpoint — because "did the digest go
   * out today?" is answered by the same tick log as "did the reminders?".
   */
  oversightDigest: OversightDigestSweepSummary | null;
  /**
   * The PLANTER digest sweep this tick performed, or null if it threw (N-013).
   * Same reason it is reported here as the line above: one tick, one log line,
   * one answer to "did it go out?".
   */
  planterDigest: PlanterDigestSweepSummary | null;
}

/**
 * The three things one tick does.
 *
 * A seam rather than three direct calls, and it exists for exactly one reason:
 * the interesting behaviour of this file is the ORDER and the never-fail
 * contract, and neither is assertable if proving them needs a Postgres. With
 * this, `route.test.ts` runs a whole tick against fakes and asserts that a
 * digest sweep that throws still returns 200 with an intact dispatch summary —
 * the property the two `catch` blocks below exist for.
 *
 * Production passes `PRODUCTION_TICK`; nothing else ever supplies these.
 */
export interface DispatchTickDeps {
  dispatch(): Promise<DispatchRunSummary>;
  sweepOversightDigests(at: Date): Promise<OversightDigestSweepSummary>;
  sweepPlanterDigests(at: Date): Promise<PlanterDigestSweepSummary>;
}

const PRODUCTION_TICK: DispatchTickDeps = {
  dispatch: () =>
    dispatchNotifications({
      maxBatch: MAX_DISPATCH_BATCH,
      budgetMs: RUN_BUDGET_MS,
    }),
  sweepOversightDigests: runDailyOversightDigestSweep,
  sweepPlanterDigests: runDailyPlanterDigestSweep,
};

/**
 * The daily oversight digest, hung off this tick (ruled 2026-08-01).
 *
 * WHY HERE. The digest is a daily job and this app has no daily scheduler to
 * give it: the Hobby plan's one-a-day Vercel cron is not usable by anything
 * here (which is why `vercel.json` schedules nothing), and adding a third
 * GitHub workflow to run one query a day is
 * a scheduler to maintain for no benefit. The tick that already runs every 15
 * minutes can carry it, provided the digest happens once — and it does, because
 * the sweep derives "already done today" from the rows it wrote rather than
 * from a clock. See the schedule section of `oversight-digest.ts`.
 *
 * WHY AFTER THE DISPATCH. Draining due notifications is the time-sensitive
 * obligation (N-017); a roll-up of a day that is already over is not. Running
 * the sweep second means it can never eat into the dispatch budget, at the cost
 * of the digest rows it writes going out on the NEXT tick — at most 15 minutes
 * later, for a summary of yesterday.
 *
 * WHY IT CANNOT FAIL THE RUN. A throw here would turn a successful dispatch —
 * emails already sent, rows already marked delivered — into a 500, and the
 * caller's only recovery is to tick again, which re-runs nothing (the deliveries
 * are claimed) and re-attempts the same broken sweep. So the sweep's failure is
 * data in the response, not an exception.
 */
async function sweepOversightDigests(
  deps: DispatchTickDeps,
  at: Date
): Promise<OversightDigestSweepSummary | null> {
  try {
    return await deps.sweepOversightDigests(at);
  } catch (error) {
    console.error(
      "[notifications/dispatch] oversight digest sweep failed:",
      error
    );
    return null;
  }
}

/**
 * The recurring PLANTER digest, hung off this same tick (N-013).
 *
 * WHY HERE, and it is the same answer as the oversight digest's above: this app
 * has no scheduler to give it. The Hobby plan's one-a-day Vercel cron is
 * unusable (which is why `vercel.json` schedules nothing) and a third GitHub
 * workflow would be a scheduler to maintain for one query. The 15-minute tick
 * already runs, and 15 minutes is exactly the frequency this sweep is designed
 * for: its once-a-period guard is DERIVED from the rows it writes, not from a
 * clock, so firing 96 times a day still produces one digest per recipient per
 * period, and a dropped tick is a delay rather than a loss.
 *
 * WHY AFTER BOTH. Draining due notifications is the time-sensitive obligation
 * (N-017) and neither roll-up is. The oversight sweep keeps its place ahead of
 * this one because it reports a day that is already over; this one reports what
 * is open right now and loses nothing by being last.
 *
 * WHY IT CANNOT FAIL THE RUN. Identical to the oversight case: a throw here
 * would turn a successful dispatch — emails already sent, rows already marked
 * delivered — into a 500, and the caller's only recovery is to tick again,
 * which re-runs nothing and re-attempts the same broken sweep. So the failure is
 * data in the response, not an exception.
 *
 * NOTE the production prerequisite this makes live: the digest is the first
 * feature in the product that enqueues on a schedule, so from this call
 * onwards `UNSUBSCRIBE_TOKEN_SECRET` must be set in production — the digest
 * email throws rather than ship a dead unsubscribe link.
 */
async function sweepPlanterDigests(
  deps: DispatchTickDeps,
  at: Date
): Promise<PlanterDigestSweepSummary | null> {
  try {
    return await deps.sweepPlanterDigests(at);
  } catch (error) {
    console.error(
      "[notifications/dispatch] planter digest sweep failed:",
      error
    );
    return null;
  }
}

/**
 * One authorised tick: dispatch, then both digest sweeps, then the summary.
 *
 * Separate from `GET` so the tick can be exercised without a request and
 * without a database. `GET` is the guard; this is the work.
 */
export async function runDispatchTick(
  deps: DispatchTickDeps = PRODUCTION_TICK
): Promise<NextResponse> {
  try {
    const summary = await deps.dispatch();

    if (summary.remainingPending > 0) {
      console.warn(
        `[notifications/dispatch] ${summary.remainingPending} due notification(s) left pending after a batch of ${summary.claimed}; they roll over to the next tick.`
      );
    }

    const oversightDigest = await sweepOversightDigests(deps, new Date());
    const planterDigest = await sweepPlanterDigests(deps, new Date());

    return NextResponse.json({
      ok: true,
      ...summary,
      oversightDigest,
      planterDigest,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // A thrown run has already released or left claimed whatever it touched;
    // nothing is dropped, and the next tick retries. The one thing that must
    // NOT happen is a duplicate send on recovery, which the per-channel claim
    // prevents regardless of how this run ended.
    console.error("[notifications/dispatch] run failed:", error);
    return NextResponse.json({ error: "Dispatch run failed" }, { status: 500 });
  }
}

/**
 * GET /api/notifications/dispatch
 *
 * The scheduled entrypoint. The summary is returned for observability — how many
 * rows were claimed, how many are still pending, and how long the run took are
 * exactly the numbers that say whether the tick interval is keeping up.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runDispatchTick();
}
