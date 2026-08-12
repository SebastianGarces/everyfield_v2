import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { completeOnboardingStatement } from "./complete-onboarding";

// ----------------------------------------------------------------------------
// F12 / OB-001 + OB-009 — the completion statement, pinned at the SQL level.
//
// The guarantees live INSIDE the one statement — the `IS NULL` idempotency
// guard, and the dirty stamp riding the same UPDATE — so the tests read the
// generated SQL rather than driving an orchestration that does not exist.
// ----------------------------------------------------------------------------

const CHURCH_ID = "22222222-2222-4222-8222-222222222222";

const dialect = new PgDialect();

function render(statement: {
  getSQL: () => Parameters<PgDialect["sqlToQuery"]>[0];
}) {
  return dialect.sqlToQuery(statement.getSQL()).sql;
}

test("completion is one idempotent UPDATE, guarded on the stamp being unset", () => {
  const sql = render(completeOnboardingStatement(CHURCH_ID, new Date()));

  assert.match(sql, /update\s+"churches"\s+set/i);
  assert.match(sql, /"onboarding_completed_at"/);
  // The `IS NULL` guard: a double submit cannot move a completion timestamp
  // that is already set — nor re-dirty a plant that finished days ago.
  assert.match(sql, /"onboarding_completed_at"\s+is\s+null/i);
});

test("finishing marks the plant dirty in the SAME statement (OB-009)", () => {
  const sql = render(completeOnboardingStatement(CHURCH_ID, new Date()));

  assert.match(sql, /"last_material_event_at"/);
});
