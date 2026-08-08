// ============================================================================
// Launch — the write path, and the ONLY place a launch date is set (LS-001/2/7).
//
// NO `"use server"` DIRECTIVE. Every export of such a module is a POSTable
// endpoint reachable with no session and no UI, so the export list would BE the
// auth surface (memory/invariants.md → Authentication; the #265 rules). The
// helpers below take bare ids and build raw SQL — none of them may be
// re-exported from an action module. `setLaunchDate` authorises itself anyway,
// belt and braces, for the same reason its predecessor did.
//
// WHAT REPLACED WHAT. This module is the successor to
// `src/lib/churches/launch-date.ts`, deleted with migration 0032. That file
// compare-and-set a column on `churches`; the column is gone and the entity is
// the only owner (LS-001). The MILESTONE NOTIFICATION contract is unchanged —
// `announceLaunchDateChanged` still fires, still only on a real change, still
// best-effort and after the durable write — because oversight recipients did
// not ask for a schema migration and must not be able to tell one happened.
// ============================================================================

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import type { User } from "@/db/schema";
import type { LaunchStatus } from "@/db/schema/launch";
import { requireChurchAccess, requireRole } from "@/lib/auth/access";
import { announceLaunchDateChanged } from "@/lib/notifications/oversight";
import { launchNoteSchema, launchTargetDateSchema } from "./validation";

// ----------------------------------------------------------------------------
// Messages
// ----------------------------------------------------------------------------

/**
 * A completed launch's date is history, not a plan. Re-dating one would rewrite
 * what the outcome record says happened, so it is refused rather than journaled
 * — corrections to a recorded outcome are the outcome path's business (LS-006),
 * which edits the outcome fields and leaves the day it happened on alone.
 */
export const LAUNCH_ALREADY_COMPLETED_MESSAGE =
  "This launch is already recorded as completed. Edit the outcome instead of moving the date.";

/**
 * Somebody else moved the date while this request was in flight. Distinct from
 * `unchanged` on purpose: "your date is already the stored one" and "the stored
 * one is now something you have not seen" are different facts, and telling a
 * planter the first when the second happened hides a lost update.
 */
export const LAUNCH_CHANGED_ELSEWHERE_MESSAGE =
  "The launch date changed while you were editing. Reload to see the current date.";

// ----------------------------------------------------------------------------
// Result
// ----------------------------------------------------------------------------

export type SetLaunchDateResult =
  | { status: "changed"; targetDate: string; launchStatus: LaunchStatus }
  | { status: "unchanged"; targetDate: string }
  | { status: "error"; error: string };

export interface SetLaunchDateOptions {
  /**
   * `true` when the planter is POSTPONING a launch that was already scheduled,
   * rather than moving a date around (LS-009). It changes two things and only
   * two: the journal's event (`postponed` vs `moved`) and the launch's new
   * status. A first commitment is `scheduled` either way — there is nothing to
   * postpone from.
   */
  postpone?: boolean;
  /** The planter's stated reason, when a surface collects one. */
  note?: string | null;
}

// ----------------------------------------------------------------------------
// The statement
// ----------------------------------------------------------------------------

/**
 * Create-or-move the launch date AND journal it — one statement, one round trip,
 * one transaction.
 *
 * WHY ONE STATEMENT AND NOT `db.batch`. Both writes are known up front, so the
 * repo's usual shape would be a batch (memory/invariants.md → Atomicity). It
 * does not fit here for two reasons:
 *
 *   * the journal needs the OLD values, which the update destroys. Reading them
 *     in a separate SELECT first would make the journal's "from" a snapshot: a
 *     concurrent move would be recorded as having come from a date it did not.
 *   * the journal needs the launch's id, which on the create path does not
 *     exist until the insert runs. A batch statement cannot consume a previous
 *     statement's `RETURNING`.
 *
 * A `WITH` chain gives both — `current` is read (and LOCKED) in the same
 * statement that overwrites it, and `written` carries the new row's id straight
 * into the journal insert.
 *
 * THE GUARDS, in order:
 *
 *   `current`   `SELECT … FOR UPDATE` on the plant's launch row. Two planters
 *               moving the date at once compete for the SAME row, so this is a
 *               real lock and not a snapshot predicate — the second waits for
 *               the first to commit and then re-reads (invariants → Atomicity,
 *               the `lockTargetRow` rule).
 *   `inserted`  runs only when there is no launch yet, and carries
 *               `ON CONFLICT (church_id) DO NOTHING` because `FOR UPDATE` locks
 *               nothing when the row does not exist: two concurrent FIRST
 *               schedules both see an empty `current`, and the unique index —
 *               not this CTE — is what makes one of them lose. The loser writes
 *               nothing at all, including no journal row.
 *   `updated`   compare-and-set on `target_date IS DISTINCT FROM` the new one
 *               OR `status IS DISTINCT FROM` the new one, so re-saving an
 *               unchanged row writes nothing and announces nothing — while a
 *               planter who POSTPONED and then re-commits to the SAME Sunday
 *               still lands a write, which a date-only predicate refused and
 *               left showing `Postponed` to the plant and to oversight.
 *               `IS DISTINCT FROM` rather than `<>` so the null case (a
 *               `planning` launch acquiring its first date) is not silently
 *               dropped. `c.status <> 'completed'` refuses to re-date history.
 *   `journal`   sources its rows from `written`, so it can only ever fire for a
 *               write that actually landed. That is the whole reason the insert
 *               and the journal are not two statements.
 *
 * WHY THE UPDATE READS `FROM current c`, and why the journal does NOT join
 * `current`. A plain CTE is evaluated LAZILY, when something first pulls from
 * it. Written the obvious way — `update … where church_id = $1`, then a journal
 * that says `left join current c on true` — nothing pulls `current` until AFTER
 * the UPDATE has run, and a `SELECT … FOR UPDATE` re-read at that point finds a
 * row whose latest version its own command just wrote and SKIPS it
 * (`HeapTupleSelfUpdated`). `current` comes back empty, and because the join is
 * a LEFT one the journal still writes a row — carrying `previous_target_date`
 * NULL and `previous_status` coalesced to `'planning'`. That is a plausible
 * looking FALSE entry in an append-only history, which is worse than a missing
 * one. The same trap was diagnosed and fixed in `recordLaunchOutcomeStatement`
 * (`outcome.ts`); this is the identical fix. `current` is a DEPENDENCY of the
 * UPDATE, so it is evaluated and the row locked BEFORE anything modifies it,
 * and the old values travel to the journal through the same `RETURNING` rather
 * than through a second read that can no longer see them. The `inserted` arm
 * supplies the same two columns as constants, since a launch that did not exist
 * has no previous date and no previous status.
 *
 * The final `SELECT` returns zero rows when nothing was written, which the
 * caller resolves against the stored row: same date = `unchanged`, different
 * date = somebody else got there first.
 */
export function setLaunchDateStatement(input: {
  churchId: string;
  targetDate: string;
  actorUserId: string;
  postpone: boolean;
  note: string | null;
}): SQL {
  const nextStatus: LaunchStatus = input.postpone ? "postponed" : "scheduled";

  // A FIRST commitment is `scheduled` however it was reached — there is no
  // scheduled date to postpone from — so the event arm is chosen on what the
  // write actually did, not on the flag alone. A RE-COMMITMENT is `scheduled`
  // for the same reason: when the day did not move, nothing was moved, and a
  // journal row saying `moved` from a date to itself is a false description of
  // what the planter did.
  const eventExpression = input.postpone
    ? sql`case
            when w.previous_target_date is null then 'scheduled'
            else 'postponed'
          end`
    : sql`case
            when w.previous_target_date is null then 'scheduled'
            when w.previous_target_date = w.target_date then 'scheduled'
            else 'moved'
          end`;

  return sql`
    with current as (
      select id, target_date, status
      from launches
      where church_id = ${input.churchId}
      for update
    ), inserted as (
      insert into launches (church_id, target_date, status)
      select ${input.churchId}, ${input.targetDate}, ${nextStatus}
      where not exists (select 1 from current)
      on conflict (church_id) do nothing
      returning
        id,
        null::date as previous_target_date,
        'planning'::varchar as previous_status,
        target_date,
        status,
        updated_at
    ), updated as (
      update launches l
      set target_date = ${input.targetDate},
          status = ${nextStatus},
          updated_at = now()
      from current c
      where l.id = c.id
        and c.status <> 'completed'
        and (
          c.target_date is distinct from ${input.targetDate}::date
          or c.status is distinct from ${nextStatus}::varchar
        )
      returning
        l.id,
        c.target_date as previous_target_date,
        c.status as previous_status,
        l.target_date,
        l.status,
        l.updated_at
    ), written as (
      select * from inserted
      union all
      select * from updated
    ), journal as (
      insert into launch_events (
        launch_id, church_id, event,
        previous_target_date, target_date,
        previous_status, status,
        actor_user_id, note
      )
      select
        w.id,
        ${input.churchId},
        ${eventExpression},
        w.previous_target_date,
        w.target_date,
        w.previous_status,
        w.status,
        ${input.actorUserId},
        ${input.note}
      from written w
      returning id
    )
    select
      w.id as launch_id,
      w.target_date as target_date,
      w.status as status,
      w.updated_at as updated_at,
      (select name from churches where id = ${input.churchId}) as church_name
    from written w
  `;
}

interface WriteRow extends Record<string, unknown> {
  launch_id: string;
  target_date: string;
  status: LaunchStatus;
  updated_at: string | Date;
  church_name: string | null;
}

// ----------------------------------------------------------------------------
// The action-facing entrypoint
// ----------------------------------------------------------------------------

/**
 * Set, move, or postpone a plant's launch date.
 *
 * AUTHORISES ITSELF, and the rule is LS-007's: the PLANTER of THIS plant.
 * `requireRole` refuses a coach or an oversight admin — an oversight admin has
 * church ACCESS to an associated plant and would sail past `requireChurchAccess`
 * alone, which would let the milestone notification announce itself to the
 * person who caused it — and `requireChurchAccess` refuses a planter aimed at
 * somebody else's plant. Both THROW, so a caller cannot proceed by ignoring the
 * return value; the `error` status is reserved for a date the user typed wrong.
 *
 * The announcement is best-effort and happens AFTER the durable write: a
 * notification must never be why a planter's date failed to save, and
 * announcing a date that was not stored would be a lie. A crash in between
 * loses the notification, not the date — and a retry writes nothing (the date
 * now matches) so the notification stays lost. That trade is unchanged from the
 * column era.
 */
export async function setLaunchDate(
  user: User,
  churchId: string,
  targetDate: string,
  options: SetLaunchDateOptions = {}
): Promise<SetLaunchDateResult> {
  requireRole(user, "planter");
  await requireChurchAccess(user, churchId);

  const parsed = launchTargetDateSchema.safeParse(targetDate);
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0].message };
  }

  // The note is free text bound for an APPEND-ONLY table, so its length is
  // checked here and not only in the textarea that usually types it: the
  // textarea is not the endpoint, and this service has callers that are not
  // that form (Zod at every boundary).
  const parsedNote = launchNoteSchema.safeParse(options.note ?? null);
  if (!parsedNote.success) {
    return { status: "error", error: parsedNote.error.issues[0].message };
  }

  const result = await db.execute<WriteRow>(
    setLaunchDateStatement({
      churchId,
      targetDate: parsed.data,
      actorUserId: user.id,
      postpone: options.postpone ?? false,
      note: parsedNote.data,
    })
  );

  const written = result.rows[0];

  if (!written) {
    // Nothing was written. Three states produce that, and they are not the same
    // answer, so the stored row decides rather than a guess.
    const { getLaunchForChurch } = await import("./queries");
    const stored = await getLaunchForChurch(churchId);
    if (stored?.status === "completed") {
      return { status: "error", error: LAUNCH_ALREADY_COMPLETED_MESSAGE };
    }
    if (stored?.targetDate === parsed.data) {
      return { status: "unchanged", targetDate: parsed.data };
    }
    return { status: "error", error: LAUNCH_CHANGED_ELSEWHERE_MESSAGE };
  }

  await announceLaunchDateChanged({
    churchId,
    plantName: written.church_name ?? "",
    launchDate: parsed.data,
    changedAt: new Date(written.updated_at),
  });

  return {
    status: "changed",
    targetDate: parsed.data,
    launchStatus: written.status,
  };
}
