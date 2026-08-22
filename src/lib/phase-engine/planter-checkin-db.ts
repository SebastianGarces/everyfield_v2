// ============================================================================
// THE CHECK-IN'S TWO DATABASE TOUCHES, AND NOTHING ELSE.
//
// `planter-checkin.ts` is imported by the `"use client"` card for its
// dimensions, levels and nudge math — so that module may not reach `@/db`,
// whose module scope calls `neon(process.env.DATABASE_URL!)` and therefore
// throws in a browser (the /tasks/templates outage, re-run on /phase). The
// pure module stays browser-safe; the two functions that read and write rows
// live here, on the server side of the boundary. The privacy spine
// (`planter-checkin.test.ts`) covers both files: its sweep matches the
// `planter-checkin` prefix.
// ============================================================================

import { and, desc, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { planterCheckins, type PlanterCheckin } from "@/db/schema";

import {
  CHECKIN_HISTORY_WEEKS,
  recentWeekStarts,
  type CheckinAnswer,
} from "./planter-checkin";

/**
 * Record (or correct) this church's answer for one week.
 *
 * IDEMPOTENT BY THE UNIQUE INDEX. A planter who changes their mind on Thursday
 * updates Monday's row rather than writing a second, contradictory week — which
 * is also what lets the card be answered without a "have you already done this"
 * check in front of it.
 */
export async function saveCheckin(
  churchId: string,
  answeredById: string,
  weekStart: string,
  answer: CheckinAnswer
): Promise<PlanterCheckin> {
  const now = new Date();

  const [row] = await db
    .insert(planterCheckins)
    .values({
      churchId,
      weekStart,
      answeredById,
      spiritually: answer.spiritually,
      marriageFamily: answer.marriageFamily,
      financially: answer.financially,
      pace: answer.pace,
      note: answer.note ?? null,
    })
    .onConflictDoUpdate({
      target: [planterCheckins.churchId, planterCheckins.weekStart],
      set: {
        spiritually: answer.spiritually,
        marriageFamily: answer.marriageFamily,
        financially: answer.financially,
        pace: answer.pace,
        note: answer.note ?? null,
        answeredById,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

/**
 * The last `weeks` weeks of check-ins for this church, oldest first.
 *
 * NO `answeredById` FILTER. The row is the PLANT's week, not one account's:
 * a co-planter answering while the lead is away is the same week, and the
 * unique index says so.
 */
export async function listRecentCheckins(
  churchId: string,
  asOf: Date = new Date(),
  weeks: number = CHECKIN_HISTORY_WEEKS
): Promise<PlanterCheckin[]> {
  const earliest = recentWeekStarts(asOf, weeks)[0];

  const rows = await db
    .select()
    .from(planterCheckins)
    .where(
      and(
        eq(planterCheckins.churchId, churchId),
        gte(planterCheckins.weekStart, earliest)
      )
    )
    .orderBy(desc(planterCheckins.weekStart));

  return rows.reverse();
}
