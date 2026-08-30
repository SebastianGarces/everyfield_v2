import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

test("Teams atomic effects claim a nonterminal relation before domain writes", () => {
  const atomic = source("src/lib/evry/capabilities/teams/atomic-effect.ts");
  assert.match(
    atomic,
    /insert into evry_execution_effect_claims[\s\S]*inserted_meetings/
  );
  assert.doesNotMatch(atomic, /insert into evry_execution_outcomes/);
});

test("Teams atomic effects fail closed when the actor names two tenancies", () => {
  const atomic = source("src/lib/evry/capabilities/teams/atomic-effect.ts");
  assert.match(
    atomic,
    /join users actor[\s\S]*actor\.church_id = a\.church_id[\s\S]*actor\.sending_church_id is null[\s\S]*actor\.sending_network_id is null[\s\S]*actor\.seat/
  );
});

test("0070 binds effect claims to an exact plan step and makes them append-only", () => {
  const migration = source("src/db/migrations/0070_woozy_sharon_ventura.sql");
  assert.match(
    migration,
    /FOREIGN KEY \("attempt_id","plan_id","church_id","actor_user_id","plan_fingerprint","correlation_id"\)/
  );
  assert.match(
    migration,
    /UNIQUE INDEX "evry_execution_effect_claims_effect_unique_idx"[\s\S]*\("church_id","effect_key"\)/
  );
  assert.match(
    migration,
    /UNIQUE INDEX "evry_execution_effect_claims_step_unique_idx"[\s\S]*\("attempt_id","step_id"\)/
  );
  assert.match(
    migration,
    /evry_execution_effect_claims_exact_step[\s\S]*evry_execution_effect_claims_immutable[\s\S]*evry_execution_effect_claims_no_truncate/
  );
  assert.match(
    migration,
    /DELETE FROM drizzle\.__drizzle_migrations WHERE created_at = 1788059440428/
  );
});
