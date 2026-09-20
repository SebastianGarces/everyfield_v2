import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogCoverage,
  questions,
  regressions,
  selectCases,
} from "./catalog";

test("the rebuild preserves every historical question and all capability areas", () => {
  const coverage = catalogCoverage();
  assert.equal(questions.length, 126);
  assert.equal(regressions.length, 32);
  assert.equal(coverage.total, 158);
  assert.equal(coverage.domains.length, 19);
  assert.equal(coverage.contracts.length, 23);
  assert.equal(coverage.workflows.length, 8);
  assert.ok(coverage.domains.every((entry) => entry.count > 0));
  assert.ok(coverage.contracts.every((entry) => entry.cases.length > 0));
  assert.ok(coverage.workflows.every((entry) => entry.cases.length > 0));
  assert.equal(new Set(selectCases("full").map((entry) => entry.id)).size, 158);
});

test("smoke includes original representative questions and reported failures", () => {
  const ids = new Set(selectCases("smoke").map((entry) => entry.id));
  for (const id of [
    "people-01",
    "wiki-03",
    "edges-12",
    "regression-today",
    "regression-orientation",
    "regression-launch-overview",
    "regression-retry",
  ])
    assert.ok(ids.has(id));
  assert.ok(selectCases("security").length >= 10);
});
