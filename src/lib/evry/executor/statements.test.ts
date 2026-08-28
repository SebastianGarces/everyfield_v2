import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  executionAttemptKey,
  executionAttemptOutcomeKey,
} from "@/lib/evry/audit/identity";

import {
  finishEvryExecutionStatement,
  startEvryExecutionStatement,
} from "./statements";

const dialect = new PgDialect();
const PLAN_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000001";
const PLANT_ID = "30000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "40000000-0000-4000-8000-000000000001";
const FINGERPRINT = "a".repeat(64);

function render(statement: {
  getSQL: () => Parameters<PgDialect["sqlToQuery"]>[0];
}): string {
  return dialect.sqlToQuery(statement.getSQL()).sql;
}

test("an attempt can only be sourced from the winning approved-to-executing CAS", () => {
  const query = render(
    startEvryExecutionStatement({
      attemptId: ATTEMPT_ID,
      attemptKey: executionAttemptKey(PLAN_ID, FINGERPRINT),
      planId: PLAN_ID,
      actorUserId: ACTOR_ID,
      plantId: PLANT_ID,
      fingerprint: FINGERPRINT,
      startedAt: new Date("2026-08-28T12:00:00.000Z"),
    })
  );

  const transition = query.indexOf("update evry_action_plan_states");
  const attempt = query.indexOf("insert into evry_execution_attempts");
  assert.equal(transition >= 0, true);
  assert.equal(attempt > transition, true);
  assert.match(query, /s\.status = 'approved'/i);
  assert.match(query, /join transitioned t on t\.plan_id = e\.id/i);
  assert.doesNotMatch(query, /left join transitioned/i);
});

test("a terminal state transition is sourced only from the winning outcome", () => {
  const query = render(
    finishEvryExecutionStatement({
      attemptId: ATTEMPT_ID,
      planId: PLAN_ID,
      actorUserId: ACTOR_ID,
      plantId: PLANT_ID,
      fingerprint: FINGERPRINT,
      outcomeKey: executionAttemptOutcomeKey(PLAN_ID, FINGERPRINT),
      attemptStatus: "partially_failed",
      planStatus: "partially_failed",
      occurredAt: new Date("2026-08-28T12:00:01.000Z"),
    })
  );

  const outcome = query.indexOf("insert into evry_execution_outcomes");
  const transition = query.indexOf("update evry_action_plan_states");
  assert.equal(outcome >= 0, true);
  assert.equal(transition > outcome, true);
  assert.match(query, /from recorded r/i);
  assert.match(query, /s\.status = 'executing'/i);
  assert.match(query, /end,\s*0, 0, \$\d+/i);
});

test("0067 migrates legacy no-op rows before enforcing subject-aware completion", () => {
  const migration = readFileSync(
    path.join(
      process.cwd(),
      "src/db/migrations/0067_evry_execution_outcomes.sql"
    ),
    "utf8"
  );
  const data = migration.indexOf('UPDATE "evry_execution_outcomes"');
  const constraint = migration.indexOf(
    'ADD CONSTRAINT "evry_execution_outcomes_result_code_check"'
  );
  assert.equal(data >= 0, true);
  assert.equal(constraint > data, true);
  assert.match(
    migration,
    /SET "affected_count" = 0, "excluded_count" = 0[\s\S]*WHERE "subject" = 'attempt'[\s\S]*"evry_execution_outcomes_attempt_counts_check"/
  );
  assert.match(migration, /subject[\s\S]*step[\s\S]*effect_completed/i);
  assert.match(migration, /subject[\s\S]*attempt[\s\S]*execution_completed/i);
  assert.match(migration, /Manual rollback/);
  assert.match(
    migration,
    /effect_key = CASE WHEN subject = 'attempt' THEN outcome_key ELSE effect_key END/
  );
});
