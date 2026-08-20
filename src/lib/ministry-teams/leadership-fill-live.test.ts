import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
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
import type { ChurchLeadershipStatus } from "@/lib/onboarding/leadership";
import { accountPersonValues } from "@/lib/people/account-person";

import { importRoleTemplates } from "./roles";
import { initializePredefinedTeams } from "./teams";

// ----------------------------------------------------------------------------
// #378 WS2 — THE PLANT'S OWN ANSWER, APPLIED WHEN THE TEMPLATES LAND.
//
// Onboarding asks "will you be the lead pastor?" and stores the answer on
// `churches.leadership_status`. Nothing read it at template time, so a planter
// who said yes had to open /teams and answer the same question a second time by
// assigning themselves.
//
// WHY THIS IS NOT A UNIT TEST. What is asserted is which ROWS exist afterwards:
// a `team_memberships` row against the seat index, a `team_roles` row flipped to
// `filled` in the same batch, and — for the refusal cases — the ABSENCE of
// both. `assignMember` reaches the database in every branch, including its two
// refusal shapes, so there is nothing to stub that would still be the thing
// under test.
//
// Opt-in on the same flag, probe and namespaced sweep as
// `teams-init-race.test.ts`. The one HERMETIC assertion at the end is the
// "through the service path" one, which is a claim about the SOURCE.
// ----------------------------------------------------------------------------

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — the assertion is about rows, and `assignMember` reaches the database in every branch";

const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but DATABASE_URL points at no reachable Postgres, so the auto-fill did NOT run";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const SCRATCH_NAME = "__t378 leadership fill scratch__";
const LEADERSHIP_TEAM = "Leadership";
const SENIOR_PASTOR_ROLE = "Senior Pastor";

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
    await db
      .update(users)
      .set({ churchId: null })
      .where(eq(users.churchId, church.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }

  await db.delete(users).where(eq(users.name, SCRATCH_NAME));
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

/**
 * A plant with an Owner, that Owner's linked person, and the Leadership team's
 * roles imported — i.e. everything up to the moment the answer is applied.
 *
 * The person row comes from `accountPersonValues`, the same function the
 * church-gain batch uses, so this fixture cannot drift from what the product
 * actually writes.
 */
async function plantWith(leadershipStatus: ChurchLeadershipStatus | null) {
  const [church] = await db
    .insert(churches)
    .values({ name: SCRATCH_NAME, leadershipStatus })
    .returning({ id: churches.id });

  const [owner] = await db
    .insert(users)
    .values({
      email: `${crypto.randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: SCRATCH_NAME,
      seat: "owner",
      churchId: church.id,
    })
    .returning({ id: users.id, email: users.email, name: users.name });

  const [person] = await db
    .insert(persons)
    .values(
      accountPersonValues({
        userId: owner.id,
        churchId: church.id,
        name: owner.name,
        email: owner.email,
      })
    )
    .returning({ id: persons.id });

  const [team] = await initializePredefinedTeams(church.id, owner.id, [
    "senior_pastor",
  ]);

  return { churchId: church.id, ownerId: owner.id, personId: person.id, team };
}

async function seniorPastorRole(teamId: string) {
  const [role] = await db
    .select({ id: teamRoles.id, status: teamRoles.status })
    .from(teamRoles)
    .where(
      and(eq(teamRoles.teamId, teamId), eq(teamRoles.name, SENIOR_PASTOR_ROLE))
    );
  return role;
}

async function activeMemberships(teamId: string) {
  return db
    .select({
      personId: teamMemberships.personId,
      roleId: teamMemberships.roleId,
    })
    .from(teamMemberships)
    .where(eq(teamMemberships.teamId, teamId));
}

test(
  "a planter_confirmed plant lands its Owner in the Senior Pastor role",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    const plant = await plantWith("planter_confirmed");
    assert.equal(plant.team.name, LEADERSHIP_TEAM, "WS3's rename shipped");
    assert.equal(plant.team.templateKey, "senior_pastor");

    await importRoleTemplates(
      plant.churchId,
      plant.team.id,
      plant.ownerId,
      "senior_pastor"
    );

    const memberships = await activeMemberships(plant.team.id);
    assert.equal(memberships.length, 1, "exactly one seat was filled");
    assert.equal(
      memberships[0].personId,
      plant.personId,
      "and it is the planter"
    );

    const [seat] = await db
      .select({ name: teamRoles.name, status: teamRoles.status })
      .from(teamRoles)
      .where(eq(teamRoles.id, memberships[0].roleId));
    assert.equal(seat.name, SENIOR_PASTOR_ROLE, "the ROLE name is unchanged");
    assert.equal(seat.status, "filled");

    // The Associate Pastor role is imported and stays OPEN — the answer is
    // about one seat, not about the team.
    const open = await db
      .select({ name: teamRoles.name })
      .from(teamRoles)
      .where(eq(teamRoles.status, "open"));
    assert.ok(
      open.some((role) => role.name === "Associate Pastor"),
      "the rest of the team is still a question"
    );

    // NO SEAT CHANGED. The link grants nothing (`memory/invariants.md` → Seats
    // & Tenancy) and this path in particular must not become a way to acquire
    // one.
    const [owner] = await db
      .select({ seat: users.seat, churchId: users.churchId })
      .from(users)
      .where(eq(users.id, plant.ownerId));
    assert.equal(owner.seat, "owner");
    assert.equal(owner.churchId, plant.churchId);
  }
);

for (const answer of [null, "no_planter"] as const) {
  test(
    `a ${answer ?? "unanswered"} plant imports the same templates with the role OPEN`,
    { skip },
    async (t: TestContext) => {
      if (!(await databaseReachable())) return t.skip(UNREACHABLE);
      await sweep();

      const plant = await plantWith(answer);
      await importRoleTemplates(
        plant.churchId,
        plant.team.id,
        plant.ownerId,
        "senior_pastor"
      );

      assert.deepEqual(
        await activeMemberships(plant.team.id),
        [],
        "nobody was seated"
      );

      const role = await seniorPastorRole(plant.team.id);
      assert.equal(
        role.status,
        "open",
        "the role is still a question to answer"
      );
    }
  );
}

test(
  "re-importing does not seat the planter twice",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // `importRoleTemplates` carries no ON CONFLICT, so a second import mints a
    // SECOND set of role rows — and without the already-on-this-team check the
    // planter would be seated on both, reading as two Senior Pastors on one
    // team.
    const plant = await plantWith("planter_confirmed");
    for (let run = 0; run < 2; run++) {
      await importRoleTemplates(
        plant.churchId,
        plant.team.id,
        plant.ownerId,
        "senior_pastor"
      );
    }

    const memberships = await activeMemberships(plant.team.id);
    assert.equal(
      memberships.length,
      1,
      `the re-import seated the planter ${memberships.length} times`
    );
  }
);

test(
  "a role somebody else already holds is never taken from them",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    const plant = await plantWith("planter_confirmed");
    await importRoleTemplates(
      plant.churchId,
      plant.team.id,
      plant.ownerId,
      "senior_pastor"
    );

    const before = await activeMemberships(plant.team.id);
    assert.equal(before.length, 1);

    // Import again after the seat is taken: `assignMember`'s refusal is
    // swallowed and nothing moves.
    await importRoleTemplates(
      plant.churchId,
      plant.team.id,
      plant.ownerId,
      "senior_pastor"
    );

    assert.deepEqual(await activeMemberships(plant.team.id), before);
  }
);

test("the auto-fill goes through the assignment service, never a raw insert", () => {
  // HERMETIC, and it is a claim about the SOURCE rather than about rows:
  // `assignMember` owns the seat index, both refusal shapes, the role's status
  // flip in the same batch, and the two domain events. An INSERT here would be
  // a second assignment path that skips all of it, and every row assertion
  // above would still pass.
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/ministry-teams/leadership-fill.ts"),
    "utf8"
  );

  assert.match(source, /await assignMember\(/);
  assert.doesNotMatch(source, /db\s*\.\s*insert\(/);
  assert.doesNotMatch(source, /db\s*\.\s*update\(/);

  // …and it reads the seat WITH its tenancy, never `seat = 'owner'` alone,
  // which says nothing about whose owner.
  assert.match(source, /eq\(users\.churchId, churchId\)/);
  assert.match(source, /eq\(users\.seat, "owner"\)/);

  // It never WRITES anything at all of its own — no `.set(`, so no path through
  // this file can grant a seat, change a tenancy or flip a role behind
  // `assignMember`'s back. The link grants nothing.
  assert.doesNotMatch(source, /\.set\(/);
});
