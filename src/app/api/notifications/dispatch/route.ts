// ============================================================================
// Vercel Cron: notification dispatcher (N-003, N-004, N-017).
//
// The recurring job that drains due notifications to email and to the in-app
// feed. All of the interesting behaviour — the row claim, the per-channel
// claim, batching, the still-live re-check, bounded retry — lives in
// `src/lib/notifications/dispatch.ts`; this file is the schedule and the guard.
//
// Security: `Authorization: Bearer <CRON_SECRET>`, the header Vercel Cron sends
// when `CRON_SECRET` is set in the project's environment. It FAILS CLOSED — an
// unset secret rejects everything rather than opening the endpoint, because
// this route sends email to real users and an open one is a spam cannon
// pointed at the cohort. Same contract as `/api/phase-engine/assess`.
//
// Schedule: every 15 minutes (vercel.json). More frequent than the daily
// Plant Intelligence run because a meeting reminder that is a day late is not a
// reminder. Growth is absorbed by MORE TICKS, not longer runs — the batch bound
// stays put and the remainder rolls over (N-017). NOTE: sub-daily cron
// schedules require a paid Vercel plan; on Hobby this entry must be relaxed to
// a daily schedule, which degrades punctuality but not correctness.
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
}

/**
 * GET /api/notifications/dispatch
 *
 * Vercel Cron entrypoint. The summary is returned for observability — how many
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

    return NextResponse.json({
      ok: true,
      ...summary,
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
