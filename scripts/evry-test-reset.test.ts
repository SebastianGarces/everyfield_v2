import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EVRY_TEST_CHURCH_ID } from "./evry-test-fixtures";
import {
  EVRY_TEST_EXECUTION_RESET_GUARD,
  EVRY_TEST_OPERATIONAL_RESET_TABLES,
  evryTestOperationalResetStatements,
} from "./evry-test-reset";

test("operational reset is fixed to the QA plant and claims precede recipients", () => {
  const statements = evryTestOperationalResetStatements();
  assert.equal(
    EVRY_TEST_OPERATIONAL_RESET_TABLES[0],
    "communication_failed_retries"
  );
  assert.equal(statements.length, EVRY_TEST_OPERATIONAL_RESET_TABLES.length);
  for (const statement of statements) {
    assert.deepEqual(statement.params, [EVRY_TEST_CHURCH_ID]);
    assert.match(
      statement.sql,
      /^DELETE FROM "[a-z_]+" WHERE church_id = \$1$/
    );
    assert.doesNotMatch(statement.sql, /evry_(action|plan|execution|product)/);
  }
  const source = readFileSync("scripts/seed-evry-test.ts", "utf8");
  assert.ok(
    source.indexOf("...evryTestOperationalResetStatements()") <
      source.indexOf("...[...resetTables]")
  );
  assert.match(
    source,
    /replaceOperationalTables: \[\s*\.\.\.EVRY_TEST_OPERATIONAL_RESET_TABLES/
  );
  assert.match(
    source,
    /const censusTables = \[[\s\S]*?\.\.\.EVRY_TEST_OPERATIONAL_RESET_TABLES/
  );
  assert.match(
    source,
    /table === "communication_failed_retries"\s*\? "t.source_recipient_id"/
  );
  assert.match(EVRY_TEST_EXECUTION_RESET_GUARD, /status = 'active'/);
  assert.match(EVRY_TEST_EXECUTION_RESET_GUARD, /s.status = 'executing'/);
  assert.match(
    EVRY_TEST_EXECUTION_RESET_GUARD,
    /unreconciled execution effect/
  );
});
