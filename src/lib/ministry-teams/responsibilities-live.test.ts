import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { ministryTeams, teamResponsibilities } from "@/db/schema";
import {
  createScratchPlant,
  databaseReachable,
  LIVE_DB,
  liveSkip as skip,
  sweepScratch,
  UNREACHABLE,
  type ScratchPlant,
} from "@/lib/testing/ministry-teams-scratch";

import {
  createResponsibility,
  deleteResponsibility,
  listResponsibilities,
  updateResponsibility,
} from "./responsibilities";
import { playbookResponsibilities } from "./role-templates";
import { initializePredefinedTeams } from "./teams";

// ----------------------------------------------------------------------------
// MT-002b (#311 WS1) — the checklist is ROWS, and the playbook is offered once.
//
// WHY THIS IS NOT A UNIT TEST. Every claim here is about which rows exist
// afterwards, and two of them are about what Postgres does under READ COMMITTED
// when two readers arrive together. `seedPlaybookResponsibilities` is a
// compare-and-set on `ministry_teams.responsibilities_seeded_at` followed by an
// insert gated on its rowcount — the generated SQL for the broken version and
// the correct one differ by one `WHERE`, so no SQL-string assertion can tell
// them apart. `memory/invariants.md` → Transactions is the rule this is built
// to; the same opt-in flag, probe and namespaced sweep as its neighbours.
// ----------------------------------------------------------------------------

const SCRATCH_NAME = "__t311 responsibilities scratch__";

/** Any predefined team will do; this one's description splits into five items. */
const TEAM_KEY = "senior_pastor" as const;

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweepScratch(SCRATCH_NAME);
});

async function scratchTeam(plant: ScratchPlant, teamKey = TEAM_KEY) {
  const [team] = await initializePredefinedTeams(
    plant.churchId,
    plant.actorId,
    [teamKey]
  );
  return team;
}

async function customTeam(plant: ScratchPlant) {
  const [team] = await db
    .insert(ministryTeams)
    .values({
      churchId: plant.churchId,
      name: `${SCRATCH_NAME} custom`,
      type: "custom",
      createdBy: plant.actorId,
    })
    .returning();
  return team;
}

async function rowsFor(teamId: string) {
  return db
    .select()
    .from(teamResponsibilities)
    .where(eq(teamResponsibilities.teamId, teamId));
}

test(
  "a predefined team's first view seeds its playbook, and a reload never re-seeds",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const team = await scratchTeam(plant);
    const expected = playbookResponsibilities(TEAM_KEY);
    assert.ok(expected.length > 1, "the fixture template has a real playbook");

    const first = await listResponsibilities(
      plant.churchId,
      team.id,
      plant.actorId
    );
    assert.deepEqual(
      first.map((row) => row.title),
      expected,
      "the first read returns the playbook, in template order"
    );

    // A reload is the same claim matching nothing.
    const second = await listResponsibilities(
      plant.churchId,
      team.id,
      plant.actorId
    );
    assert.equal(second.length, expected.length, "a reload wrote no new rows");
    assert.deepEqual(
      second.map((row) => row.id).sort(),
      first.map((row) => row.id).sort(),
      "and it is the SAME rows, not a fresh set with the same words"
    );
  }
);

test(
  "two concurrent first views produce ONE set of rows",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const expected = playbookResponsibilities(TEAM_KEY);

    // Three runs, because a race that loses one time in three still ships.
    for (let run = 1; run <= 3; run++) {
      const team = await scratchTeam(plant);

      // Two tabs, opened together. Neither knows about the other.
      await Promise.all([
        listResponsibilities(plant.churchId, team.id, plant.actorId),
        listResponsibilities(plant.churchId, team.id, plant.actorId),
      ]);

      const rows = await rowsFor(team.id);
      assert.equal(
        rows.length,
        expected.length,
        `run ${run}: the race wrote ${rows.length} rows, not ${expected.length}`
      );

      await db
        .delete(teamResponsibilities)
        .where(eq(teamResponsibilities.teamId, team.id));
      await db.delete(ministryTeams).where(eq(ministryTeams.id, team.id));
    }
  }
);

test(
  "a deleted playbook item does NOT come back on the next view",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    // THE REASON THE CLAIM IS ON THE TEAM AND NOT A KEY ON THE ROWS. A
    // per-item arbiter only knows about rows that still exist, so the first
    // item a planter deletes would be re-inserted by the next page load.
    const plant = await createScratchPlant(SCRATCH_NAME);
    const team = await scratchTeam(plant);

    const seeded = await listResponsibilities(
      plant.churchId,
      team.id,
      plant.actorId
    );
    await deleteResponsibility(plant.churchId, seeded[0].id);

    const reloaded = await listResponsibilities(
      plant.churchId,
      team.id,
      plant.actorId
    );
    assert.equal(reloaded.length, seeded.length - 1);
    assert.ok(
      !reloaded.some((row) => row.title === seeded[0].title),
      `"${seeded[0].title}" came back after being deleted`
    );
  }
);

test(
  "a custom team is never seeded, and its stamp stays NULL",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const team = await customTeam(plant);

    const rows = await listResponsibilities(
      plant.churchId,
      team.id,
      plant.actorId
    );
    assert.deepEqual(rows, [], "a custom team starts empty");

    const [stamped] = await db
      .select({ seededAt: ministryTeams.responsibilitiesSeededAt })
      .from(ministryTeams)
      .where(eq(ministryTeams.id, team.id));
    assert.equal(
      stamped.seededAt,
      null,
      "a team the playbook does not speak about is never claimed"
    );

    // And the empty state is not a dead end: the planter adds their own.
    const added = await createResponsibility(
      plant.churchId,
      team.id,
      plant.actorId,
      { title: "Run the coffee cart" }
    );
    const afterAdd = await listResponsibilities(
      plant.churchId,
      team.id,
      plant.actorId
    );
    assert.deepEqual(
      afterAdd.map((row) => row.title),
      ["Run the coffee cart"]
    );
    assert.equal(afterAdd[0].id, added.id);
  }
);

test(
  "completion is `completed_at`, and it round-trips both ways",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const team = await scratchTeam(plant);
    const [item] = await listResponsibilities(
      plant.churchId,
      team.id,
      plant.actorId
    );
    assert.equal(item.completedAt, null, "a seeded item starts open");

    const ticked = await updateResponsibility(plant.churchId, item.id, {
      completed: true,
    });
    assert.notEqual(ticked.completedAt, null, "ticking stamps a time");

    // Re-read, because the claim is about what SURVIVES the round trip — the
    // AC's "it survives reload".
    const [reread] = await rowsFor(team.id).then((rows) =>
      rows.filter((row) => row.id === item.id)
    );
    assert.notEqual(reread.completedAt, null);

    const reopened = await updateResponsibility(plant.churchId, item.id, {
      completed: false,
    });
    assert.equal(reopened.completedAt, null, "unticking clears it");
  }
);

test(
  "every read and write is church-scoped — a foreign id changes nothing",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    // TENANCY IS IN THE `WHERE`, NOT IN A READ ABOVE IT. Two plants, and the
    // second one's church id is handed to every entry point against the
    // first's rows. There is no RLS behind any of this
    // (`memory/invariants.md` → Multi-Tenancy).
    const ours = await createScratchPlant(SCRATCH_NAME);
    const theirs = await createScratchPlant(SCRATCH_NAME);

    const team = await scratchTeam(ours);
    const seeded = await listResponsibilities(
      ours.churchId,
      team.id,
      ours.actorId
    );
    assert.ok(seeded.length > 0);

    assert.deepEqual(
      await listResponsibilities(theirs.churchId, team.id, theirs.actorId),
      [],
      "the other church reads none of our rows"
    );

    await assert.rejects(
      () =>
        updateResponsibility(theirs.churchId, seeded[0].id, {
          title: "hijacked",
        }),
      /not found/i,
      "and cannot edit one"
    );
    await assert.rejects(
      () => deleteResponsibility(theirs.churchId, seeded[0].id),
      /not found/i,
      "…or delete one"
    );

    const rows = await rowsFor(team.id);
    assert.equal(rows.length, seeded.length, "nothing was removed");
    assert.ok(
      !rows.some((row) => row.title === "hijacked"),
      "and nothing was rewritten"
    );

    // The foreign read must not have claimed the seed either — a claim it won
    // would leave this team stamped with rows it cannot see.
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(teamResponsibilities)
      .where(
        and(
          eq(teamResponsibilities.teamId, team.id),
          eq(teamResponsibilities.churchId, ours.churchId)
        )
      );
    assert.equal(n, seeded.length);
  }
);

test(
  "adding puts the new item last, after every seeded one",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const team = await scratchTeam(plant);
    await listResponsibilities(plant.churchId, team.id, plant.actorId);

    await createResponsibility(plant.churchId, team.id, plant.actorId, {
      title: "First addition",
    });
    await createResponsibility(plant.churchId, team.id, plant.actorId, {
      title: "Second addition",
    });

    const titles = (
      await listResponsibilities(plant.churchId, team.id, plant.actorId)
    ).map((row) => row.title);

    assert.deepEqual(
      titles.slice(-2),
      ["First addition", "Second addition"],
      "additions sort after the playbook, and among themselves by creation"
    );
  }
);

test(
  "a team of another church cannot have a responsibility added to it",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    // `createResponsibility` takes a teamId straight from the client, so the
    // ownership proof is `verifyTeamOwnership` and not the row's own scoping —
    // without it the insert would happily stamp OUR church id onto a row
    // pointing at THEIR team.
    const ours = await createScratchPlant(SCRATCH_NAME);
    const theirs = await createScratchPlant(SCRATCH_NAME);
    const theirTeam = await scratchTeam(theirs);

    await assert.rejects(
      () =>
        createResponsibility(ours.churchId, theirTeam.id, ours.actorId, {
          title: "planted",
        }),
      /not found/i
    );

    const rows = await rowsFor(theirTeam.id);
    assert.ok(!rows.some((row) => row.title === "planted"));
  }
);
