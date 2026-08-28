import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { mintEvryPlanRequestKey } from "@/lib/evry/plans";

import {
  correlationForPlanRequest,
  executionAttemptOutcomeKey,
  mintEvryAuditRequest,
  noopAttemptKey,
  noopEffectKey,
  noopOutcomeKey,
  planEventKey,
} from "./identity";
import { completeConfirmedNoopStatement } from "./statements";

const dialect = new PgDialect();
const PLAN_ID = "10000000-0000-4000-8000-000000000001";

function render(statement: {
  getSQL: () => Parameters<PgDialect["sqlToQuery"]>[0];
}): string {
  return dialect.sqlToQuery(statement.getSQL()).sql;
}

test("request correlations are server-minted and audit keys are deterministic", () => {
  const requestKey = mintEvryPlanRequestKey();
  assert.equal(correlationForPlanRequest(requestKey), requestKey);

  assert.equal(
    planEventKey(PLAN_ID, "plan_proposed"),
    planEventKey(PLAN_ID, "plan_proposed")
  );
  assert.notEqual(
    planEventKey(PLAN_ID, "plan_proposed"),
    planEventKey(PLAN_ID, "plan_approved")
  );
  assert.equal(noopAttemptKey(PLAN_ID).length, 64);
  assert.equal(noopOutcomeKey(PLAN_ID).length, 64);
  assert.equal(noopEffectKey(PLAN_ID).length, 64);

  const first = mintEvryAuditRequest();
  const second = mintEvryAuditRequest();
  assert.notEqual(first.correlationId, second.correlationId);
  assert.equal(first.correlationId, first.planRequestKey);
  assert.equal(first.eventKey.length, 64);
  assert.equal(Object.isFrozen(first), true);
});

test("the no-op statement gates attempt and outcome on the winning effect CAS", () => {
  const query = render(
    completeConfirmedNoopStatement({
      planId: PLAN_ID,
      actorUserId: "20000000-0000-4000-8000-000000000001",
      plantId: "30000000-0000-4000-8000-000000000001",
      fingerprint: "a".repeat(64),
      attemptId: "40000000-0000-4000-8000-000000000001",
      attemptKey: noopAttemptKey(PLAN_ID),
      outcomeKey: noopOutcomeKey(PLAN_ID),
      attemptOutcomeKey: executionAttemptOutcomeKey(PLAN_ID, "a".repeat(64)),
      effectKey: noopEffectKey(PLAN_ID),
      occurredAt: new Date("2026-08-28T12:00:00.000Z"),
    })
  );

  const effect = query.indexOf("update evry_action_plan_states");
  const attempt = query.indexOf("insert into evry_execution_attempts");
  const outcome = query.indexOf("insert into evry_execution_outcomes");
  assert.equal(effect >= 0, true);
  assert.equal(attempt > effect, true);
  assert.equal(outcome > attempt, true);
  assert.match(query, /from completed/i);
  assert.match(query, /from attempted/i);
  assert.match(query, /p\.document = \$\d+::jsonb/i);
  assert.doesNotMatch(query, /on conflict/i);
});

test("0066 is restrictive, append-only, and exposes only a redacted view", () => {
  const migration = readFileSync(
    path.join(process.cwd(), "src/db/migrations/0066_evry_audit.sql"),
    "utf8"
  );
  assert.doesNotMatch(migration, /ON DELETE cascade/i);
  assert.match(
    migration,
    /evry_product_audit_events_shape_check[\s\S]+request_failed[\s\S]+request_invalid/i
  );
  assert.match(
    migration,
    /CREATE TRIGGER "evry_execution_outcomes_immutable"[\s\S]+BEFORE UPDATE OR DELETE/i
  );
  assert.match(
    migration,
    /CREATE TRIGGER "evry_execution_outcomes_no_truncate"[\s\S]+BEFORE TRUNCATE/i
  );
  assert.match(
    migration,
    /CREATE FUNCTION "evry_validate_execution_outcome_step"[\s\S]+jsonb_array_elements[\s\S]+capabilityIdentity/i
  );
  assert.match(
    migration,
    /CREATE TRIGGER "evry_execution_outcomes_exact_step"/i
  );

  const view = migration.slice(
    migration.indexOf('CREATE VIEW "evry_redacted_telemetry"')
  );
  assert.doesNotMatch(
    view,
    /actor_user_id|church_id|plan_id|plan_fingerprint|attempt_id|outcome_id|document|arguments|prompt|recipient|error/i
  );
});

test("the typed telemetry reader cannot project scoped or raw identities", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/evry/audit/telemetry.ts"),
    "utf8"
  );
  const select = source.slice(
    source.indexOf("select\n"),
    source.indexOf("from evry_redacted_telemetry")
  );
  assert.doesNotMatch(
    select,
    /actor|church|plant|plan|fingerprint|attempt_id|outcome_id|document|arguments|prompt|recipient|error/i
  );
  assert.match(source, /correlationId: EvryCorrelationId/);
});
