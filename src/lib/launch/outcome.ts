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
import { requireChurchAccess } from "@/lib/auth/access";
import { assertSeatFor } from "@/lib/auth/seat-rules";
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

/**
 * Editing is the CORRECTION path (LS-006, ruled 2026-08-04: "a recorded outcome
 * stays editable by the planter with edits journaled"), so it needs something to
 * correct. A launch with no outcome yet is recorded, not edited — different
 * write, different guard, different journal row.
 */
export const OUTCOME_NOT_RECORDED_MESSAGE =
  "There is no recorded outcome to correct yet — record the day first.";

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

/**
 * CORRECT an already-recorded outcome, and journal the correction (LS-006).
 *
 * Corrections happen: a headcount is re-done on Monday, a decision card turns up
 * late, a note was typed in a hurry. So a recorded outcome is not frozen — but
 * neither is it quietly mutable, which is why this writes a `launch_events` row
 * exactly as the first recording did.
 *
 * THE SAME STRUCTURE, FOR THE SAME REASON. `current` is a DEPENDENCY of the
 * UPDATE (`update … from current c`), never a sibling CTE the journal joins
 * afterwards — see the long note on `recordLaunchOutcomeStatement`: a lazily
 * evaluated `SELECT … FOR UPDATE` re-read after the write finds a row its own
 * command just modified, skips it, and the journal silently writes nothing.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH:
 *   `status`               already `completed`; a correction is not a state
 *                          change, and the guard `c.status = 'completed'` is
 *                          what makes this the correction path rather than a
 *                          second way to complete a launch.
 *   `target_date`          the day it happened on is history. Moving it is
 *                          refused by `setLaunchDate` too
 *                          (`LAUNCH_ALREADY_COMPLETED_MESSAGE`).
 *   `outcome_recorded_at`  WHEN the planter first wrote the day down is a fact
 *                          about the record, not about the edit. The journal
 *                          carries the edit's own timestamp.
 *
 * A RE-SAVE OF THE SAME VALUES WRITES NOTHING. The `is distinct from` block is a
 * compare-and-set, the same one `setLaunchDateStatement` uses on the date and
 * for the same reason: the journal is history a planter reads, and a row saying
 * "outcome corrected" that corrected nothing is noise in it. `is distinct from`
 * rather than `<>` because every one of these columns is nullable and `null <>
 * null` is null, which would drop exactly the case that matters (clearing a
 * count). The casts are not decoration — an untyped `null` parameter leaves
 * Postgres unable to infer the operand's type.
 *
 * HOW A CORRECTION READS IN THE JOURNAL. `launch_events.event` is a fixed
 * vocabulary (`scheduled` / `moved` / `postponed` / `completed`) owned by the
 * schema, so a correction is a `completed` row whose `previous_status` is
 * ALREADY `completed` — a shape the first recording can never produce, since it
 * always comes from `scheduled` or `postponed`. The surfaces read exactly that
 * pair (`journalEntryLabel` in `src/components/launch/presentation.ts`), so no
 * enum value had to be invented in a workstream that does not own the schema.
 */
export function updateLaunchOutcomeStatement(input: {
  churchId: string;
  actorUserId: string;
  attendanceCount: number | null;
  decisionsCount: number | null;
  outcomeNotes: string | null;
  captureTheDay: string | null;
}): SQL {
  return sql`
    with current as (
      select id, target_date, status, outcome_recorded_at,
             attendance_count, decisions_count, outcome_notes, capture_the_day
      from launches
      where church_id = ${input.churchId}
      for update
    ), updated as (
      update launches l
      set attendance_count = ${input.attendanceCount},
          decisions_count = ${input.decisionsCount},
          outcome_notes = ${input.outcomeNotes},
          capture_the_day = ${input.captureTheDay},
          updated_at = now()
      from current c
      where l.id = c.id
        and c.status = 'completed'
        and c.outcome_recorded_at is not null
        and (
          c.attendance_count is distinct from ${input.attendanceCount}::int
          or c.decisions_count is distinct from ${input.decisionsCount}::int
          or c.outcome_notes is distinct from ${input.outcomeNotes}::text
          or c.capture_the_day is distinct from ${input.captureTheDay}::text
        )
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
  assertSeatFor(user, "launch.schedule");
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

export type UpdateLaunchOutcomeResult =
  | { status: "updated"; targetDate: string }
  /** The submitted values were already the stored ones — nothing was written. */
  | { status: "unchanged"; targetDate: string }
  | { status: "error"; error: string };

/**
 * Correct a recorded outcome (LS-006). Planter-only, journaled, and available
 * for as long as the record exists — corrections happen, and a plant's own
 * account of its launch is not something the product locks away from it.
 *
 * AUTHORISES ITSELF on the same terms as `recordLaunchOutcome`: the PLANTER of
 * THIS plant, both checks THROWING. An oversight admin has church ACCESS to an
 * associated plant, so `requireChurchAccess` alone would let them rewrite a
 * plant's history — which is worse here than at recording time, because a
 * correction overwrites something a planter already wrote.
 *
 * Marks the plant dirty afterwards for LS-008's reason: the corrected counts are
 * facts the snapshot reads, so the next assessment must see them. Best-effort
 * and after the durable write, exactly as recording is. And exactly as recording
 * does, it does NOT touch `current_phase` — the engine stays advisory.
 */
export async function updateLaunchOutcome(
  user: User,
  churchId: string,
  input: LaunchOutcomeInput
): Promise<UpdateLaunchOutcomeResult> {
  assertSeatFor(user, "launch.schedule");
  await requireChurchAccess(user, churchId);

  const parsed = launchOutcomeSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0].message };
  }

  const result = await db.execute<{ launch_id: string; target_date: string }>(
    updateLaunchOutcomeStatement({
      churchId,
      actorUserId: user.id,
      ...parsed.data,
    })
  );

  const written = result.rows[0];

  if (!written) {
    // Nothing was written, and the reasons are different answers: there is
    // nothing recorded to correct, or the correction WAS the stored record.
    // The second is a success — a saved form that changed nothing — and must
    // not be reported as a failure.
    const stored = await getLaunchForChurch(churchId);
    if (!stored?.targetDate) {
      return { status: "error", error: OUTCOME_NO_LAUNCH_MESSAGE };
    }
    if (stored.status !== "completed" || stored.outcomeRecordedAt === null) {
      return { status: "error", error: OUTCOME_NOT_RECORDED_MESSAGE };
    }
    return { status: "unchanged", targetDate: stored.targetDate };
  }

  await markPlantDirty(churchId);

  return { status: "updated", targetDate: written.target_date };
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

/**
 * May the recorded outcome still be corrected? The UI's copy of
 * `updateLaunchOutcomeStatement`'s guard, and NO CLOCK — a correction has no
 * deadline, so nothing here compares days. The write is what decides; this only
 * stops the page offering a form the server would refuse.
 */
export function canEditOutcome(
  launch: { status: string; outcomeRecordedAt: Date | null } | null
): boolean {
  return launch?.status === "completed" && launch.outcomeRecordedAt !== null;
}
