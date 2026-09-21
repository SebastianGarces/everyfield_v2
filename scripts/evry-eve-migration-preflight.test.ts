import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectMigrationLedger } from "./evry-eve-migration-preflight";

const first = { tag: "0080_retry", when: 100, hash: "a".repeat(64) };
const next = { tag: "0081_attachment", when: 200, hash: "b".repeat(64) };
const applied = { created_at: "100", hash: first.hash };

test("an applied prefix and pending tail are different from missing shadowed history", () => {
  const audit = inspectMigrationLedger([first, next], [applied]);
  assert.deepEqual(
    audit.entries.map((entry) => entry.state),
    ["applied", "pending"]
  );
  const shadowed = inspectMigrationLedger(
    [first, next],
    [{ created_at: "300", hash: "c".repeat(64) }]
  );
  assert.deepEqual(
    shadowed.entries.map((entry) => entry.state),
    ["shadowed_missing", "shadowed_missing"]
  );
  assert.equal(shadowed.unrecognizedAppliedRows.length, 1);
});

test("a matching timestamp does not hide changed SQL or duplicate ledger rows", () => {
  assert.equal(
    inspectMigrationLedger([first], [{ ...applied, hash: next.hash }])
      .entries[0].state,
    "hash_mismatch"
  );
  assert.equal(
    inspectMigrationLedger([first], [applied, applied]).entries[0].state,
    "duplicate_stamp"
  );
});

test("empty database history leaves every migration pending without changing inputs", () => {
  const migrations = [first, next];
  const before = structuredClone(migrations);
  assert.deepEqual(
    inspectMigrationLedger(migrations, []).entries.map((entry) => entry.state),
    ["pending", "pending"]
  );
  assert.deepEqual(migrations, before);
});
