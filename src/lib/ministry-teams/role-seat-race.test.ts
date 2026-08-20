import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { and, eq, like, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  ministryTeams,
  persons,
  teamMemberships,
  teamRoles,
  users,
} from "@/db/schema";
import { assignRefusalDelivery } from "@/components/ministry-teams/assign-refusal";
import { ExpectedError } from "@/lib/ministry-teams/expected-error";
import {
  PERSON_ALREADY_ASSIGNED_MESSAGE,
  ROLE_ALREADY_FILLED_MESSAGE,
} from "@/lib/ministry-teams/membership-copy";
import { assignMember, removeMember } from "@/lib/ministry-teams/memberships";

// ----------------------------------------------------------------------------
// #409 D1 — ONE PERSON PER TEAM ROLE, guarded by
// `team_memberships_role_active_unique_idx` (partial, on `role_id` where
// `status = 'active'`, migration 0038).
//
// WHY THIS IS NOT A UNIT TEST. `assignMember` asked only whether THIS person
// already held the role, so two planters filling one open seat with two
// DIFFERENT people both passed the read and both wrote. The generated SQL was
// valid and every static check passed; what came out was a person who was
// assigned, counted by `getTeamCountsForPeople`, absent from the roles tab
// (`getTeam` renders one occupant per role and `find` returns whichever row
// Postgres hands back first) and unremovable, because the only Remove button
// belongs to the row the read picked. `memory/invariants.md` → Transactions
// names the shape: SELECT-then-INSERT is not a concurrency guard.
//
// OPT-IN, against a real database: `LIVE_DB_TESTS=1 pnpm test`. Same
// convention, flag and reachability probe as `teams-init-race.test.ts` beside
// it. The hermetic half — that the index still has its matching `ON CONFLICT`
// clause and that the refusal reaches the assign dialog — is
// `src/db/schema/ruled-guards.test.ts`, which runs on every `pnpm test`.
//
// Everything written here is namespaced by `SCRATCH_NAME` and swept in `after`.
// ----------------------------------------------------------------------------

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test` with a reachable DATABASE_URL — a real Postgres is the only place this bug is visible";

const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but DATABASE_URL points at no reachable Postgres, so the race did NOT run";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const SCRATCH_NAME = "__t409 role seat race scratch__";

const RUNS = 3;

async function sweep(): Promise<void> {
  const scratch = await db
    .select({ id: churches.id })
    .from(churches)
    .where(like(churches.name, SCRATCH_NAME));

  for (const church of scratch) {
    await db
      .delete(teamMemberships)
      .where(eq(teamMemberships.churchId, church.id));
    await db.delete(teamRoles).where(eq(teamRoles.churchId, church.id));
    await db.delete(ministryTeams).where(eq(ministryTeams.churchId, church.id));
    await db.delete(persons).where(eq(persons.churchId, church.id));
    await db.delete(users).where(eq(users.churchId, church.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

interface Seat {
  churchId: string;
  userId: string;
  teamId: string;
  roleId: string;
  personIds: [string, string];
}

/** A scratch plant with ONE team, ONE open role and TWO candidates for it. */
async function createScratchSeat(): Promise<Seat> {
  const [church] = await db
    .insert(churches)
    .values({ name: SCRATCH_NAME, currentPhase: 3 })
    .returning({ id: churches.id });

  const [user] = await db
    .insert(users)
    .values({
      email: `${crypto.randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: SCRATCH_NAME,
      seat: "owner",
      churchId: church.id,
    })
    .returning({ id: users.id });

  const [team] = await db
    .insert(ministryTeams)
    .values({
      churchId: church.id,
      name: SCRATCH_NAME,
      type: "custom",
      createdBy: user.id,
    })
    .returning({ id: ministryTeams.id });

  const [role] = await db
    .insert(teamRoles)
    .values({
      churchId: church.id,
      teamId: team.id,
      name: "Seat",
      createdBy: user.id,
    })
    .returning({ id: teamRoles.id });

  const people = await db
    .insert(persons)
    .values([
      {
        churchId: church.id,
        firstName: "First",
        lastName: "Candidate",
        createdBy: user.id,
      },
      {
        churchId: church.id,
        firstName: "Second",
        lastName: "Candidate",
        createdBy: user.id,
      },
    ])
    .returning({ id: persons.id });

  return {
    churchId: church.id,
    userId: user.id,
    teamId: team.id,
    roleId: role.id,
    personIds: [people[0].id, people[1].id],
  };
}

async function activeOnSeat(roleId: string): Promise<string[]> {
  const rows = await db
    .select({ personId: teamMemberships.personId })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.roleId, roleId),
        eq(teamMemberships.status, "active")
      )
    );
  return rows.map((row) => row.personId);
}

test(
  "two planters filling one seat with two people leave exactly ONE holder, every run",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();

    for (let run = 1; run <= RUNS; run++) {
      const seat = await createScratchSeat();

      const results = await Promise.allSettled([
        assignMember(
          seat.churchId,
          seat.teamId,
          seat.roleId,
          seat.personIds[0],
          seat.userId
        ),
        assignMember(
          seat.churchId,
          seat.teamId,
          seat.roleId,
          seat.personIds[1],
          seat.userId
        ),
      ]);

      const holders = await activeOnSeat(seat.roleId);
      assert.equal(
        holders.length,
        1,
        `run ${run}: the race left ${holders.length} people on one seat`
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(
        fulfilled.length,
        1,
        `run ${run}: ${fulfilled.length} callers were told they had succeeded`
      );
      assert.equal(rejected.length, 1);

      // The loser is told something a planter can act on, not a driver error.
      // `ExpectedError` is what the action shell surfaces verbatim (409-6C);
      // any other throw becomes the generic fallback sentence.
      const refusal = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(
        refusal instanceof ExpectedError,
        `run ${run}: the loser got ${String(refusal)}, which the action shell would replace with its generic sentence`
      );
      assert.equal(refusal.message, ROLE_ALREADY_FILLED_MESSAGE);

      await sweep();
    }
  }
);

test(
  "the SAME person submitted twice leaves one row and reads the PERSON sentence",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // #411 round 1. Two tabs, or one double-clicked Confirm, assigning the SAME
    // person to one free seat.
    //
    // THIS IS THE CASE THAT PROVES THE HOLDER READ, and it runs RUNS times
    // because a race's outcome is timing-dependent and one green run of a
    // concurrency assertion is close to no evidence. `existing.status ===
    // 'active'` cannot answer it: both submits take their snapshot before either
    // writes, so both pass it and the database is what refuses the second.
    //
    // The refusal reaches this caller as an empty `returning()` — `ON CONFLICT
    // (role_id) WHERE status = 'active' DO NOTHING` arbitrates on the ONLY
    // unique index on the table, so every conflict the INSERT can meet is the
    // arbiter's. It was not always: while the subsumed
    // (team_id, person_id, role_id) index still existed, a raced insert that
    // passed the arbiter's pre-check met that one first (lower OID, not covered
    // by the DO NOTHING) and raised 23505 instead, about two runs in three.
    // Migration 0039 dropped it, which is why one shape now describes this path.
    //
    // The truthful sentence is the OTHER one: this planter filled the seat,
    // with the person they picked, so ROLE_ALREADY_FILLED_MESSAGE and its
    // "Someone filled it while this page was open" description would both be
    // false statements.
    await sweep();

    for (let run = 1; run <= RUNS; run++) {
      const seat = await createScratchSeat();
      const person = seat.personIds[0];

      const results = await Promise.allSettled([
        assignMember(
          seat.churchId,
          seat.teamId,
          seat.roleId,
          person,
          seat.userId
        ),
        assignMember(
          seat.churchId,
          seat.teamId,
          seat.roleId,
          person,
          seat.userId
        ),
      ]);

      assert.deepEqual(
        await activeOnSeat(seat.roleId),
        [person],
        `run ${run}: the double submit left more than one active row`
      );

      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(
        results.filter((r) => r.status === "fulfilled").length,
        1,
        `run ${run}: exactly one of the two submits assigned the person`
      );
      assert.equal(rejected.length, 1);

      const refusal = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(
        refusal instanceof ExpectedError,
        `run ${run}: the loser got ${String(refusal)}, which the action shell would replace with its generic sentence`
      );
      assert.equal(
        refusal.message,
        PERSON_ALREADY_ASSIGNED_MESSAGE,
        `run ${run}: the double-submit loser must be told the person already holds this seat`
      );
      assert.notEqual(
        refusal.message,
        ROLE_ALREADY_FILLED_MESSAGE,
        `run ${run}: the seat sentence belongs to the race this planter did not lose`
      );

      // ...and therefore the false description never reaches them: only the
      // seat sentence carries ROLE_ALREADY_FILLED_DESCRIPTION, and only the seat
      // sentence is toasted (`assign-refusal.ts`).
      const delivery = assignRefusalDelivery(refusal.message);
      assert.equal(
        delivery.toast,
        null,
        `run ${run}: "Someone filled it while this page was open" is false here — nobody but this planter did`
      );
      assert.equal(delivery.inline, PERSON_ALREADY_ASSIGNED_MESSAGE);

      await sweep();
    }
  }
);

test(
  "the seat guard is the index, and REMOVING the holder frees it",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();
    const seat = await createScratchSeat();

    const row = {
      churchId: seat.churchId,
      teamId: seat.teamId,
      roleId: seat.roleId,
      createdBy: seat.userId,
    };

    await db
      .insert(teamMemberships)
      .values({ ...row, personId: seat.personIds[0] });

    await assert.rejects(
      () =>
        db
          .insert(teamMemberships)
          .values({ ...row, personId: seat.personIds[1] }),
      (error: unknown) => {
        const text = [
          error instanceof Error ? error.message : String(error),
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : "",
        ].join(" ");
        assert.match(text, /team_memberships_role_active_unique_idx/);
        return true;
      },
      "a second active membership on one role must be refused by the database"
    );

    // Partial on `status = 'active'`: the seat is single only while occupied,
    // so a role stays re-fillable for the whole life of the team.
    const [held] = await db
      .select({ id: teamMemberships.id })
      .from(teamMemberships)
      .where(eq(teamMemberships.roleId, seat.roleId));
    await removeMember(seat.churchId, held.id, seat.userId);

    await assignMember(
      seat.churchId,
      seat.teamId,
      seat.roleId,
      seat.personIds[1],
      seat.userId
    );

    assert.deepEqual(await activeOnSeat(seat.roleId), [seat.personIds[1]]);

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(teamMemberships)
      .where(eq(teamMemberships.roleId, seat.roleId));
    assert.equal(n, 2, "the previous holder's history was deleted, not kept");
  }
);

test(
  "the SAME person re-assigned twice to a seat they used to hold leaves ONE row",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // #411 quality round 1, second pass — THE REACTIVATION BRANCH OF THE
    // DOUBLE-SUBMIT, which is the one input none of the four cases above reach.
    // Case 2 races the same person onto a FREE seat, so both callers INSERT and
    // the arbiter refuses one; case 4 races a DIFFERENT person onto a HELD seat,
    // so the reactivation UPDATE meets the index. Here the row already exists,
    // inactive, and BOTH callers reactivate THAT SAME ROW.
    //
    // The index cannot see this at all: there is only ever one row, so two
    // UPDATEs of it collide with nothing. Measured before the fix, this printed
    // `fulfilled=2 rejected=0 activeRows=1` — two callers told they had
    // succeeded, and every assignment event emitted twice for one seat, which F2
    // subscribes to in order to advance person status. What refuses the loser is
    // the UPDATE's own `status = 'inactive'` predicate, re-evaluated against the
    // winner's committed row version under the row lock: an empty `returning()`,
    // read exactly as the INSERT path reads its own.
    //
    // The truthful sentence is the PERSON one — this planter put this person
    // back on the seat, so "Someone filled it while this page was open" would be
    // false, the same reasoning as case 2.
    await sweep();

    for (let run = 1; run <= RUNS; run++) {
      const seat = await createScratchSeat();
      const person = seat.personIds[0];

      // Serve, then leave — which is what leaves an `inactive` row behind.
      await assignMember(
        seat.churchId,
        seat.teamId,
        seat.roleId,
        person,
        seat.userId
      );
      const [held] = await db
        .select({ id: teamMemberships.id })
        .from(teamMemberships)
        .where(eq(teamMemberships.roleId, seat.roleId));
      await removeMember(seat.churchId, held.id, seat.userId);

      const results = await Promise.allSettled([
        assignMember(
          seat.churchId,
          seat.teamId,
          seat.roleId,
          person,
          seat.userId
        ),
        assignMember(
          seat.churchId,
          seat.teamId,
          seat.roleId,
          person,
          seat.userId
        ),
      ]);

      assert.deepEqual(
        await activeOnSeat(seat.roleId),
        [person],
        `run ${run}: the reactivation double submit left more than one active row`
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(
        fulfilled.length,
        1,
        `run ${run}: ${fulfilled.length} callers were told they had succeeded, so the assignment events fired ${fulfilled.length} times for one seat`
      );
      assert.equal(rejected.length, 1);

      const refusal = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(
        refusal instanceof ExpectedError,
        `run ${run}: the loser got ${String(refusal)}, which the action shell would replace with its generic sentence`
      );
      assert.equal(
        refusal.message,
        PERSON_ALREADY_ASSIGNED_MESSAGE,
        `run ${run}: the reactivation double-submit loser must be told the person already holds this seat`
      );

      // ...and only ONE row was ever written for this person and seat: the
      // reactivation reused the row `removeMember` left, it did not insert a
      // second one.
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(teamMemberships)
        .where(eq(teamMemberships.roleId, seat.roleId));
      assert.equal(
        n,
        1,
        `run ${run}: the loser wrote a row of its own instead of being refused`
      );

      await sweep();
    }
  }
);

test(
  "REACTIVATING a past holder is refused too, and leaves the role alone",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // The reactivation path is an UPDATE and takes no `ON CONFLICT`, so it
    // meets the index as a violation. The whole `db.batch` aborts, which is
    // what keeps `markRoleFilled` from landing on its own — and the driver
    // error is recognised by `isSeatConflict`, after which the same holder read
    // the insert path uses picks the sentence.
    await sweep();
    const seat = await createScratchSeat();

    // Person A serves, then leaves — leaving an `inactive` row to reactivate.
    await assignMember(
      seat.churchId,
      seat.teamId,
      seat.roleId,
      seat.personIds[0],
      seat.userId
    );
    const [first] = await db
      .select({ id: teamMemberships.id })
      .from(teamMemberships)
      .where(eq(teamMemberships.roleId, seat.roleId));
    await removeMember(seat.churchId, first.id, seat.userId);

    // Person B takes the seat.
    await assignMember(
      seat.churchId,
      seat.teamId,
      seat.roleId,
      seat.personIds[1],
      seat.userId
    );

    // Person A is invited back to a seat that is no longer free.
    await assert.rejects(
      () =>
        assignMember(
          seat.churchId,
          seat.teamId,
          seat.roleId,
          seat.personIds[0],
          seat.userId
        ),
      (error: unknown) => {
        assert.ok(error instanceof ExpectedError);
        assert.equal(error.message, ROLE_ALREADY_FILLED_MESSAGE);
        return true;
      }
    );

    assert.deepEqual(await activeOnSeat(seat.roleId), [seat.personIds[1]]);
  }
);
