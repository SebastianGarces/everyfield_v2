import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { eq, like, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, ministryTeams, users } from "@/db/schema";
import { TEAM_TEMPLATES } from "@/lib/ministry-teams/role-templates";
import { initializePredefinedTeams } from "@/lib/ministry-teams/service";

// ----------------------------------------------------------------------------
// OB-015 regression — two simultaneous initializations leave ONE set of teams
// (issue #306, HR4 exit comment 2026-08-09).
//
// WHY THIS IS NOT A UNIT TEST. The bug is a property of Postgres under READ
// COMMITTED, and no SQL-string assertion can see it. `initializeTeamsWithRoles-
// Action` read "does this church have teams yet?" and then called an
// initializer that inserted ten rows unconditionally; the generated SQL was
// valid, every static check passed, and two accepts a few milliseconds apart
// still gave the plant 20 teams and 96 roles. `memory/invariants.md` →
// Transactions states the rule this violated and the remedy applied here:
// SELECT-then-INSERT is not a concurrency guard, so make the duplicate
// unrepresentable with a partial unique index and keep the claim in the same
// statement as the rows it speaks for.
//
// So the assertion has to be made against a real, REACHABLE database, and it is
// therefore OPT-IN: run it with `LIVE_DB_TESTS=1 pnpm test`. The convention,
// the flag and the reachability probe are the ones already used by
// `src/lib/phase-engine/transitions/declaration-race.test.ts` and
// `src/lib/wiki/tenancy-live.test.ts` — `DATABASE_URL` is deliberately NOT the
// signal, because CI sets an unreachable placeholder on every `pnpm test` run
// and keying on its presence makes the hermetic suite take ECONNREFUSED.
//
// The guard it protects is `ministry_teams_predefined_name_unique_idx`
// (migration 0034), which CI proves exists by applying the migration.
//
// Everything it writes is namespaced by `SCRATCH_NAME` and swept in `after`,
// including on failure.
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

/** Namespaces every row this file writes, so the sweep cannot touch real data. */
const SCRATCH_NAME = "__t306 teams init race scratch__";

const RUNS = 3;

/**
 * The actor a scratch team is attributed to.
 *
 * MINTED, NEVER BORROWED. This used to be `select … from users limit 1` — "any
 * real user, because the test is about the write guard, not about who pressed
 * the button". That reads harmlessly and is not: it makes the suite unrunnable
 * against an empty database (the CI job that finally runs these has one), and
 * in a parallel run it borrows ANOTHER suite's scratch user, whose sweep then
 * fails on `ministry_teams_created_by_users_id_fk` — the row it is trying to
 * delete is referenced from a team this file created. A suite that writes only
 * inside its own namespace has to own its actor too.
 */
async function createScratchActor(): Promise<string> {
  const [actor] = await db
    .insert(users)
    .values({
      email: `${crypto.randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: SCRATCH_NAME,
      seat: "owner",
    })
    .returning({ id: users.id });
  return actor.id;
}

async function sweep(): Promise<void> {
  const scratch = await db
    .select({ id: churches.id })
    .from(churches)
    .where(like(churches.name, SCRATCH_NAME));

  for (const church of scratch) {
    await db.delete(ministryTeams).where(eq(ministryTeams.churchId, church.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }

  // Last: the teams above reference it, and the scratch user carries no
  // church of its own, so nothing here depends on the delete order with
  // `churches`.
  await db.delete(users).where(eq(users.name, SCRATCH_NAME));
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

test(
  "two concurrent initializations leave exactly ONE set of teams, every run",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();

    const actorId = await createScratchActor();

    for (let run = 1; run <= RUNS; run++) {
      const [church] = await db
        .insert(churches)
        .values({ name: SCRATCH_NAME, currentPhase: 3 })
        .returning({ id: churches.id });

      // Two tabs, two accepts. Neither knows about the other.
      const results = await Promise.all([
        initializePredefinedTeams(church.id, actorId),
        initializePredefinedTeams(church.id, actorId),
      ]);

      const rows = await db
        .select({ name: ministryTeams.name, type: ministryTeams.type })
        .from(ministryTeams)
        .where(eq(ministryTeams.churchId, church.id));

      assert.equal(
        rows.length,
        TEAM_TEMPLATES.length,
        `run ${run}: the race wrote ${rows.length} teams, not ${TEAM_TEMPLATES.length}`
      );
      assert.equal(
        new Set(rows.map((row) => row.name)).size,
        TEAM_TEMPLATES.length,
        `run ${run}: two teams share a name`
      );

      // Only one caller may claim the rows — the other created nothing, so its
      // role import downstream is a no-op for free.
      const created = results.map((teams) => teams.length);
      assert.deepEqual(
        created.slice().sort((a, b) => a - b),
        [0, TEAM_TEMPLATES.length],
        `run ${run}: the two callers reported creating ${created.join(" and ")} teams`
      );

      await db
        .delete(ministryTeams)
        .where(eq(ministryTeams.churchId, church.id));
      await db.delete(churches).where(eq(churches.id, church.id));
    }
  }
);

test(
  "the guard is the index, not the statement — a raw duplicate insert is refused",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // The statement above can only be as safe as the constraint under it. This
    // asserts the constraint directly, so a future rewrite of the initializer
    // cannot quietly remove the thing that makes duplicates impossible.
    await sweep();

    const actorId = await createScratchActor();

    const [church] = await db
      .insert(churches)
      .values({ name: SCRATCH_NAME, currentPhase: 3 })
      .returning({ id: churches.id });

    try {
      const row = {
        churchId: church.id,
        name: "Worship",
        type: "predefined" as const,
        createdBy: actorId,
      };

      await db.insert(ministryTeams).values(row);

      await assert.rejects(
        () => db.insert(ministryTeams).values(row),
        (error: unknown) => {
          // Drizzle wraps the driver error, so the constraint name is on the
          // `cause`, not on the message it re-throws.
          const text = [
            error instanceof Error ? error.message : String(error),
            error instanceof Error && error.cause instanceof Error
              ? error.cause.message
              : "",
          ].join(" ");
          assert.match(text, /ministry_teams_predefined_name_unique_idx/);
          return true;
        },
        "a second predefined team of the same name must be refused by the database"
      );

      // A planter's OWN teams are NOT constrained — the index is partial, and
      // two custom teams may share a name while the wording is settled.
      await db
        .insert(ministryTeams)
        .values({ ...row, type: "custom" as const });
      await db
        .insert(ministryTeams)
        .values({ ...row, type: "custom" as const });

      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(ministryTeams)
        .where(eq(ministryTeams.churchId, church.id));
      assert.equal(n, 3);
    } finally {
      await db
        .delete(ministryTeams)
        .where(eq(ministryTeams.churchId, church.id));
      await db.delete(churches).where(eq(churches.id, church.id));
    }
  }
);
