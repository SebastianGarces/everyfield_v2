import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { completeTaskStatement, reopenTaskStatement } from "./service";

const dialect = new PgDialect();

const CHURCH_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";

function render(statement: {
  getSQL: () => Parameters<PgDialect["sqlToQuery"]>[0];
}) {
  return dialect.sqlToQuery(statement.getSQL());
}

test("exact completion treats a reviewed absent recurrence rule as SQL NULL", () => {
  const query = render(
    completeTaskStatement({
      churchId: CHURCH_ID,
      taskId: TASK_ID,
      actorUserId: ACTOR_ID,
      completedAt: new Date("2026-08-30T12:00:00.000Z"),
      expectedRecurrenceRule: null,
    })
  );

  assert.match(query.sql, /t\.recurrence_rule is null/i);
  assert.doesNotMatch(query.sql, /t\.recurrence_rule[^\n]*::jsonb/i);
  assert.equal(query.params.includes("null"), false);
});

test("exact reopen treats a reviewed absent recurrence rule as SQL NULL", () => {
  const query = render(
    reopenTaskStatement({
      churchId: CHURCH_ID,
      taskId: TASK_ID,
      expectedRecurrenceRule: null,
    })
  );

  assert.match(query.sql, /t\.recurrence_rule is null/i);
  assert.doesNotMatch(query.sql, /t\.recurrence_rule[^\n]*::jsonb/i);
  assert.equal(query.params.includes("null"), false);
});

test("exact completion still binds a reviewed recurrence rule as JSON", () => {
  const recurrenceRule = { frequency: "weekly", interval: 1 };
  const query = render(
    completeTaskStatement({
      churchId: CHURCH_ID,
      taskId: TASK_ID,
      actorUserId: ACTOR_ID,
      completedAt: new Date("2026-08-30T12:00:00.000Z"),
      expectedRecurrenceRule: recurrenceRule,
    })
  );

  assert.match(
    query.sql,
    /t\.recurrence_rule is not distinct from[^\n]*::jsonb/i
  );
  assert.equal(query.params.includes(JSON.stringify(recurrenceRule)), true);
});
