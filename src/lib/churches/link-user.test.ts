import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { linkUserToChurchFilter } from "./link-user";

// ----------------------------------------------------------------------------
// #183 — the church-link update must be scoped to the caller.
//
// The original predicate was `isNull(users.churchId)` alone, which matched
// every church-less user on the platform (all pending planters plus every
// oversight admin, whose church_id is null permanently). These tests render
// the filter to SQL and pin both halves of the compare-and-set so neither
// predicate can be dropped without a test failing.
// ----------------------------------------------------------------------------

const dialect = new PgDialect();

function render(userId: string) {
  return dialect.sqlToQuery(linkUserToChurchFilter(userId));
}

test("filter is scoped to the caller's user id", () => {
  const userId = "11111111-1111-1111-1111-111111111111";
  const { sql, params } = render(userId);

  assert.match(sql, /"users"\."id"\s*=\s*\$1/);
  assert.deepEqual(params, [userId]);
});

test("filter still requires church_id to be null (double-submit guard)", () => {
  const { sql } = render("11111111-1111-1111-1111-111111111111");

  assert.match(sql, /"users"\."church_id"\s+is\s+null/i);
});

test("both predicates are joined with AND, not OR", () => {
  const { sql } = render("11111111-1111-1111-1111-111111111111");

  assert.match(sql, /\band\b/i);
  assert.doesNotMatch(sql, /\bor\b/i);
});
