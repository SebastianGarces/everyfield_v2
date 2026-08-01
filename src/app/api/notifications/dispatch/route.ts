// ============================================================================
// Scheduled notification dispatcher (N-003, N-004, N-017).
//
// The recurring job that drains due notifications to email and to the in-app
// feed. All of the interesting behaviour — the row claim, the per-channel
// claim, batching, the still-live re-check, bounded retry — lives in
// `src/lib/notifications/dispatch.ts`; this file is the guard, not the logic.
//
// Security: `Authorization: Bearer <CRON_SECRET>`. It FAILS CLOSED — an unset
// secret rejects everything rather than opening the endpoint, because this
// route sends email to real users and an open one is a spam cannon pointed at
// the cohort. Same contract as `/api/phase-engine/assess`.
//
// It also carries the DAILY oversight activity digest (ruled 2026-08-01). That
// is not a second job bolted on: the digest needs a once-a-day trigger, this app
// has no daily scheduler to spare, and the sweep's "already done today" test is
// derived from the rows it writes — so hanging it off a 15-minute tick produces
// exactly one digest per plant per day. See `sweepOversightDigests` below.
//
// Schedule: every 15 minutes, from `.github/workflows/notifications-dispatch.yml`
// — NOT from vercel.json, which carries only the daily phase-engine cron. The
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
  runDailyOversightDigestSweep,
  type OversightDigestSweepSummary,
} from "@/lib/notifications/oversight-digest";

// Claims rows and calls a provider — never cache it, never prerender it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
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
}

/**
 * The daily oversight digest, hung off this tick (ruled 2026-08-01).
 *
 * WHY HERE. The digest is a daily job and this app has no daily scheduler to
 * give it: `vercel.json` holds the single cron the Hobby plan permits (the
 * phase engine), and adding a second GitHub workflow to run one query a day is
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
  at: Date
): Promise<OversightDigestSweepSummary | null> {
  try {
    return await runDailyOversightDigestSweep(at);
  } catch (error) {
    console.error(
      "[notifications/dispatch] oversight digest sweep failed:",
      error
    );
    return null;
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

  try {
    const summary = await dispatchNotifications({
      maxBatch: MAX_DISPATCH_BATCH,
      budgetMs: RUN_BUDGET_MS,
    });

    if (summary.remainingPending > 0) {
      console.warn(
        `[notifications/dispatch] ${summary.remainingPending} due notification(s) left pending after a batch of ${summary.claimed}; they roll over to the next tick.`
      );
    }

    const oversightDigest = await sweepOversightDigests(new Date());

    return NextResponse.json({
      ok: true,
      ...summary,
      oversightDigest,
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
