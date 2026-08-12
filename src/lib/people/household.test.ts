import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { buildCreateHouseholdWithHeadStatements } from "./household";

// ----------------------------------------------------------------------------
// createHouseholdWithHead (ruling 410-4B, fix round 2).
//
// The guarantee lives inside the statements: the household INSERT sources its
// row FROM the person row (insert … select), so a missing/deleted/forged
// personId inserts zero households — no pre-flight SELECT exists for a delete
// to slip behind — and the person UPDATE re-asserts the same predicate in the
// same batch. Both address modes go through this one shape.
//
// Following the create-church.test.ts precedent, these tests pin the rendered
// SQL instead of a live database.
// ----------------------------------------------------------------------------

const dialect = new PgDialect();

const CHURCH_ID = "00000000-0000-0000-0000-000000000001";
const PERSON_ID = "00000000-0000-0000-0000-000000000002";
const HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000003";

function render(statement: {
  getSQL: () => Parameters<PgDialect["sqlToQuery"]>[0];
}) {
  return dialect.sqlToQuery(statement.getSQL()).sql;
}

function statements(usePersonAddress: boolean) {
  return buildCreateHouseholdWithHeadStatements(
    CHURCH_ID,
    PERSON_ID,
    "Smith Household",
    usePersonAddress,
    HOUSEHOLD_ID
  );
}

const PERSON_PREDICATE =
  /"persons"\."church_id"\s*=\s*\$\d+ and "persons"\."id"\s*=\s*\$\d+ and "persons"\."deleted_at" is null/i;

test("the household INSERT selects FROM the person row — the existence check is the row source", () => {
  const { insertHousehold } = statements(false);
  const sql = render(insertHousehold);

  assert.match(sql, /insert into "households"/i);
  assert.match(sql, /select [\s\S]* from "persons"/i);
  assert.match(sql, PERSON_PREDICATE);
  // Without RETURNING, zero inserted rows (person not found) would be
  // indistinguishable from success.
  assert.match(sql, /returning/i);
});

test("the person UPDATE re-asserts the same predicate and installs the head", () => {
  const { updatePerson } = statements(false);
  const sql = render(updatePerson);

  assert.match(sql, /update "persons" set/i);
  assert.match(sql, /"household_id"\s*=\s*\$\d+/);
  assert.match(sql, /"household_role"\s*=\s*\$\d+/);
  assert.match(sql, PERSON_PREDICATE);
  assert.match(sql, /returning/i);
});

test("usePersonAddress copies the person's address (empty strings become null)", () => {
  const { insertHousehold } = statements(true);
  const sql = render(insertHousehold);

  // Inside the single-table select, person columns render unqualified.
  assert.match(sql, /nullif\("address_line1", ''\)/i);
  assert.match(sql, /nullif\("postal_code", ''\)/i);
  assert.match(sql, /coalesce\("country", 'US'\)/i);
});

test("without usePersonAddress the household carries no address", () => {
  const { insertHousehold } = statements(false);
  const sql = render(insertHousehold);

  assert.doesNotMatch(sql, /nullif/i);
  // The five address slots — line1, line2, city, state, postal — are null;
  // country is a bound parameter that falls back to 'US'.
  assert.match(
    sql,
    /select \$\d+::uuid, "church_id", \$\d+, null, null, null, null, null, \$\d+, now\(\), now\(\) from "persons"/i
  );
});
