// ============================================================================
// Launch — recording what happened on the day (LS-006/LS-008).
//
// NO `"use server"` DIRECTIVE, on the same terms as `service.ts` and
// `milestones.ts`: every export of such a module is a POSTable endpoint with no
// session behind it (memory/invariants.md → Authentication, the #265 rules).
//
// LAUNCH SUNDAY IS NOT A MEETING. Nothing here creates a meeting row, and the
// old practice of cataloguing the service as a vision meeting ends with the
// entity (FRD, "User-visible behavior"). The outcome lives on the launch.
// ============================================================================

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import type { User } from "@/db/schema";
import { requireChurchAccess, requireRole } from "@/lib/auth/access";
import { markPlantDirty } from "@/lib/phase-engine/dirty-handler";
import { daysUntilTarget } from "./countdown";
import { getLaunchForChurch } from "./queries";

// ----------------------------------------------------------------------------
// Messages
// ----------------------------------------------------------------------------

export const OUTCOME_ALREADY_RECORDED_MESSAGE =
  "This launch's outcome is already recorded.";

export const OUTCOME_NO_LAUNCH_MESSAGE =
  "Schedule the launch before recording how the day went.";

/**
 * The day has to have arrived. Not a nicety: an outcome recorded for a future
 * date would set `status = 'completed'`, which the date write then refuses to
 * move (`LAUNCH_ALREADY_COMPLETED_MESSAGE`) — so a mistyped early submit would
 * strand the plant's launch date permanently.
 */
export const OUTCOME_TOO_EARLY_MESSAGE =
  "You can record the outcome on Launch Sunday, once the day has arrived.";

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

/**
 * Counts are counts (the CHECK constraints say so too), and NULL is a real
 * answer meaning "not recorded" — distinct from 0, which means nobody came or
 * nobody responded. An empty form field is therefore `null`, never `0`.
 */
const countSchema = z
  .number()
  .int("Use a whole number")
  .min(0, "That cannot be negative")
  .max(1_000_000, "That is not a plausible count")
  .nullable();

export const launchOutcomeSchema = z.object({
  attendanceCount: countSchema,
  decisionsCount: countSchema,
  outcomeNotes: z.string().max(10_000).nullable(),
  captureTheDay: z.string().max(10_000).nullable(),
});

export type LaunchOutcomeInput = z.infer<typeof launchOutcomeSchema>;

// ----------------------------------------------------------------------------
// The statement
// ----------------------------------------------------------------------------

/**
 * Record the outcome AND journal it — one statement, for the same two reasons
 * `setLaunchDateStatement` is one: the journal needs the OLD status, which the
 * update destroys, and it must be impossible for a journal row to exist for a
 * write that did not land.
 *
 * THE GUARDS:
 *   `current`  the launch row, LOCKED, so two submits serialise rather than
 *              both reading "not yet recorded".
 *   `updated`  `status <> 'completed'` makes recording write-ONCE — the second
 *              submit writes nothing rather than silently overwriting an
 *              account of the day with an empty form. `target_date <=` the
 *              caller's UTC day is the "has the day arrived" gate, expressed
 *              against a value the caller computed rather than the database's
 *              `current_date`, which follows the SERVER's TimeZone setting and
 *              would disagree with the countdown on the page.
 *   `journal`  reads from `updated`, so it fires only for a real write.
 *
 * WHY THE UPDATE READS `FROM current` INSTEAD OF THE JOURNAL JOINING `current`
 * AFTERWARDS. This was written the obvious way first — `update … where
 * church_id = $1`, then `insert … from updated u join current c` — and the
 * journal row silently never appeared. A plain CTE is evaluated LAZILY, when
 * something first pulls from it; nothing pulled `current` until the journal
 * did, which is after the UPDATE had already run. `SELECT … FOR UPDATE` then
 * found a row whose latest version was written by the CURRENT command and
 * SKIPPED it (`HeapTupleSelfUpdated`), so `current` came back empty and the
 * inner join produced nothing. No error, no journal row.
 *
 * Making the UPDATE read `from current` fixes it at the root: `current` is now
 * a DEPENDENCY of the update, so it is evaluated (and the row locked) BEFORE
 * anything modifies it, and the old values come back in the same `RETURNING`
 * rather than from a second lookup that cannot see them any more. Note that
 * `setLaunchDateStatement` is safe for the same structural reason and not by
 * luck: its `inserted` CTE says `where not exists (select 1 from current)`,
 * which forces `current` first.
 */
export function recordLaunchOutcomeStatement(input: {
  churchId: string;
  actorUserId: string;
  asOfDay: string;
  attendanceCount: number | null;
  decisionsCount: number | null;
  outcomeNotes: string | null;
  captureTheDay: string | null;
}): SQL {
  return sql`
    with current as (
      select id, target_date, status
      from launches
      where church_id = ${input.churchId}
      for update
    ), updated as (
      update launches l
      set status = 'completed',
          outcome_recorded_at = now(),
          attendance_count = ${input.attendanceCount},
          decisions_count = ${input.decisionsCount},
          outcome_notes = ${input.outcomeNotes},
          capture_the_day = ${input.captureTheDay},
          updated_at = now()
      from current c
      where l.id = c.id
        and c.status <> 'completed'
        and c.target_date is not null
        and c.target_date <= ${input.asOfDay}::date
      returning
        l.id,
        c.target_date as previous_target_date,
        c.status as previous_status,
        l.target_date,
        l.status
    ), journal as (
      insert into launch_events (
        launch_id, church_id, event,
        previous_target_date, target_date,
        previous_status, status,
        actor_user_id, note
      )
      select
        u.id, ${input.churchId}, 'completed',
        u.previous_target_date, u.target_date,
        u.previous_status, u.status,
        ${input.actorUserId}, ${input.outcomeNotes}
      from updated u
      returning id
    )
    select u.id as launch_id, u.target_date as target_date from updated u
  `;
}

// ----------------------------------------------------------------------------
// The action-facing entrypoint
// ----------------------------------------------------------------------------

export type RecordLaunchOutcomeResult =
  | { status: "recorded"; targetDate: string }
  | { status: "error"; error: string };

/**
 * Record how Launch Sunday went (LS-006).
 *
 * AUTHORISES ITSELF, planter-only, exactly as `setLaunchDate` does and for the
 * same LS-007 reason: this is a plant-level decision, and an oversight admin
 * has church ACCESS to an associated plant, so `requireChurchAccess` alone
 * would let them write a plant's history. Both checks THROW.
 *
 * The plant is marked dirty afterwards (LS-008: recording a completed launch is
 * a MATERIAL event, so the next assessment sees it). Best-effort and after the
 * durable write — `markPlantDirty` swallows its own failures — because a
 * re-assessment hint must never be why a planter's account of the day failed to
 * save. Note what this does NOT do: it does not touch `current_phase`. The
 * engine stays advisory (LS-008).
 */
export async function recordLaunchOutcome(
  user: User,
  churchId: string,
  input: LaunchOutcomeInput,
  asOf: Date = new Date()
): Promise<RecordLaunchOutcomeResult> {
  requireRole(user, "planter");
  await requireChurchAccess(user, churchId);

  const parsed = launchOutcomeSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0].message };
  }

  const result = await db.execute<{ launch_id: string; target_date: string }>(
    recordLaunchOutcomeStatement({
      churchId,
      actorUserId: user.id,
      asOfDay: utcDay(asOf),
      ...parsed.data,
    })
  );

  const written = result.rows[0];

  if (!written) {
    // Nothing was written, and the three reasons are different answers.
    const stored = await getLaunchForChurch(churchId);
    if (!stored?.targetDate) {
      return { status: "error", error: OUTCOME_NO_LAUNCH_MESSAGE };
    }
    if (stored.status === "completed") {
      return { status: "error", error: OUTCOME_ALREADY_RECORDED_MESSAGE };
    }
    return { status: "error", error: OUTCOME_TOO_EARLY_MESSAGE };
  }

  await markPlantDirty(churchId);

  return { status: "recorded", targetDate: written.target_date };
}

/**
 * The caller's UTC calendar day as `YYYY-MM-DD`.
 *
 * NOT a second countdown implementation — there is no day arithmetic here, only
 * the same flooring rule `daysUntilTarget` uses, so the SQL gate and the page's
 * countdown answer the same question about the same day (invariants → Date &
 * Time Rendering; the #303/#338 divergence).
 */
function utcDay(asOf: Date): string {
  return asOf.toISOString().slice(0, 10);
}

/**
 * May the outcome be recorded yet? The UI's copy of the SQL gate above, sharing
 * the ONE countdown helper so the button and the write cannot disagree about
 * which day it is (#338).
 */
export function canRecordOutcome(
  launch: { targetDate: string | null; status: string } | null,
  asOf: Date = new Date()
): boolean {
  if (!launch?.targetDate) return false;
  if (launch.status === "completed") return false;
  const days = daysUntilTarget(launch.targetDate, asOf);
  return days !== null && days <= 0;
}
