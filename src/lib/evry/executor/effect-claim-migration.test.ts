import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "src/db/migrations/0070_evry_execution_effect_claims.sql"
  ),
  "utf8"
);
const recurrenceMigration = readFileSync(
  path.join(
    process.cwd(),
    "src/db/migrations/0071_task_recurrence_series_guard.sql"
  ),
  "utf8"
);
const claimWriter = readFileSync(
  path.join(process.cwd(), "src/lib/evry/executor/database-effect.ts"),
  "utf8"
);

test("0070 separates a mutation claim from its terminal executor outcome", () => {
  assert.match(migration, /CREATE TABLE "evry_execution_effect_claims"/);
  const claimInsert = migration.indexOf(
    'CREATE TABLE "evry_execution_effect_claims"'
  );
  const telemetry = migration.indexOf("CREATE OR REPLACE VIEW");
  const claimTableEnd = migration.indexOf(");", claimInsert);
  assert.ok(claimInsert >= 0);
  assert.ok(telemetry > claimInsert);
  assert.ok(claimTableEnd > claimInsert);
  assert.match(migration, /'effect_claim'[\s\S]+'domain_mutation_claimed'/);
  assert.doesNotMatch(
    migration.slice(claimInsert, claimTableEnd),
    /arguments|document|prompt|recipient|message|error_text/i
  );
  assert.match(claimWriter, /insert into evry_execution_effect_claims/);
  assert.doesNotMatch(claimWriter, /insert into evry_execution_outcomes/);
});

test("0070 makes exact claims immutable and blocks contradictory finalization", () => {
  assert.match(
    migration,
    /CREATE FUNCTION "evry_validate_execution_effect_claim_step"[\s\S]+jsonb_array_elements/
  );
  assert.match(
    migration,
    /CREATE TRIGGER "evry_execution_effect_claims_exact_step"/
  );
  assert.match(
    migration,
    /evry_execution_effect_claims_immutable[\s\S]+BEFORE UPDATE OR DELETE/
  );
  assert.match(
    migration,
    /evry_execution_effect_claims_no_truncate[\s\S]+BEFORE TRUNCATE/
  );
  assert.match(
    migration,
    /NEW\."subject" = 'step'[\s\S]+NEW\."status" <> 'completed'/
  );
  assert.match(
    migration,
    /NEW\."subject" = 'attempt'[\s\S]+unreconciled effect claim/
  );
  assert.match(migration, /ROLLBACK \(isolated database only/);
});

test("0071 arbitrates one live successor per plant recurrence series", () => {
  assert.match(
    recurrenceMigration,
    /CREATE UNIQUE INDEX "tasks_open_recurrence_series_unique_idx"/
  );
  assert.match(recurrenceMigration, /"church_id"/);
  assert.match(recurrenceMigration, /coalesce/);
  assert.match(recurrenceMigration, /recurrence_rule" ->> 'seriesId'/);
  assert.match(recurrenceMigration, /"id"::text/);
  assert.match(recurrenceMigration, /status" <> 'complete'/);
  assert.match(recurrenceMigration, /deleted_at" is null/);
  assert.match(recurrenceMigration, /ROLLBACK \(isolated database only/);
});
