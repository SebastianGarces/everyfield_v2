// ============================================================================
// THE SEATS A TENANCY HOLDS, AND THE FOUR ACTS THAT CHANGE THEM — AS-015
// through AS-018 and AS-023 (#497, widened to the org side by #500).
//
// One module, because the four verbs share one subject: a row in `users` whose
// tenancy FK is this one. The roster READ is here for the same reason — it is
// the same subject seen from the other side, and a reader that disagreed with
// the writers about who is on this team is how a control appears beside
// somebody the action would refuse.
//
// THE ACTOR IS BRANDED AND CARRIES THE TENANCY. `SeatManagementActor` is minted
// only by `seatActorFromSession`, so a bare `User` — the shape a forged payload
// could carry — is not assignable, and the mint REFUSES an account that names
// no tenancy at all. That is what makes `tenancy: SeatTenancy` rather than a
// nullable one here: every query below puts the actor's own tenancy in its
// `WHERE` through `inTenancy`, so there is no route param, query string or form
// field anywhere on this surface that names a team, and a target seated
// elsewhere is simply not found.
//
// ONE VALUE, NOT THREE FKs. The tenancy comes from `tenancyOf`, which answers
// only for a row naming EXACTLY ONE — so the two-tenancy defect
// (`memory/invariants.md` → Seats & Tenancy) mints no actor and reaches nothing
// here, in the same place the no-tenancy account is refused.
//
// The mint is also the tenancy half of the authority rule. `seat.manage` is
// declared `tenancy: "any"` in `@/lib/auth/seat-rules` because the ruling gives
// the verb to an Owner in all three tenancies; what it does NOT cover is the
// registered Owner whose plant does not exist yet, and that account is refused
// here. Fail-closed, and in one place rather than per verb.
//
// TWO VERBS STAY A PLANT'S. `listPlantCoaches` and `endCoachAssignment` go
// through `plantOf`, which refuses an org with a sentence: coaching is a
// relationship with a church plant, and a `coach_assignments.church_id` scoped
// by a network's id would read as an answer and be none.
//
// WHY THE REMOVAL IS ONE `db.batch` WITH THE MARKER LAST
// ----------------------------------------------------------------------------
// `db.transaction()` throws on neon-http; `db.batch([...])` is the only atomic
// unit (`memory/invariants/transactions-atomicity.md`). The effects the FRD
// pins are ordered so the CLEARING OF THE TENANCY IS THE LAST STATEMENT:
//
//   1. sessions deleted      — redo-safe, keyed on the account
//   2. open tasks reassigned — redo-safe, keyed on the plant and the assignee
//   3. team leadership nulled — redo-safe, idempotent by construction
//   4. MARKER: every tenancy FK and `seat` set NULL
//
// Every earlier step is redo-safe, which is exactly what a marker-last sequence
// requires: a replayed request re-runs no-ops and a marker that now matches
// zero rows.
//
// STEPS 2 AND 3 ARE THE PLANT'S ALONE (#500), so there are TWO batch shapes:
// `[1, 2, 3, 4]` for a plant and `[1, 4]` for an org, which has neither `tasks`
// nor `ministry_teams`. The marker is last in both, which is all the ordering
// argument needs. `plantRemovalEffects` holds the pair so the batch literal
// still reads as the ordered effects.
//
// THE MARKER IS A COMPARE-AND-SET, AND ITS ROWCOUNT IS READ. Its `WHERE`
// re-asserts what the pre-read decided — still this tenancy, still not the
// Owner — so two removals of one target serialise on it. What that does NOT do
// is roll the batch back: `db.batch` is all-or-nothing on FAILURE, and a
// zero-row UPDATE is a success, so a stale read still COMMITS the earlier
// statements. Each of them is scoped to the same target and tenancy, so what
// commits is no-ops — but the call must not then report success, which is why
// `removeSeat` reads `marked` and refuses on an empty one.
//
// Every statement carries the actor's own tenancy, the sessions delete through
// an `exists` because its own subject is keyed by the account. That uniformity
// is the tenancy leak guard, and `roster.test.ts` asserts it statement by
// statement.
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
import {
  tenancyOf,
  type SeatTenancy,
  type SeatTenancyType,
} from "@/lib/auth/tenancy";
import { TENANCY_NOUN } from "@/lib/invitations/seat-copy";

declare const seatManagementActorBrand: unique symbol;

/**
 * Whoever is managing seats, and the tenancy they are managing them in.
 *
 * Minted only by `seatActorFromSession`, so an authority decision can never be
 * handed a user object that arrived from a client — the same technique
 * `InvitationActor` uses next door in `@/lib/invitations/core`.
 */
export type SeatManagementActor = {
  readonly id: string;
  /**
   * THE TENANCY BEING STAFFED — a church plant, a sending church or a network
   * (#500). One value rather than three nullable FKs, so every `WHERE` below
   * names the actor's own column by construction and a target seated in another
   * tenancy is simply not found.
   */
  readonly tenancy: SeatTenancy;
  readonly [seatManagementActorBrand]: true;
};

/**
 * WHICH `users` COLUMN A TENANCY IS. The sibling of `TENANCY_COLUMN` in
 * `@/lib/invitations/seat`, over this table — a `Record` over
 * `SeatTenancyType`, so a fourth kind is a compile error rather than a `WHERE`
 * that silently matches nothing.
 */
const USER_TENANCY_COLUMN = {
  church: users.churchId,
  sending_church: users.sendingChurchId,
  network: users.sendingNetworkId,
} as const satisfies Record<SeatTenancyType, unknown>;

/** `<the tenancy's column> = <its id>` — the scope every read and write shares. */
function inTenancy(tenancy: SeatTenancy) {
  return eq(USER_TENANCY_COLUMN[tenancy.type], tenancy.id);
}

/**
 * The PLANT this actor is staffing, for the two verbs that are a plant's alone.
 *
 * Coaching is a relationship with a CHURCH PLANT and has no org-side form: a
 * sending church does not coach, it oversees. So the coach list and the
 * assignment-ending verb ask for the plant explicitly and refuse an org actor
 * with a sentence, rather than silently querying `coach_assignments.church_id`
 * with a sending church's id and answering "no coaches".
 */
function plantOf(actor: SeatManagementActor): string {
  if (actor.tenancy.type !== "church") {
    throw new SeatManagementError(
      "Coaching assignments belong to a church plant."
    );
  }
  return actor.tenancy.id;
}

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
 * @throws `SeatManagementError` when the account names no tenancy at all. That
 * is the registered Owner whose plant does not exist yet, who passed
 * `seat.manage`'s `tenancy: "any"` — and the two-tenancy defect
 * (`memory/invariants.md` → Seats & Tenancy), which `tenancyOf` resolves to
 * nothing so that it reaches nothing here either.
 */
export function seatActorFromSession(
  session: SessionValidationResult
): SeatManagementActor {
  const { id } = session.user;
  const tenancy = tenancyOf(session.user);

  if (!tenancy) {
    throw new SeatManagementError(
      "Seat management is for a team you belong to. Create your church plant first."
    );
  }

  return { id, tenancy } as SeatManagementActor;
}

/** One person on the tenancy's seat roster, as AS-023 asks it to be read. */
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
   * `user_invitations` row for that address in this tenancy.
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
 * Everyone holding a seat in this tenancy (AS-023).
 *
 * `ne(users.seat, ...)` is not needed and no seat filter is applied beyond
 * NOT NULL: an account carrying the tenancy FK with `seat` NULL is not a member
 * of this team — it is the shape a REMOVED account leaves behind before its
 * tenancy clears, and it must not reappear on the roster.
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
    .where(and(inTenancy(actor.tenancy), sql`${users.seat} is not null`))
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
        eq(coachAssignments.churchId, plantOf(actor)),
        eq(coachAssignments.status, "active")
      )
    )
    .orderBy(coachAssignments.assignedAt);
}

/**
 * Move one seat between `member` and `admin` (AS-015).
 *
 * A COMPARE-AND-SET, AND THE `from` SEAT IS HALF THE PREDICATE. The update
 * matches only a row that is still in this tenancy AND still holds the seat the
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
        inTenancy(actor.tenancy),
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
    `That person is no longer a Member of this ${TENANCY_NOUN[actor.tenancy.type]}. Reload the page to see who is on the team.`
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
    `That person is no longer an Admin of this ${TENANCY_NOUN[actor.tenancy.type]}. Reload the page to see who is on the team.`
  );
}

/**
 * STATEMENTS 2 AND 3 — the cascade a PLANT's removal runs, and no other
 * tenancy's (AS-016, #500).
 *
 * A named tuple rather than two statements inline in one branch of the batch,
 * so the batch literal reads as the four ordered effects the redo-safety
 * argument is about, and the plant-only pair has somewhere to state WHY it is
 * plant-only. Both are redo-safe, which is what lets them sit above the marker.
 *
 * `churchId` is passed rather than read off the actor because the caller has
 * already narrowed the tenancy — proving it again here would be the same check
 * twice, and passing the id is what makes the narrowing visible at the call
 * site.
 */
function plantRemovalEffects(
  actor: SeatManagementActor,
  churchId: string,
  targetUserId: string
) {
  return [
    // 2. OPEN TASKS TO THE OWNER, COMPLETED ONES LEFT ALONE. An unassigned task
    //    disappears from every "my work" view, so the plant would silently lose
    //    the commitment; a completed one is a record of what happened and
    //    reassigning it would rewrite that. `ne(status, "complete")` rather than
    //    an `inArray` of the other three, so a new open status is covered the
    //    day it is added instead of being silently dropped.
    db
      .update(tasks)
      .set({ assignedToId: actor.id, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.churchId, churchId),
          eq(tasks.assignedToId, targetUserId),
          ne(tasks.status, "complete")
        )
      ),

    // 3. MINISTRY-TEAM LEADERSHIP CLEARED, so the team reads as an open leader
    //    slot (`listTeams` returns `leaderName: null` for it). `leader_id` names
    //    a PERSON, not an account, so the account is resolved to its person
    //    record through `persons.user_id` — the link AS-013 writes — and both
    //    halves stay scoped to this plant.
    db
      .update(ministryTeams)
      .set({ leaderId: null, updatedAt: new Date() })
      .where(
        and(
          eq(ministryTeams.churchId, churchId),
          sql`${ministryTeams.leaderId} in (
            select ${persons.id} from ${persons}
            where ${persons.churchId} = ${churchId}
              and ${persons.userId} = ${targetUserId}
          )`
        )
      ),
  ] as const;
}

/**
 * WHAT A MISSING TARGET READS AS — one sentence, two call sites.
 *
 * The pre-read and the marker's rowcount are the same refusal seen a
 * millisecond apart, so they say the same words: telling them apart would
 * describe the internals of the batch to somebody who only needs to reload.
 */
function notOnTheTeam(actor: SeatManagementActor): string {
  return `That person is not on this ${TENANCY_NOUN[actor.tenancy.type]}'s team. Reload the page to see who is.`;
}

/**
 * Remove a seat, with the five effects the FRD pins (AS-016, AS-017).
 *
 * THE PRE-READ IS THE AUTHORIZATION DECISION and the reason it is scoped to the
 * actor's own tenancy: a forged `targetUserId` naming somebody else's account is
 * refused HERE, before the batch deletes a single session. Removing the check
 * and trusting the marker's `WHERE` would let the earlier statements fire
 * against an account this Owner may not touch.
 *
 * THE SELF-REMOVAL REFUSAL IS SEPARATE FROM THE OWNER REFUSAL on purpose. They
 * are the same row today — a tenancy has exactly one Owner and it is the only
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
    .where(and(eq(users.id, targetUserId), inTenancy(actor.tenancy)))
    .limit(1);

  if (!target || !target.seat) {
    throw new SeatManagementError(notOnTheTeam(actor));
  }

  // THE OWNER IS THE ACCOUNT THAT ITSELF CARRIES `seat.manage`, asked of the
  // capability table rather than spelled `seat === "owner"` here. That is the
  // rule with one spelling (`seat-guard.test.ts` fails on a hand-compared seat),
  // and it is also the honest sentence: what may not be removed is the account
  // holding the authority to remove. Handing ownership over is #342's verb.
  if (holdsSeatFor(target, "seat.manage")) {
    throw new SeatManagementError(
      `The ${TENANCY_NOUN[actor.tenancy.type]}'s Owner cannot be removed.`
    );
  }

  // 1. SESSIONS REVOKED. Deleting the rows rather than expiring them: the
  //    session store is the only record of a live sign-in, so "holds nothing
  //    for that account" is the state AS-016 asks for, and the next request
  //    carrying the old cookie finds no row and is unauthenticated.
  //
  //    THE `exists` IS THE LEAK GUARD, and it is here because this is the only
  //    statement whose subject is keyed by the ACCOUNT rather than by the
  //    tenancy — every other statement carries the actor's own tenancy column in
  //    its own `WHERE`. Without it, a target that moved tenancy between the
  //    pre-read and this batch would still be signed out of a tenancy this actor
  //    has no authority over. It reads `users` BEFORE the marker writes it
  //    (statement order is the whole point), and on a replay the marker has
  //    already cleared the FK, so it correctly matches nothing.
  const revokeSessions = db.delete(sessions).where(
    and(
      eq(sessions.userId, targetUserId),
      sql`exists (
            select 1 from ${users}
            where ${users.id} = ${targetUserId}
              and ${inTenancy(actor.tenancy)}
          )`
    )
  );

  // 4. THE MARKER, LAST IN BOTH BATCHES BELOW. Tenancy and seat cleared; the
  //    account ROW survives, which is what lets the person be re-invited and
  //    what keeps every `created_by` and `assigned_to_id` elsewhere pointing at
  //    a real row.
  //
  //    ALL THREE TENANCY FKs, NOT JUST THE ONE IT ACTED ON, AND THAT IS A
  //    SECURITY RULE RATHER THAN TIDINESS. A row naming TWO tenancies is
  //    representable (`memory/invariants.md` → Seats & Tenancy: the accepted
  //    residual migration 0050 §1 repaired twelve of). Such a row reaches
  //    NOTHING today because `tenancyOf` answers only for exactly one FK — so
  //    clearing one alone would leave one FK standing and PROMOTE the account
  //    into that org's oversight surface, which `requireOversightUser` admits on
  //    the FK alone without asking the seat. A removal that widens reach is the
  //    one outcome this verb must never have, so the marker clears every FK and
  //    the row names no tenancy at all.
  const mark = db
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
        inTenancy(actor.tenancy),
        ne(users.seat, "owner")
      )
    )
    .returning({ id: users.id });

  // TWO LITERAL BATCHES, NOT ONE WITH A SPREAD, AND THE DIFFERENCE IS THE
  // CASCADE (#500). Statements 2 and 3 are a PLANT's: a sending church and a
  // network have no `tasks` and no `ministry_teams`, so for them those writes
  // are not empty, they are meaningless — scoping a `church_id` column by an
  // org's id would read as an effect and be none. An org's removal is therefore
  // the access and nothing else, which is what the confirmation dialog promises
  // (`REMOVAL_CONSEQUENCES` in `@/components/settings/seat-roster`).
  //
  // Literal rather than a built array so each shape keeps its exact return type
  // and the marker is read by its own index rather than by arithmetic on a
  // dynamic one. It is LAST in both, which is the ordering the redo-safety
  // argument above rests on.
  const marked =
    actor.tenancy.type === "church"
      ? (
          await db.batch([
            revokeSessions,
            ...plantRemovalEffects(actor, actor.tenancy.id, targetUserId),
            mark,
          ])
        )[3]
      : (await db.batch([revokeSessions, mark]))[1];

  // THE MARKER'S ROWCOUNT IS THE ANSWER, and a zero here is not an error the
  // batch rolled back — `db.batch` is all-or-nothing on FAILURE, and a zero-row
  // UPDATE is a success, so the statements before it have already committed.
  // What they committed is no-ops: each one is scoped to a target that, by the
  // marker matching nothing, is no longer in this tenancy. So the state is
  // consistent and what is left to get right is the REPORT — telling an Owner
  // their removal succeeded when the roster is about to re-render unchanged is
  // the one failure this cannot leave standing. `moveSeat` and
  // `endCoachAssignment` both answer on their own rowcount for the same reason.
  if (marked.length === 0) {
    throw new SeatManagementError(notOnTheTeam(actor));
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
        eq(coachAssignments.churchId, plantOf(actor)),
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
