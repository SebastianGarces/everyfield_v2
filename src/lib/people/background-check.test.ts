import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { backgroundCheckStatuses, persons } from "@/db/schema";
import { getTableConfig } from "drizzle-orm/pg-core";

import { teamRequiresBackgroundCheck } from "@/lib/ministry-teams/role-templates";
import {
  personCreateSchema,
  personUpdateSchema,
} from "@/lib/validations/people";
import {
  BACKGROUND_CHECK_BADGE_CONFIG,
  backgroundCheckBadge,
} from "./background-check";

/**
 * Repo-relative POSIX path → absolute, the convention every source-shaped suite
 * here uses: `pnpm test` runs from the repository root, and
 * `import.meta.dirname` is undefined under tsx's CJS output.
 */
function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), ...relative.split("/")), "utf8");
}

// ----------------------------------------------------------------------------
// The column and its vocabulary.
// ----------------------------------------------------------------------------

test("the four statuses are the vocabulary, and not_started is the floor", () => {
  assert.deepEqual(backgroundCheckStatuses, [
    "not_started",
    "in_progress",
    "cleared",
    "flagged",
  ]);
});

test("persons.background_check_status is NOT NULL and defaults to not_started", () => {
  const { columns } = getTableConfig(persons);
  const column = columns.find((c) => c.name === "background_check_status");

  assert.ok(column, "expected a background_check_status column on persons");
  assert.equal(column.notNull, true);
  assert.equal(column.default, "not_started");
});

test("the database closes the vocabulary, not just TypeScript", () => {
  const { checks } = getTableConfig(persons);
  const constraint = checks.find(
    (c) => c.name === "persons_background_check_status_check"
  );

  assert.ok(constraint, "expected persons_background_check_status_check");
});

test("the shipped migration adds the column with its backfilling default", () => {
  const sql = read("src/db/migrations/0043_person_background_check_status.sql");

  // The default IS the backfill: NOT NULL with a default fills every existing
  // row in the same statement, so no separate UPDATE may creep in later.
  assert.match(
    sql,
    /ADD COLUMN "background_check_status" varchar\(20\) DEFAULT 'not_started' NOT NULL/
  );
  assert.match(sql, /persons_background_check_status_check/);
  for (const status of backgroundCheckStatuses) {
    assert.ok(
      sql.includes(`'${status}'`),
      `expected ${status} in the CHECK constraint`
    );
  }
});

// ----------------------------------------------------------------------------
// The boundary: zod at the edge, in both directions.
// ----------------------------------------------------------------------------

test("create leaves the floor to the column and refuses a value outside the vocabulary", () => {
  // No zod default: a creation path that says nothing writes nothing, and the
  // column's own DEFAULT supplies `not_started`. Two declarations of the floor
  // is how they drift.
  const created = personCreateSchema.parse({
    firstName: "Jane",
    lastName: "Smith",
  });
  assert.equal(created.backgroundCheckStatus, undefined);

  const parsed = personCreateSchema.safeParse({
    firstName: "Jane",
    lastName: "Smith",
    backgroundCheckStatus: "passed",
  });
  assert.equal(parsed.success, false);
});

test("update carries the status through and defaults nothing", () => {
  const cleared = personUpdateSchema.parse({
    backgroundCheckStatus: "cleared",
  });
  assert.equal(cleared.backgroundCheckStatus, "cleared");

  // An edit that says nothing about the check must not silently reset it.
  const untouched = personUpdateSchema.parse({ firstName: "Jane" });
  assert.equal(untouched.backgroundCheckStatus, undefined);

  assert.equal(
    personUpdateSchema.safeParse({ backgroundCheckStatus: "" }).success,
    false
  );
});

// ----------------------------------------------------------------------------
// The display vocabulary — one table, and a string-safe accessor over it.
// ----------------------------------------------------------------------------

test("every status has a badge, and only not_started is uncoloured", () => {
  assert.deepEqual(Object.keys(BACKGROUND_CHECK_BADGE_CONFIG), [
    ...backgroundCheckStatuses,
  ]);

  for (const status of backgroundCheckStatuses) {
    const config = BACKGROUND_CHECK_BADGE_CONFIG[status];
    assert.ok(config.label.length > 0, `${status} needs a label`);

    if (status === "not_started") {
      assert.equal(config.variant, "secondary");
      assert.equal(config.className, "");
      continue;
    }

    assert.equal(config.variant, "outline");
    // The tinted-editorial shape: one hue as ground, ink and border, mirrored
    // in the dark theme (memory/invariants.md → Design Tokens).
    for (const part of [
      /(?:^| )bg-\w+-50 /,
      / text-\w+-800 /,
      / border-\w+-200 /,
      / dark:bg-\w+-950 /,
      / dark:text-\w+-200 /,
      / dark:border-\w+-800/,
    ]) {
      assert.match(config.className, part, `${status}: ${part}`);
    }
  }
});

test("a value the database could not hold reads as the floor, never as itself", () => {
  assert.equal(backgroundCheckBadge("cleared").label, "Cleared");
  assert.equal(backgroundCheckBadge("nonsense").label, "Not started");
  // Keyed through Object.hasOwn, so a prototype key is not a badge.
  assert.equal(backgroundCheckBadge("constructor").label, "Not started");
  assert.equal(backgroundCheckBadge("toString").label, "Not started");
});

// ----------------------------------------------------------------------------
// Which rosters show it — the team-level ruling.
// ----------------------------------------------------------------------------

test("the Children's Ministry roster requires it and no other predefined team does", () => {
  assert.equal(teamRequiresBackgroundCheck("Children's Ministry"), true);
  assert.equal(teamRequiresBackgroundCheck("children's ministry"), true);
  assert.equal(teamRequiresBackgroundCheck("  Children's Ministry  "), true);

  for (const name of ["Worship Team", "Facilities", "Small Groups"]) {
    assert.equal(teamRequiresBackgroundCheck(name), false, name);
  }
});

test("a team name that matches no template requires nothing", () => {
  assert.equal(teamRequiresBackgroundCheck("Kids Crew"), false);
  assert.equal(teamRequiresBackgroundCheck(""), false);
});
