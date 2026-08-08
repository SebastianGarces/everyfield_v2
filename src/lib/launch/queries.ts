// ============================================================================
// Launch — reads.
//
// NO `"use server"` DIRECTIVE, here or anywhere under `src/lib/launch/`. Every
// export of such a module is a POSTable endpoint with no session behind it
// (memory/invariants.md → Authentication, the #265 rules), and these are
// helpers taking a bare `churchId`. They belong in a plain module; the actions
// that call them live next to their page and mint their actor from
// `verifySession()`.
//
// Every read is church_id-scoped. `launches` holds at most ONE row per church
// (`launches_church_id_unique`), so "the plant's launch" is a row, not a list.
// ============================================================================

import { inArray, eq } from "drizzle-orm";

import { db } from "@/db";
import { launches, launchMilestones, launchEvents } from "@/db/schema";
import type { LaunchStatus } from "@/db/schema/launch";

/** The launch as every reader in the app sees it. */
export interface LaunchRecord {
  id: string;
  churchId: string;
  /** yyyy-mm-dd, or `null` while the launch is still `planning`. */
  targetDate: string | null;
  status: LaunchStatus;
  outcomeRecordedAt: Date | null;
  attendanceCount: number | null;
  decisionsCount: number | null;
  outcomeNotes: string | null;
  captureTheDay: string | null;
}

/** One plant's launch, or `null` when it has none yet. */
export async function getLaunchForChurch(
  churchId: string
): Promise<LaunchRecord | null> {
  const rows = await db
    .select({
      id: launches.id,
      churchId: launches.churchId,
      targetDate: launches.targetDate,
      status: launches.status,
      outcomeRecordedAt: launches.outcomeRecordedAt,
      attendanceCount: launches.attendanceCount,
      decisionsCount: launches.decisionsCount,
      outcomeNotes: launches.outcomeNotes,
      captureTheDay: launches.captureTheDay,
    })
    .from(launches)
    .where(eq(launches.churchId, churchId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The launch date for MANY plants at once, keyed by church id.
 *
 * This exists so the oversight portfolio listing stays ONE query when the date
 * moved off the churches row — the shape the column gave for free, and the one
 * an obvious `for (const plant of plants) await getLaunchForChurch(...)` would
 * have thrown away. A church with no launch is simply absent from the map, and
 * callers read that as "no date", exactly as a null column read.
 *
 * Returns an empty map for an empty id list without touching the database:
 * `inArray(x, [])` is a `false` predicate in drizzle, but a round trip to learn
 * that is still a round trip.
 */
export async function getLaunchDatesForChurches(
  churchIds: string[]
): Promise<Map<string, string | null>> {
  const dates = new Map<string, string | null>();
  if (churchIds.length === 0) return dates;

  const rows = await db
    .select({
      churchId: launches.churchId,
      targetDate: launches.targetDate,
    })
    .from(launches)
    .where(inArray(launches.churchId, churchIds));

  for (const row of rows) dates.set(row.churchId, row.targetDate);
  return dates;
}

/** One plant's readiness milestones, in template order (LS-003). */
export async function getLaunchMilestones(launchId: string) {
  return db
    .select()
    .from(launchMilestones)
    .where(eq(launchMilestones.launchId, launchId))
    .orderBy(launchMilestones.sortOrder, launchMilestones.templateKey);
}

/**
 * The date/status journal for one launch, oldest first (LS-002/LS-009) — a
 * journal is read as a story, so it is ordered the way the story happened.
 *
 * Append-only by convention — see `src/db/schema/launch.ts`. There is no update
 * or delete query in this module, and there is not meant to be one.
 */
export async function getLaunchJournal(launchId: string) {
  return db
    .select()
    .from(launchEvents)
    .where(eq(launchEvents.launchId, launchId))
    .orderBy(launchEvents.createdAt);
}
