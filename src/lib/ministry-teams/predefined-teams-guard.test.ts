import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import { ministryTeams } from "@/db/schema";
import { TEAM_TEMPLATES } from "@/lib/ministry-teams/role-templates";
import { initializePredefinedTeams } from "@/lib/ministry-teams/service";

// ============================================================================
// OB-015 / #306 — one predefined ministry team of each name per plant.
//
// The bug this pins is a race, and a race is only visible against a real
// Postgres — `teams-init-race.test.ts` next door does that, opt-in. What CAN be
// asserted hermetically is everything the race fix is MADE of, and each of the
// three pieces fails differently when it drifts:
//
//   * THE INDEX must exist in the schema, be partial, and cover
//     (church_id, name). Without it the `ON CONFLICT` clause below raises
//     "there is no unique or exclusion constraint matching the ON CONFLICT
//     specification" on every initialization — a total outage of the feature,
//     not a subtle regression.
//
//   * THE MIGRATION must create that same index, with the same predicate.
//     Drizzle's snapshot keeps the two aligned when someone runs db:generate;
//     nothing keeps them aligned when someone hand-edits either side.
//
//   * THE STATEMENT must be ONE insert carrying the same predicate. Ten
//     unconditional inserts behind a read is the shape the invariant names
//     (`memory/invariants.md` → Transactions: SELECT-then-INSERT is not a
//     concurrency guard), and it is exactly what this function used to be.
// ============================================================================

const INDEX_NAME = "ministry_teams_predefined_name_unique_idx";

const SERVICE = readFileSync(
  path.join(process.cwd(), "src", "lib", "ministry-teams", "service.ts"),
  "utf8"
);

const MIGRATION = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "db",
    "migrations",
    "0034_ministry_team_predefined_unique.sql"
  ),
  "utf8"
);

/** The body of `initializePredefinedTeams`, comments and all. */
const INITIALIZER = SERVICE.slice(
  SERVICE.indexOf("export async function initializePredefinedTeams"),
  SERVICE.indexOf("// Role Functions")
);

// ----------------------------------------------------------------------------
// 1. The index
// ----------------------------------------------------------------------------

test("the schema declares a PARTIAL unique index on (church_id, name)", () => {
  const { indexes } = getTableConfig(ministryTeams);
  const guard = indexes.find((index) => index.config.name === INDEX_NAME);

  assert.ok(guard, `${INDEX_NAME} is missing from the ministry_teams schema`);
  assert.equal(guard.config.unique, true, "the guard must be UNIQUE");

  assert.deepEqual(
    guard.config.columns.map((column) =>
      "name" in column ? column.name : String(column)
    ),
    ["church_id", "name"],
    "the guard is about a NAME within a CHURCH, in that order"
  );

  // Partial, and partial on `type`. A total unique index would refuse a planter
  // two custom teams that happen to share a name — a database error in the
  // middle of a form, over something that is not an invariant at all.
  assert.ok(guard.config.where, "the guard must be partial");
  const predicate = new PgDialect().sqlToQuery(guard.config.where).sql;
  assert.match(
    predicate,
    /"ministry_teams"\."type" = 'predefined'/,
    "the predicate must be about predefined teams, with the literal inlined"
  );
});

test("the versioned migration builds that index, and demotes duplicates FIRST", () => {
  assert.match(
    MIGRATION,
    new RegExp(`CREATE UNIQUE INDEX "${INDEX_NAME}"`),
    "the migration must create the index the schema declares"
  );
  assert.match(
    MIGRATION,
    /ON "ministry_teams" USING btree \("church_id","name"\)/
  );
  assert.match(MIGRATION, /WHERE "ministry_teams"\."type" = 'predefined'/);

  // Order matters: a plant the old race already reached carries duplicates, and
  // building the index over them fails the migration outright.
  const demoteAt = MIGRATION.indexOf(`UPDATE "ministry_teams" SET "type"`);
  const createAt = MIGRATION.indexOf("CREATE UNIQUE INDEX");
  assert.ok(demoteAt > -1, "the migration must handle pre-existing duplicates");
  assert.ok(
    demoteAt < createAt,
    "duplicates are demoted BEFORE the index is built"
  );

  // Demoted, never deleted — a duplicate may already carry roles, memberships
  // and meetings, and a migration is the wrong place to call those fiction.
  assert.equal(
    /DELETE\s+FROM\s+"?ministry_teams/i.test(MIGRATION),
    false,
    "the migration must not delete a planter's teams"
  );
});

// ----------------------------------------------------------------------------
// 2. The statement
// ----------------------------------------------------------------------------

test("initialization is ONE insert that cannot duplicate", () => {
  assert.equal(
    (INITIALIZER.match(/db\s*\n?\s*\.insert\(/g) ?? []).length,
    1,
    "every row is known up front, so all of them go in one statement"
  );
  assert.equal(
    /for \(const template of templates\)/.test(INITIALIZER),
    false,
    "the per-template insert loop is the shape the race lived in"
  );

  assert.match(INITIALIZER, /\.onConflictDoNothing\(\{/);
  assert.match(
    INITIALIZER,
    /target: \[ministryTeams\.churchId, ministryTeams\.name\]/
  );
});

test("the ON CONFLICT predicate matches the index predicate", () => {
  // These two are one change. Postgres infers the arbiter index by matching the
  // predicate against the stored one, and the literal must be inlined rather
  // than parameterised for that match to happen at all.
  assert.match(
    INITIALIZER,
    /where: sql`\$\{ministryTeams\.type\} = 'predefined'`/,
    "the ON CONFLICT index_predicate must repeat the index's own predicate"
  );
});

test("an empty selection writes nothing instead of throwing", async () => {
  // `teamKeys: []` is reachable from the /teams dialog's own state, and an
  // INSERT with no rows is a runtime error rather than a no-op. No database is
  // touched, which is why this assertion runs in the hermetic suite.
  assert.deepEqual(
    await initializePredefinedTeams(
      "00000000-0000-0000-0000-000000000000",
      "00000000-0000-0000-0000-000000000000",
      []
    ),
    []
  );
});

test("the templates it inserts are still the shipped ones", () => {
  // The guard is only as good as its scope: it covers `type = 'predefined'`, so
  // every row this function writes must claim that type.
  assert.match(INITIALIZER, /type: "predefined" as TeamType/);
  assert.match(INITIALIZER, /name: template\.teamName/);
  assert.ok(
    TEAM_TEMPLATES.length > 0,
    "the template list is what the index is about"
  );
  assert.equal(
    new Set(TEAM_TEMPLATES.map((template) => template.teamName)).size,
    TEAM_TEMPLATES.length,
    "two templates sharing a name would make the shipped set unrepresentable"
  );
});
