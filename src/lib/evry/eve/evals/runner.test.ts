import assert from "node:assert/strict";
import { test } from "node:test";
import { regressions } from "./catalog";
import { runEvalSuite } from "./runner";

test("unbound fixtures are blocked and never count as passing evaluations", async () => {
  const report = await runEvalSuite({
    scenarios: regressions.slice(0, 2),
    adapter: { prepare: async () => null },
    budgetUsd: 1,
    maxCaseCostUsd: 0.1,
  });
  assert.equal(report.summary.blocked, 2);
  assert.equal(report.summary.passed, false);
  assert.equal(report.reservedUsd, 0);
});

test("an interrupted call still consumes its budget reservation and cleans up", async () => {
  let runs = 0;
  let cleanups = 0;
  const report = await runEvalSuite({
    scenarios: regressions.slice(0, 3),
    budgetUsd: 0.1,
    maxCaseCostUsd: 0.1,
    adapter: {
      prepare: async () => ({
        expectations: regressions[0].expectations,
        run: async () => {
          runs++;
          throw new Error("provider interrupted");
        },
        cleanup: async () => {
          cleanups++;
        },
      }),
    },
  });
  assert.equal(runs, 1);
  assert.equal(cleanups, 1);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.not_run, 2);
  assert.equal(report.reservedUsd, 0.1);
});

test("no live eval can begin without explicit finite spending bounds", async () => {
  for (const budgetUsd of [0, -1, NaN, Infinity]) {
    await assert.rejects(
      runEvalSuite({
        scenarios: regressions,
        adapter: {
          prepare: async () => {
            throw new Error("must not dispatch");
          },
        },
        budgetUsd,
        maxCaseCostUsd: 0.1,
      }),
      /budget/
    );
  }
});

test("a broken fixture stops later cases but preserves the results and spending record", async () => {
  for (const phase of ["setup", "cleanup"] as const) {
    let setups = 0;
    const report = await runEvalSuite({
      scenarios: regressions.slice(0, 3),
      budgetUsd: 1,
      maxCaseCostUsd: 0.1,
      adapter: {
        prepare: async () => {
          setups++;
          if (phase === "setup") throw new Error("partial setup");
          return {
            expectations: regressions[0].expectations,
            run: async () => {
              throw new Error("interrupted");
            },
            cleanup: async () => {
              throw new Error("fixture remains dirty");
            },
          };
        },
      },
    });
    assert.equal(setups, 1);
    assert.equal(report.results.length, 3);
    assert.ok(report.results[0].failures.includes(`fixture_${phase}_failed`));
    assert.equal(report.summary.not_run, 2);
    assert.equal(report.summary.passed, false);
    assert.ok(
      Math.abs(report.reservedUsd - (phase === "setup" ? 0 : 0.1)) < 0.000001
    );
  }
});
