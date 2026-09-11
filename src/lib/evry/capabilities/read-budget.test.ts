import assert from "node:assert/strict";
import test from "node:test";
import { createEvryReadBudget, EVRY_READ_BUDGET } from "./read-budget";

test("equivalent inputs cannot spend another read, regardless of key ordering", () => {
  const budget = createEvryReadBudget();
  assert.equal(
    budget.claim("people.query", { b: [1], a: { d: 2, c: 1 } }),
    true
  );
  assert.equal(
    budget.claim("people.query", { a: { c: 1, d: 2 }, b: [1] }),
    false
  );
  assert.equal(
    budget.claim("people.query", { a: { c: 2, d: 2 }, b: [1] }),
    true
  );
});
test("eight distinct calls are allowed, a ninth is not", () => {
  const budget = createEvryReadBudget();
  for (let page = 0; page < 8; page++)
    assert.equal(budget.claim("test", { page }), true);
  assert.equal(budget.claim("test", { page: 8 }), false);
});
test("rows, evidence characters and elapsed time independently stop more work", () => {
  for (const kind of ["rows", "characters", "time"]) {
    let now = 0;
    const budget = createEvryReadBudget(() => now);
    assert.equal(budget.claim("first", {}), true);
    if (kind === "rows") budget.record(EVRY_READ_BUDGET.rows, {});
    if (kind === "characters")
      budget.record(0, "x".repeat(EVRY_READ_BUDGET.evidenceCharacters));
    if (kind === "time") now = EVRY_READ_BUDGET.durationMs;
    assert.equal(budget.claim("next", {}), false, kind);
  }
});
