// ============================================================================
// THE SEATS A PLANT HOLDS, AND THE FOUR ACTS THAT CHANGE THEM — AS-015 through
// AS-018 and AS-023 (#497).
//
// One module, because the four verbs share one subject: a row in `users` whose
// `church_id` is this plant. The roster READ is here for the same reason — it
// is the same subject seen from the other side, and a reader that disagreed
// with the writers about who is on this plant is how a control appears beside
// somebody the action would refuse.
//
// THE ACTOR IS BRANDED AND CARRIES THE PLANT. `SeatManagementActor` is minted
// only by `seatActorFromSession`, so a bare `User` — the shape a forged payload
// could carry — is not assignable, and the mint REFUSES an account with no
// plant. That is what makes `churchId: string` rather than `string | null`
// here: every query below puts the actor's own plant in its `WHERE`, so there
// is no route param, query string or form field anywhere on this surface that
// names a plant, and a target seated somewhere else is simply not found.
//
// The mint is also the tenancy half of the authority rule. `seat.manage` is
// declared `tenancy: "any"` in `@/lib/auth/seat-rules` because the ruling gives
// the verb to an Owner in all THREE tenancies; this track ships the plant side,
// so an oversight Owner passes `requireSeat` and is then refused here for
// having no plant. Fail-closed, and in one place rather than per verb.
//
// WHY THE REMOVAL IS ONE `db.batch` WITH THE MARKER LAST
// ----------------------------------------------------------------------------
// `db.transaction()` throws on neon-http; `db.batch([...])` is the only atomic
// unit (`memory/invariants/transactions-atomicity.md`). The five effects the
// FRD pins are ordered so the CLEARING OF THE TENANCY IS THE LAST STATEMENT:
//
//   1. sessions deleted      — redo-safe, keyed on the account
//   2. open tasks reassigned — redo-safe, keyed on the plant and the assignee
//   3. team leadership nulled — redo-safe, idempotent by construction
//   4. MARKER: `church_id` and `seat` set NULL
//
// Every earlier step is redo-safe, which is exactly what a marker-last sequence
// requires: a replayed request re-runs three no-ops and a marker that now
// matches zero rows.
//
// THE MARKER IS A COMPARE-AND-SET, AND ITS ROWCOUNT IS READ. Its `WHERE`
// re-asserts what the pre-read decided — still this plant, still not the Owner
// — so two removals of one target serialise on it. What that does NOT do is
// roll the batch back: `db.batch` is all-or-nothing on FAILURE, and a zero-row
// UPDATE is a success, so a stale read still COMMITS statements 1–3. Each of
// them is scoped to the same target and plant, so what commits is three no-ops
// — but the call must not then report success, which is why `removeSeat` reads
// `marked` and refuses on an empty one.
//
// Every statement carries `actor.churchId`, including the sessions delete,
// which reaches it through an `exists` because its own subject is keyed by the
// account. That uniformity is the tenancy leak guard, and `roster.test.ts`
// asserts it statement by statement.
//
// The person record is effect (3) of the FRD's five by being ABSENT: nothing
// below touches `persons` or `team_memberships`, because a person record and an
// account are separate things and losing the account must not lose the roster.
// The only `persons` read is the subquery that finds which team this account
// LEADS — leadership is a decision about a person, and clearing it is what makes
// the team read as an open leader slot rather than silently handing it on.
// ============================================================================

import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  coachAssignments,
  ministryTeams,
  persons,
  sessions,
  tasks,
  users,
  type UserSeat,
} from "@/db/schema";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import type { SessionValidationResult } from "@/lib/auth/session";

declare const seatManagementActorBrand: unique symbol;

/**
 * Whoever is managing seats, and the plant they are managing them in.
 *
 * Minted only by `seatActorFromSession`, so an authority decision can never be
 * handed a user object that arrived from a client — the same technique
 * `InvitationActor` uses next door in `@/lib/invitations/core`.
 */
export type SeatManagementActor = {
  readonly id: string;
  readonly churchId: string;
  readonly [seatManagementActorBrand]: true;
};

/**
 * Raised when a legible business rule refuses the call. THE MESSAGE IS USER
 * COPY — the action shells render it verbatim and replace every other throw
 * with one neutral sentence, so an internal failure can never leak its wording
 * (the rule `ExpectedError` states for the ministry-teams service).
 */
export class SeatManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeatManagementError";
  }
}

/**
 * Mint an actor from a validated session.
 *
 * Takes the whole session result — the shape `verifySession()` returns — so the
 * call site reads as "the actor is whoever this request is authenticated as"
 * and there is no id parameter for a client value to slot into.
 *
 * @throws `SeatManagementError` when the account holds no plant. That is the
 * oversight Owner who passed `seat.manage`'s `tenancy: "any"`, and the copy
 * says what is missing without naming another tenancy.
 */
export function seatActorFromSession(
  session: SessionValidationResult
): SeatManagementActor {
  const { id, churchId } = session.user;

  if (!churchId) {
    throw new SeatManagementError(
      "Seat management is for a church plant's own team."
    );
  }

  return { id, churchId } as SeatManagementActor;
}

/** One person on the plant's seat roster, as AS-023 asks it to be read. */
export type SeatRosterRow = {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string;
  readonly seat: UserSeat;
  /**
   * `users.created_at`, which is the join date because registration grants the
   * tenancy and the seat in the SAME write that creates the account (AS-012) —
   * so for every account that exists today the two are one event.
   *
   * THE ONE CASE THAT WILL BREAK IT is a re-invite. AS-016 leaves the account
   * row alive so a removed person can be invited back, and that reuses this row
   * with `created_at` untouched — so the roster would report a join date
   * predating their removal. Nothing can re-invite yet (the surface is out of
   * #497's scope), so the column is accurate for every row that can exist.
   * Whoever ships re-invitation owes this label a real source: the accepted
   * `user_invitations` row for that address on this plant.
   */
  readonly joinedAt: Date;
};

/**
 * OWNER FIRST, THEN ADMINS, THEN MEMBERS, each group oldest first.
 *
 * Ordered in SQL rather than in the caller so the roster reads the same
 * wherever it is rendered, and because AS-023's "in one pass" is a claim about
 * the ORDER as much as about the columns.
 */
const SEAT_ORDER = sql`case ${users.seat} when 'owner' then 0 when 'admin' then 1 else 2 end`;

/**
 * Everyone holding a seat on this plant (AS-023).
 *
 * `ne(users.seat, ...)` is not needed and no seat filter is applied beyond
 * NOT NULL: an account with `church_id` set and `seat` NULL is not a member of
 * this plant's team — it is the shape a REMOVED account leaves behind before
 * its tenancy clears, and it must not reappear on the roster.
 */
export async function listSeatRoster(
  actor: SeatManagementActor
): Promise<SeatRosterRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      seat: users.seat,
      joinedAt: users.createdAt,
    })
    .from(users)
    .where(
      and(eq(users.churchId, actor.churchId), sql`${users.seat} is not null`)
    )
    .orderBy(SEAT_ORDER, users.createdAt);

  // The NOT NULL is in the `WHERE`; this narrows the TYPE to match, and is not
  // a second copy of the rule — `seat` is nullable on the column and the
  // projection has no way to know the predicate already settled it.
  return rows.filter((row): row is SeatRosterRow => row.seat !== null);
}

/** One active coach assignment on this plant, for the list beside the roster. */
export type PlantCoachRow = {
  readonly assignmentId: string;
  readonly coachUserId: string;
  readonly name: string | null;
  readonly email: string;
  readonly assignedAt: Date;
};

/**
 * The coaches who reach this plant right now (AS-024's list, AS-018's subject).
 *
 * ACTIVE ONLY. An ended assignment is history, and rendering it beside a live
 * one would offer an "End assignment" control whose own guard is guaranteed to
 * refuse it — the same reason `/settings/team` expires lapsed invitations
 * before it lists them.
 */
export async function listPlantCoaches(
  actor: SeatManagementActor
): Promise<PlantCoachRow[]> {
  return db
    .select({
      assignmentId: coachAssignments.id,
      coachUserId: coachAssignments.coachUserId,
      name: users.name,
      email: users.email,
      assignedAt: coachAssignments.assignedAt,
    })
    .from(coachAssignments)
    .innerJoin(users, eq(users.id, coachAssignments.coachUserId))
    .where(
      and(
        eq(coachAssignments.churchId, actor.churchId),
        eq(coachAssignments.status, "active")
      )
    )
    .orderBy(coachAssignments.assignedAt);
}

/**
 * Move one seat between `member` and `admin` (AS-015).
 *
 * A COMPARE-AND-SET, AND THE `from` SEAT IS HALF THE PREDICATE. The update
 * matches only a row that is still on this plant AND still holds the seat the
 * caller believed it held, so a double submit changes nothing the first one
 * did, and the Owner's row is unreachable from either direction — `owner`
 * equals neither `from` value, so no `ne(seat, 'owner')` guard is needed or
 * written. One statement, so there is nothing here to batch.
 */
async function moveSeat(
  actor: SeatManagementActor,
  targetUserId: string,
  from: UserSeat,
  to: UserSeat,
  refusal: string
): Promise<void> {
  const moved = await db
    .update(users)
    .set({ seat: to, updatedAt: new Date() })
    .where(
      and(
        eq(users.id, targetUserId),
        eq(users.churchId, actor.churchId),
        eq(users.seat, from)
      )
    )
    .returning({ id: users.id });

  if (moved.length === 0) throw new SeatManagementError(refusal);
}

/** Appoint a Member to Admin (AS-015). */
export async function appointAdmin(
  actor: SeatManagementActor,
  targetUserId: string
): Promise<void> {
  await moveSeat(
    actor,
    targetUserId,
    "member",
    "admin",
    "That person is no longer a Member of this plant. Reload the page to see who is on the team."
  );
}

/** Demote an Admin to Member (AS-015). */
export async function demoteToMember(
  actor: SeatManagementActor,
  targetUserId: string
): Promise<void> {
  await moveSeat(
    actor,
    targetUserId,
    "admin",
    "member",
    "That person is no longer an Admin of this plant. Reload the page to see who is on the team."
  );
}

/**
 * Remove a seat, with the five effects the FRD pins (AS-016, AS-017).
 *
 * THE PRE-READ IS THE AUTHORIZATION DECISION and the reason it is scoped to the
 * actor's own plant: a forged `targetUserId` naming somebody else's account is
 * refused HERE, before the batch deletes a single session. Removing the check
 * and trusting the marker's `WHERE` would let statements 1–3 fire against an
 * account this Owner may not touch.
 *
 * THE SELF-REMOVAL REFUSAL IS SEPARATE FROM THE OWNER REFUSAL on purpose. They
 * are the same row today — a plant has exactly one Owner and it is the only
 * account that reaches this verb — but they are different rules (AS-017 is
 * about the ACTOR; the seat check is about the TARGET), and collapsing them
 * would silently widen the day an org's second Owner-equivalent appears.
 */
export async function removeSeat(
  actor: SeatManagementActor,
  targetUserId: string
): Promise<void> {
  if (targetUserId === actor.id) {
    throw new SeatManagementError(
      "You cannot remove your own seat. Ownership has to be handed over first."
    );
  }

  const [target] = await db
    .select({
      seat: users.seat,
      churchId: users.churchId,
      sendingChurchId: users.sendingChurchId,
      sendingNetworkId: users.sendingNetworkId,
    })
    .from(users)
    .where(and(eq(users.id, targetUserId), eq(users.churchId, actor.churchId)))
    .limit(1);

  if (!target || !target.seat) {
    throw new SeatManagementError(
      "That person is not on this plant's team. Reload the page to see who is."
    );
  }

  // THE OWNER IS THE ACCOUNT THAT ITSELF CARRIES `seat.manage`, asked of the
  // capability table rather than spelled `seat === "owner"` here. That is the
  // rule with one spelling (`seat-guard.test.ts` fails on a hand-compared seat),
  // and it is also the honest sentence: what may not be removed is the account
  // holding the authority to remove. Handing ownership over is #342's verb.
  if (holdsSeatFor(target, "seat.manage")) {
    throw new SeatManagementError("The plant's Owner cannot be removed.");
  }

  const [, , , marked] = await db.batch([
    // 1. SESSIONS REVOKED. Deleting the rows rather than expiring them: the
    //    session store is the only record of a live sign-in, so "holds nothing
    //    for that account" is the state AS-016 asks for, and the next request
    //    carrying the old cookie finds no row and is unauthenticated.
    //
    //    THE `exists` IS THE LEAK GUARD, and it is here because this is the only
    //    statement whose subject is keyed by the ACCOUNT rather than by the
    //    plant — statements 2–4 all carry `actor.churchId` in their own `WHERE`.
    //    Without it, a target that moved tenancy between the pre-read and this
    //    batch would still be signed out of a plant this actor has no authority
    //    over. It reads `users` BEFORE the marker writes it (statement order is
    //    the whole point), and on a replay the marker has already cleared
    //    `church_id`, so it correctly matches nothing.
    db.delete(sessions).where(
      and(
        eq(sessions.userId, targetUserId),
        sql`exists (
            select 1 from ${users}
            where ${users.id} = ${targetUserId}
              and ${users.churchId} = ${actor.churchId}
          )`
      )
    ),

    // 2. OPEN TASKS TO THE OWNER, COMPLETED ONES LEFT ALONE. An unassigned task
    //    disappears from every "my work" view, so the plant would silently lose
    //    the commitment; a completed one is a record of what happened and
    //    reassigning it would rewrite that. `ne(status, "complete")` rather
    //    than an `inArray` of the other three, so a new open status is covered
    //    the day it is added instead of being silently dropped.
    db
      .update(tasks)
      .set({ assignedToId: actor.id, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.churchId, actor.churchId),
          eq(tasks.assignedToId, targetUserId),
          ne(tasks.status, "complete")
        )
      ),

    // 3. MINISTRY-TEAM LEADERSHIP CLEARED, so the team reads as an open leader
    //    slot (`listTeams` returns `leaderName: null` for it). `leader_id`
    //    names a PERSON, not an account, so the account is resolved to its
    //    person record through `persons.user_id` — the link AS-013 writes — and
    //    both halves stay scoped to this plant.
    db
      .update(ministryTeams)
      .set({ leaderId: null, updatedAt: new Date() })
      .where(
        and(
          eq(ministryTeams.churchId, actor.churchId),
          sql`${ministryTeams.leaderId} in (
            select ${persons.id} from ${persons}
            where ${persons.churchId} = ${actor.churchId}
              and ${persons.userId} = ${targetUserId}
          )`
        )
      ),

    // 4. THE MARKER, LAST. Tenancy and seat cleared; the account ROW survives,
    //    which is what lets the person be re-invited and what keeps every
    //    `created_by` and `assigned_to_id` elsewhere pointing at a real row.
    //
    //    ALL THREE TENANCY FKs, NOT JUST `church_id`, AND THAT IS A SECURITY
    //    RULE RATHER THAN TIDINESS. A row naming TWO tenancies is representable
    //    (`memory/invariants.md` → Seats & Tenancy: the accepted residual
    //    migration 0050 §1 repaired twelve of). Such a row reaches NOTHING today
    //    because `oversightOrgOf` answers only for exactly one FK — so clearing
    //    `church_id` alone would leave one FK standing and PROMOTE the account
    //    into that org's oversight surface, which `requireOversightUser` admits
    //    on the FK alone without asking the seat. A removal that widens reach is
    //    the one outcome this verb must never have, so the marker clears every
    //    FK and the row names no tenancy at all.
    db
      .update(users)
      .set({
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId: null,
        seat: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, targetUserId),
          eq(users.churchId, actor.churchId),
          ne(users.seat, "owner")
        )
      )
      .returning({ id: users.id }),
  ]);

  // THE MARKER'S ROWCOUNT IS THE ANSWER, and a zero here is not an error the
  // batch rolled back — `db.batch` is all-or-nothing on FAILURE, and a zero-row
  // UPDATE is a success, so statements 1–3 have already committed. What they
  // committed is three no-ops: each one is scoped to a target that, by the
  // marker matching nothing, is no longer on this plant. So the state is
  // consistent and what is left to get right is the REPORT — telling an Owner
  // their removal succeeded when the roster is about to re-render unchanged is
  // the one failure this cannot leave standing. `moveSeat` and
  // `endCoachAssignment` both answer on their own rowcount for the same reason.
  if (marked.length === 0) {
    throw new SeatManagementError(
      "That person is not on this plant's team. Reload the page to see who is."
    );
  }
}

/**
 * End a coach assignment (AS-018) — the same act with a smaller blast radius.
 *
 * The assignment goes inactive and NOTHING ELSE CHANGES: no seat, no tenancy,
 * no data moved. `getAccessibleChurchIds` reads only `status = 'active'`, so the
 * coach loses this plant on their next request without a session revocation —
 * a coach may hold assignments on other plants, and signing them out of those
 * is not what this verb was asked to do.
 */
export async function endCoachAssignment(
  actor: SeatManagementActor,
  assignmentId: string
): Promise<void> {
  const ended = await db
    .update(coachAssignments)
    .set({ status: "inactive" })
    .where(
      and(
        eq(coachAssignments.id, assignmentId),
        eq(coachAssignments.churchId, actor.churchId),
        eq(coachAssignments.status, "active")
      )
    )
    .returning({ id: coachAssignments.id });

  if (ended.length === 0) {
    throw new SeatManagementError(
      "That coach assignment is no longer active. Reload the page to see who is coaching this plant."
    );
  }
}
