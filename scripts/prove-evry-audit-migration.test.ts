import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(REPO, "scripts/prove-evry-audit-migration.sh");

function invokeWith(database: string) {
  return spawnSync("bash", [SCRIPT], {
    cwd: REPO,
    encoding: "utf8",
    env: {
      ...process.env,
      EVRY_AUDIT_PROOF_DATABASE: database,
      PSQL: "false",
    },
  });
}

test("the audit proof refuses every non-scratch database before psql", () => {
  for (const database of [
    "postgres",
    "evry_audit_migration_proof_short",
    `evry_audit_migration_proof_${"a".repeat(31)}`,
    "evry_audit_migration_proof_review-764",
  ]) {
    const result = invokeWith(database);
    assert.equal(result.status, 64, database);
    assert.match(result.stderr, /refusing unsafe proof database name/);
  }

  const validScratch = invokeWith("evry_audit_migration_proof_review764");
  assert.notEqual(validScratch.status, 64);
});

test("the audit proof creates and drops only its validated identifier", () => {
  const source = readFileSync(SCRIPT, "utf8");

  assert.match(source, /TARGET="src\/db\/migrations\/0066_evry_audit\.sql"/);
  assert.match(source, /format\('CREATE DATABASE %I', :'proof_database'\)/);
  assert.match(
    source,
    /format\('DROP DATABASE IF EXISTS %I WITH \(FORCE\)', :'proof_database'\)/
  );
  assert.equal(
    (source.match(/-v proof_database="\$PROOF_DATABASE"/g) ?? []).length,
    2
  );
  assert.doesNotMatch(source, /(?:CREATE|DROP) DATABASE[^\n]*\$PROOF_DATABASE/);
});
