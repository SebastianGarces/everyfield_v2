import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  coachAssignments,
  ministryTeams,
  persons,
  sendingNetworks,
  sessions,
  tasks,
  teamMemberships,
  teamRoles,
  users,
} from "@/db/schema";
import { getAccessibleChurchIds } from "@/lib/auth/access";
import { listTeams } from "@/lib/ministry-teams/teams";

import {
  appointAdmin,
  demoteToMember,
  endCoachAssignment,
  listPlantCoaches,
  listSeatRoster,
  removeSeat,
  seatActorFromSession,
  SeatManagementError,
  type SeatManagementActor,
} from "./roster";

// ============================================================================
// #497 — SEAT MANAGEMENT AGAINST A REAL POSTGRES.
//
// WHY THIS IS THE LIVE SUITE AND NOT A UNIT TEST. Every acceptance criterion
// AS-016 states is a claim about WHAT THE NEXT READ SEES after a write — the
// session store holds nothing, the account row survives with two NULLs, the
// person record is untouched, the open task moved and the completed one did
// not, the leader slot reads open. None of that is a property of source. A
// rendered-SQL assertion would prove the statements were COMPOSED as intended
// and would have passed just as green on a cascade that reassigned completed
// tasks, cleared the wrong plant's leader, or deleted the person record — the
// three ways this change is easiest to get wrong.
//
// THE FIVE EFFECTS ARE ASSERTED AS FIVE SEPARATE READS over ONE removal, not
// as five removals. They are one `db.batch` and therefore one atomic decision;
// splitting them into five fixtures would let a batch that half-applied pass
// every test individually.
//
// EFFECT (3) IS AN ABSENCE and is asserted as one: the `persons` row and its
// `team_memberships` are re-read and compared to the values they held BEFORE
// the removal, because "left intact" is not observable from a row's existence
// alone — a cascade that nulled `persons.user_id` would leave the row and still
// break the rule the FRD is stating.
//
// OPT-IN, the convention every DB-backed suite here uses:
// `LIVE_DB_TESTS=1 pnpm test:live`. Everything written is namespaced by
// `SCRATCH_NAME` and swept in `after`.
// ============================================================================

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — the removal cascade is only observable as database state";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const SCRATCH_NAME = "__t497 seat management scratch__";
const scratchEmail = () => `${randomUUID()}@scratch.invalid`;

async function sweep(): Promise<void> {
  // FK order, deepest first: memberships → roles → teams → tasks → coach
  // assignments → sessions → persons → users → churches.
  const scratchChurches = sql`(select ${churches.id} from ${churches} where ${churches.name} = ${SCRATCH_NAME})`;
  const scratchUsers = sql`(select ${users.id} from ${users} where ${users.name} = ${SCRATCH_NAME})`;

  await db.execute(
    sql`delete from ${teamMemberships} where ${teamMemberships.churchId} in ${scratchChurches}`
  );
  await db.execute(
    sql`delete from ${teamRoles} where ${teamRoles.churchId} in ${scratchChurches}`
  );
  await db.execute(
    sql`delete from ${ministryTeams} where ${ministryTeams.churchId} in ${scratchChurches}`
  );
  await db.execute(
    sql`delete from ${tasks} where ${tasks.churchId} in ${scratchChurches}`
  );
  await db.execute(
    sql`delete from ${coachAssignments} where ${coachAssignments.churchId} in ${scratchChurches}`
  );
  await db.execute(
    sql`delete from ${sessions} where ${sessions.userId} in ${scratchUsers}`
  );
  await db.execute(
    sql`delete from ${persons} where ${persons.churchId} in ${scratchChurches}`
  );
  await db.delete(users).where(eq(users.name, SCRATCH_NAME));
  await db.delete(churches).where(eq(churches.name, SCRATCH_NAME));
  // The two-tenancy fixture's network, after the users referencing it are gone.
  await db
    .delete(sendingNetworks)
    .where(eq(sendingNetworks.name, SCRATCH_NAME));
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

/**
 * `seatActorFromSession` takes the shape `verifySession()` returns, so the
 * fixture builds that shape rather than casting into the brand — the mint is
 * part of what these tests exercise.
 */
function actorFor(userId: string, churchId: string): SeatManagementActor {
  return seatActorFromSession({
    session: {} as never,
    user: { id: userId, churchId } as never,
  });
}

async function makeChurch(): Promise<string> {
  const [church] = await db
    .insert(churches)
    .values({ name: SCRATCH_NAME, currentPhase: 1 })
    .returning({ id: churches.id });
  return church.id;
}

async function makeUser(
  churchId: string | null,
  seat: "owner" | "admin" | "member" | null
): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email: scratchEmail(),
      passwordHash: "scratch",
      name: SCRATCH_NAME,
      seat,
      churchId,
    })
    .returning({ id: users.id });
  return user.id;
}

/** A live session row for `userId`, the thing AS-016 requires to be gone. */
async function makeSession(userId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return id;
}

async function makeTask(
  churchId: string,
  createdById: string,
  assignedToId: string,
  status: "not_started" | "complete"
): Promise<string> {
  const [task] = await db
    .insert(tasks)
    .values({
      churchId,
      title: `${SCRATCH_NAME} ${status}`,
      status,
      assignedToId,
      createdById,
    })
    .returning({ id: tasks.id });
  return task.id;
}

// ----------------------------------------------------------------------------
// AS-015 — appoint and demote
// ----------------------------------------------------------------------------

test(
  "an Owner appoints a Member to Admin and demotes them back",
  { skip },
  async () => {
    const churchId = await makeChurch();
    const ownerId = await makeUser(churchId, "owner");
    const memberId = await makeUser(churchId, "member");
    const actor = actorFor(ownerId, churchId);

    await appointAdmin(actor, memberId);
    assert.equal(
      await seatOf(memberId),
      "admin",
      "AS-015: appointing a Member must leave them holding the Admin seat"
    );

    await demoteToMember(actor, memberId);
    assert.equal(
      await seatOf(memberId),
      "member",
      "AS-015: demoting an Admin must leave them holding the Member seat"
    );
  }
);

test(
  "appointing is a compare-and-set, so a repeat refuses rather than drifting",
  { skip },
  async () => {
    const churchId = await makeChurch();
    const ownerId = await makeUser(churchId, "owner");
    const memberId = await makeUser(churchId, "member");
    const actor = actorFor(ownerId, churchId);

    await appointAdmin(actor, memberId);

    // The second submit's `from` seat no longer matches. It must refuse with copy
    // rather than silently succeed — an Owner who double-clicked has to learn the
    // roster moved under them, and the seat must not be re-set from `admin`.
    await assert.rejects(
      () => appointAdmin(actor, memberId),
      SeatManagementError,
      "a second appoint of the same person must refuse"
    );
    assert.equal(await seatOf(memberId), "admin", "and must change nothing");
  }
);

test(
  "the Owner's own seat cannot be moved from either direction",
  { skip },
  async () => {
    const churchId = await makeChurch();
    const ownerId = await makeUser(churchId, "owner");
    const actor = actorFor(ownerId, churchId);

    await assert.rejects(
      () => appointAdmin(actor, ownerId),
      SeatManagementError,
      "the Owner holds neither `member` nor `admin`, so neither move matches"
    );
    await assert.rejects(
      () => demoteToMember(actor, ownerId),
      SeatManagementError
    );

    assert.equal(
      await seatOf(ownerId),
      "owner",
      "ownership is handed over by #342's verb, never by this surface"
    );
  }
);

test(
  "a target on another plant is not found, whatever the verb",
  { skip },
  async () => {
    // THE LEAK GUARD. Every statement puts the ACTOR's own `church_id` in its
    // `WHERE`, so a forged id naming a real account on a real other plant matches
    // no row — and the stranger's seat is untouched.
    const mine = await makeChurch();
    const theirs = await makeChurch();
    const ownerId = await makeUser(mine, "owner");
    await makeUser(theirs, "owner");
    const strangerId = await makeUser(theirs, "member");
    const actor = actorFor(ownerId, mine);

    await assert.rejects(
      () => appointAdmin(actor, strangerId),
      SeatManagementError
    );
    await assert.rejects(
      () => removeSeat(actor, strangerId),
      SeatManagementError
    );

    const stranger = await rowOf(strangerId);
    assert.equal(
      stranger.seat,
      "member",
      "the other plant's Member keeps their seat"
    );
    assert.equal(stranger.churchId, theirs, "and keeps their plant");
  }
);

// ----------------------------------------------------------------------------
// AS-017 — an Owner may not remove their own seat
// ----------------------------------------------------------------------------

test(
  "an Owner removing themselves is refused, and keeps everything",
  { skip },
  async () => {
    const churchId = await makeChurch();
    const ownerId = await makeUser(churchId, "owner");
    const sessionId = await makeSession(ownerId);
    const actor = actorFor(ownerId, churchId);

    await assert.rejects(
      () => removeSeat(actor, ownerId),
      SeatManagementError,
      "AS-017: the action is refused when posted, not only hidden in the UI"
    );

    const owner = await rowOf(ownerId);
    assert.equal(owner.seat, "owner", "the Owner keeps their seat");
    assert.equal(owner.churchId, churchId, "and their plant");
    assert.equal(
      (await db.select().from(sessions).where(eq(sessions.id, sessionId)))
        .length,
      1,
      "and is not signed out by a refusal"
    );
  }
);

// ----------------------------------------------------------------------------
// AS-016 — the five effects, over ONE removal
// ----------------------------------------------------------------------------

test(
  "removing a seat runs all five effects and nothing else",
  { skip },
  async () => {
    const churchId = await makeChurch();
    const ownerId = await makeUser(churchId, "owner");
    const targetId = await makeUser(churchId, "admin");
    const actor = actorFor(ownerId, churchId);

    // Two live sessions, so "the store holds nothing for that account" is a claim
    // about every row rather than about the one the test happened to make.
    await makeSession(targetId);
    await makeSession(targetId);
    const ownerSessionId = await makeSession(ownerId);

    const openTaskId = await makeTask(
      churchId,
      ownerId,
      targetId,
      "not_started"
    );
    const doneTaskId = await makeTask(churchId, ownerId, targetId, "complete");

    // The target's PERSON record — the roster entry that must survive the account.
    const [person] = await db
      .insert(persons)
      .values({
        churchId,
        firstName: SCRATCH_NAME,
        lastName: "Target",
        userId: targetId,
        createdBy: ownerId,
      })
      .returning({ id: persons.id, userId: persons.userId });

    // A team they LEAD, plus a role and a membership they hold on it.
    const [team] = await db
      .insert(ministryTeams)
      .values({
        churchId,
        name: `${SCRATCH_NAME} team`,
        type: "custom",
        leaderId: person.id,
        createdBy: ownerId,
      })
      .returning({ id: ministryTeams.id });

    const [role] = await db
      .insert(teamRoles)
      .values({
        churchId,
        teamId: team.id,
        name: "Scratch role",
        createdBy: ownerId,
      })
      .returning({ id: teamRoles.id });

    const [membership] = await db
      .insert(teamMemberships)
      .values({
        churchId,
        teamId: team.id,
        personId: person.id,
        roleId: role.id,
        createdBy: ownerId,
      })
      .returning({ id: teamMemberships.id, status: teamMemberships.status });

    // A SECOND TEAM ON THE SAME PLANT, LED BY SOMEBODY ELSE. Without it the
    // leadership assertion below is satisfied by a cascade that clears EVERY
    // `leader_id` on the plant: the subquery scoping `persons.user_id` to the
    // target would be dead weight and no test would notice. This row is what
    // makes effect (5) an assertion about the right person rather than about
    // the column being nullable.
    const [bystander] = await db
      .insert(persons)
      .values({
        churchId,
        firstName: SCRATCH_NAME,
        lastName: "Bystander",
        createdBy: ownerId,
      })
      .returning({ id: persons.id });

    const [otherTeam] = await db
      .insert(ministryTeams)
      .values({
        churchId,
        name: `${SCRATCH_NAME} other team`,
        type: "custom",
        leaderId: bystander.id,
        createdBy: ownerId,
      })
      .returning({ id: ministryTeams.id });

    await removeSeat(actor, targetId);

    // ── 1. SESSIONS REVOKED ───────────────────────────────────────────────────
    const survivingSessions = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, targetId));
    assert.deepEqual(
      survivingSessions,
      [],
      "AS-016: the session store must hold nothing for the removed account"
    );
    assert.equal(
      (await db.select().from(sessions).where(eq(sessions.id, ownerSessionId)))
        .length,
      1,
      "and must not touch anybody else's session"
    );

    // ── 2. THE ACCOUNT ROW SURVIVES, TENANCY AND SEAT CLEARED ────────────────
    const account = await rowOf(targetId);
    assert.equal(account.churchId, null, "AS-016: the tenancy FK is cleared");
    assert.equal(account.seat, null, "AS-016: the seat is cleared");
    assert.ok(account.email, "AS-016: the account ROW itself survives");

    // ── 3. THE PERSON RECORD AND ITS MEMBERSHIPS ARE UNTOUCHED ───────────────
    const [personAfter] = await db
      .select({
        id: persons.id,
        userId: persons.userId,
        churchId: persons.churchId,
      })
      .from(persons)
      .where(eq(persons.id, person.id));
    assert.ok(personAfter, "AS-016: the person record survives the account");
    assert.equal(
      personAfter.userId,
      targetId,
      "and still points at the account — losing the login must not unlink the roster entry"
    );
    assert.equal(personAfter.churchId, churchId, "and stays on the plant");

    const [membershipAfter] = await db
      .select({ id: teamMemberships.id, status: teamMemberships.status })
      .from(teamMemberships)
      .where(eq(teamMemberships.id, membership.id));
    assert.deepEqual(
      membershipAfter,
      membership,
      "AS-016: team memberships are left exactly as they were — a person record and an account are separate things"
    );

    // ── 4. OPEN TASKS TO THE OWNER, COMPLETED ONES LEFT ALONE ────────────────
    assert.equal(
      await assigneeOf(openTaskId),
      ownerId,
      "AS-016: an open task goes to the Owner — unassigned, it would vanish from every 'my work' view"
    );
    assert.equal(
      await assigneeOf(doneTaskId),
      targetId,
      "AS-016: a completed task keeps its assignee — it is a record of who did it"
    );

    // ── 5. LEADERSHIP CLEARED, AND THE SLOT READS OPEN ───────────────────────
    const [teamAfter] = await db
      .select({ leaderId: ministryTeams.leaderId })
      .from(ministryTeams)
      .where(eq(ministryTeams.id, team.id));
    assert.equal(
      teamAfter.leaderId,
      null,
      "AS-016: ministry-team leadership is cleared"
    );

    // AND THE STAFFING READ AGREES. The column being NULL is the write; what the
    // FRD promises is that the team READS as having an open leader slot, which is
    // `listTeams`'s answer and not this test's inference.
    const staffing = (await listTeams(churchId)).find((t) => t.id === team.id);
    assert.ok(staffing, "the team is still on the plant");
    assert.equal(
      staffing.leaderName,
      null,
      "AS-016: the team's staffing read must report the leader slot open"
    );

    // AND ONLY THAT TEAM. The removal clears the leadership THIS PERSON held,
    // never the plant's leadership generally.
    const [otherAfter] = await db
      .select({ leaderId: ministryTeams.leaderId })
      .from(ministryTeams)
      .where(eq(ministryTeams.id, otherTeam.id));
    assert.equal(
      otherAfter.leaderId,
      bystander.id,
      "a team led by somebody else keeps its leader — the cascade is scoped to the removed account's own person record"
    );
  }
);

test(
  "removing a two-tenancy row clears every FK, never promoting it into oversight",
  { skip },
  async () => {
    // THE ONE WAY A REMOVAL COULD *WIDEN* REACH, and the reason the marker
    // clears all three FKs rather than only `church_id`.
    //
    // A row naming two tenancies is representable (`memory/invariants.md` →
    // Seats & Tenancy: migration 0050 §1 repaired twelve). Today it reaches
    // NOTHING, because `oversightOrgOf` answers only for exactly one FK. Clear
    // `church_id` alone and the row names exactly one — and
    // `requireOversightUser` admits it on the FK ALONE, without asking the
    // seat. The plant Admin who was just removed would sign back in with that
    // network's whole oversight surface open to them.
    const churchId = await makeChurch();
    const ownerId = await makeUser(churchId, "owner");
    const targetId = await makeUser(churchId, "admin");
    const actor = actorFor(ownerId, churchId);

    // The defect row, written directly — no product flow creates one, which is
    // exactly why the REPAIR path is the thing that has to be tested.
    const [network] = await db
      .insert(sendingNetworks)
      .values({ name: SCRATCH_NAME })
      .returning({ id: sendingNetworks.id });
    await db
      .update(users)
      .set({ sendingNetworkId: network.id })
      .where(eq(users.id, targetId));

    await removeSeat(actor, targetId);

    const [after] = await db
      .select({
        churchId: users.churchId,
        sendingChurchId: users.sendingChurchId,
        sendingNetworkId: users.sendingNetworkId,
        seat: users.seat,
      })
      .from(users)
      .where(eq(users.id, targetId));

    assert.deepEqual(
      after,
      {
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId: null,
        seat: null,
      },
      "AS-016: a removed account names NO tenancy — one FK left standing hands it that org's oversight surface"
    );
  }
);

test(
  "a removal that changes nothing refuses instead of reporting success",
  { skip },
  async () => {
    // `db.batch` is all-or-nothing on FAILURE; a zero-row UPDATE is a SUCCESS.
    // So a marker matching nothing still COMMITS statements 1–3 — three no-ops,
    // each scoped to the same target and plant — and the call must not then
    // answer "removed". An Owner told their removal worked, watching the roster
    // re-render with the person still on it, is the one outcome the rowcount
    // check exists to prevent.
    const churchId = await makeChurch();
    const ownerId = await makeUser(churchId, "owner");
    const targetId = await makeUser(churchId, "member");
    const actor = actorFor(ownerId, churchId);

    await removeSeat(actor, targetId);
    await assert.rejects(
      () => removeSeat(actor, targetId),
      SeatManagementError,
      "a second removal changes nothing, so it must say so rather than succeed"
    );
  }
);

test(
  "the removed account is off the roster and reaches no plant",
  { skip },
  async () => {
    const churchId = await makeChurch();
    const ownerId = await makeUser(churchId, "owner");
    const targetId = await makeUser(churchId, "member");
    const actor = actorFor(ownerId, churchId);

    await removeSeat(actor, targetId);

    const roster = await listSeatRoster(actor);
    assert.deepEqual(
      roster.map((row) => row.userId),
      [ownerId],
      "AS-023: a removed account leaves the roster — only the Owner is left"
    );

    // THE ACCESS SIDE OF THE SAME FACT. `getAccessibleChurchIds` reads the pair
    // (tenancy FK, seat); with both NULL it falls through to the coach-assignment
    // lookup, which is empty, so the next request reaches nothing.
    const account = await db
      .select()
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);
    assert.deepEqual(
      await getAccessibleChurchIds(account[0]),
      [],
      "AS-016: the removed person reaches no plant data on their next request"
    );
  }
);

test(
  "removing twice converges instead of reassigning a second time",
  { skip },
  async () => {
    // IDEMPOTENCE, which is what the marker-last ordering buys. The second call
    // refuses (the pre-read finds a seatless row) and — crucially — does not run
    // the cascade again against an Owner who has since been assigned the task.
    const churchId = await makeChurch();
    const ownerId = await makeUser(churchId, "owner");
    const targetId = await makeUser(churchId, "member");
    const actor = actorFor(ownerId, churchId);
    const taskId = await makeTask(churchId, ownerId, targetId, "not_started");

    await removeSeat(actor, targetId);
    await assert.rejects(
      () => removeSeat(actor, targetId),
      SeatManagementError,
      "a second removal must refuse — there is no seat left to remove"
    );

    assert.equal(
      await assigneeOf(taskId),
      ownerId,
      "and the task stays with the Owner"
    );
    assert.equal(
      (await rowOf(targetId)).seat,
      null,
      "and the account stays clear"
    );
  }
);

// ----------------------------------------------------------------------------
// AS-018 — ending a coach assignment
// ----------------------------------------------------------------------------

test(
  "ending an assignment costs the coach the plant and nothing else",
  { skip },
  async () => {
    const churchId = await makeChurch();
    const ownerId = await makeUser(churchId, "owner");
    const actor = actorFor(ownerId, churchId);

    // A COACH-ONLY ACCOUNT: no tenancy, no seat (AS-008). Its whole reach is the
    // assignment, which is what makes the `getAccessibleChurchIds` assertion below
    // the real acceptance criterion rather than a restatement of the column.
    const coachId = await makeUser(null, null);
    const [assignment] = await db
      .insert(coachAssignments)
      .values({ coachUserId: coachId, churchId })
      .returning({ id: coachAssignments.id });

    const coachRow = async () =>
      (await db.select().from(users).where(eq(users.id, coachId)).limit(1))[0];

    assert.deepEqual(
      await getAccessibleChurchIds(await coachRow()),
      [churchId],
      "before: the assignment is the coach's whole reach"
    );
    assert.equal(
      (await listPlantCoaches(actor)).length,
      1,
      "and the plant lists them"
    );

    await endCoachAssignment(actor, assignment.id);

    const [after] = await db
      .select({ status: coachAssignments.status })
      .from(coachAssignments)
      .where(eq(coachAssignments.id, assignment.id));
    assert.equal(
      after.status,
      "inactive",
      "AS-018: the assignment goes inactive — the row is history, not deleted"
    );

    assert.deepEqual(
      await getAccessibleChurchIds(await coachRow()),
      [],
      "AS-018: the coach loses that plant on their next request"
    );

    // NOTHING ELSE CHANGED — the smaller blast radius is the point of the verb.
    const coach = await coachRow();
    assert.equal(
      coach.seat,
      null,
      "the coach's seat is untouched (they held none)"
    );
    assert.ok(coach.email, "and their account survives");

    assert.deepEqual(
      await listPlantCoaches(actor),
      [],
      "and the ended assignment leaves the plant's coach list"
    );
  }
);

test("ending an assignment on another plant is refused", { skip }, async () => {
  const mine = await makeChurch();
  const theirs = await makeChurch();
  const ownerId = await makeUser(mine, "owner");
  const coachId = await makeUser(null, null);
  const [assignment] = await db
    .insert(coachAssignments)
    .values({ coachUserId: coachId, churchId: theirs })
    .returning({ id: coachAssignments.id });

  await assert.rejects(
    () => endCoachAssignment(actorFor(ownerId, mine), assignment.id),
    SeatManagementError,
    "the assignment is scoped to the actor's own plant"
  );

  const [after] = await db
    .select({ status: coachAssignments.status })
    .from(coachAssignments)
    .where(eq(coachAssignments.id, assignment.id));
  assert.equal(
    after.status,
    "active",
    "the other plant's coach still reaches it"
  );
});

// ----------------------------------------------------------------------------
// The mint
// ----------------------------------------------------------------------------

test("an account with no plant mints no actor", { skip }, async () => {
  // THE TENANCY HALF OF `seat.manage`, which the capability declares as `any`
  // so the org side can share the verb. An oversight Owner passes `requireSeat`
  // and is refused HERE — fail-closed, in one place rather than per verb.
  assert.throws(
    () =>
      seatActorFromSession({
        session: {} as never,
        user: { id: randomUUID(), churchId: null } as never,
      }),
    SeatManagementError,
    "seat management is a plant's own team, and there is no plant here"
  );
});

// ----------------------------------------------------------------------------
// Readers
// ----------------------------------------------------------------------------

async function rowOf(userId: string) {
  const [row] = await db
    .select({
      email: users.email,
      seat: users.seat,
      churchId: users.churchId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  assert.ok(row, `no account row for ${userId} — the account must survive`);
  return row;
}

async function seatOf(userId: string) {
  return (await rowOf(userId)).seat;
}

async function assigneeOf(taskId: string) {
  const [row] = await db
    .select({ assignedToId: tasks.assignedToId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  assert.ok(row, `no task row for ${taskId}`);
  return row.assignedToId;
}
