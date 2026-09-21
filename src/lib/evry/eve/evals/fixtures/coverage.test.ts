import assert from "node:assert/strict";
import { test } from "node:test";
import { questions, regressions } from "../catalog";
import {
  createProductionEveEvalAdapter,
  productionFixtureCoverage,
} from "./adapter";
import { createFixtureStore } from "./store";

const expectedOriginals = [
  "tasks-01",
  "tasks-02",
  "tasks-03",
  "tasks-04",
  "tasks-05",
  "tasks-06",
  "tasks-08",
  "tasks-09",
  "tasks-11",
  "roles-01",
  "launch-01",
  "wiki-03",
  "documents-01",
  "documents-03",
  "interviews-01",
  "interviews-02",
  "interviews-03",
  "assessments-02",
  "people-05",
  "training-01",
  "training-02",
  "training-03",
  "commitments-01",
  "meetings-02",
  "people-06",
  "roles-03",
  "roles-04",
  "people-03",
  "interviews-05",
  "assessments-01",
  "assessments-04",
  "commitments-05",
  "communication-07",
  "documents-02",
  "wiki-04",
  "wiki-01",
  "wiki-02",
  "wiki-05",
  "wiki-07",
  "intelligence-04",
  "notifications-02",
  "people-02",
  "people-08",
  "meetings-01",
  "meetings-05",
  "meetings-07",
  "orientations-03",
  "notes-01",
  "notes-02",
  "notes-04",
].sort();
const expectedRegressions = [
  "regression-today",
  "regression-followup-priority",
  "regression-readable-copy",
  "regression-no-n-plus-one",
  "regression-separate-cohorts",
  "regression-attendance-not-rsvp",
  "regression-launch-overview",
  "regression-orientation",
  "regression-cross-tenant",
  "regression-wiki-injection",
].sort();

test("default production fixture coverage has 60 bindings and does not claim the remaining 98 pass", () => {
  const coverage = productionFixtureCoverage();
  const corpus = [...questions, ...regressions];
  assert.deepEqual(coverage.counts, {
    runnable: 60,
    originals: 50,
    regressions: 10,
    unbound: 98,
    corpus: 158,
  });
  assert.deepEqual([...coverage.originalIds].sort(), expectedOriginals);
  assert.deepEqual([...coverage.regressionIds].sort(), expectedRegressions);
  assert.equal(
    new Set(coverage.runnableIds).size,
    coverage.runnableIds.length,
    "a case must not be owned by two fixture families"
  );
  assert.equal(new Set(corpus.map(({ id }) => id)).size, 158);
  for (const id of coverage.runnableIds)
    assert.ok(
      corpus.some((entry) => entry.id === id),
      `Unknown binding ${id}`
    );
  assert.deepEqual(
    [...coverage.runnableIds, ...coverage.unboundIds].sort(),
    corpus.map(({ id }) => id).sort()
  );
  assert.ok(
    !coverage.unboundIds.some((id) => coverage.runnableIds.includes(id))
  );
});

test("adapter eligibility agrees with coverage before any storage or runtime work", async () => {
  const coverage = productionFixtureCoverage();
  const reachedSeed = new Error("Bound fixture reached its base seed");
  let seeds = 0;
  const adapter = createProductionEveEvalAdapter({
    // Constructing the store has no effects. Throw at the first adapter-owned
    // operation so this eligibility proof never creates or contacts a database.
    store: {
      ...createFixtureStore("evry-eve-fixture-000000000000-pg"),
      seed() {
        seeds++;
        throw reachedSeed;
      },
    },
    buildSha: "0".repeat(40),
    async runProduction() {
      throw new Error("Eligibility must not invoke Eve");
    },
  });
  for (const scenario of [...questions, ...regressions]) {
    if (coverage.runnableIds.includes(scenario.id))
      await assert.rejects(adapter.prepare(scenario), reachedSeed);
    else assert.equal(await adapter.prepare(scenario), null, scenario.id);
  }
  assert.equal(seeds, 60);
  assert.equal(
    await adapter.prepare({ ...questions[0]!, id: "unknown-case" }),
    null
  );
  // Base regressions still require a regression fixture, not a question whose
  // ID happens to resemble a regression. Security keeps its separate path.
  assert.equal(
    await adapter.prepare({ ...questions[0]!, id: "regression-today" }),
    null
  );
  assert.equal(seeds, 60);
});

test("document comparison is opt-in only after a file transport is supplied", async () => {
  const scenario = questions.find((q) => q.id === "documents-04")!;
  const reachedTruth = new Error("Stop at independent document truth");
  let ready = false,
    cleaned = false,
    revoked = false;
  const prepareDocumentFiles = async (
    files: readonly { key: string; body: Uint8Array }[]
  ) => {
    assert.equal(files.length, 4);
    assert.ok(files.every((file) => file.body.length > 0));
    ready = true;
    return async () => {
      ready = false;
      cleaned = true;
    };
  };
  assert.deepEqual(productionFixtureCoverage({ prepareDocumentFiles }).counts, {
    runnable: 61,
    originals: 51,
    regressions: 10,
    unbound: 97,
    corpus: 158,
  });
  assert.ok(productionFixtureCoverage().unboundIds.includes("documents-04"));
  const adapter = createProductionEveEvalAdapter({
    store: {
      ...createFixtureStore("evry-eve-fixture-000000000000-pg"),
      seed() {},
      sql() {
        assert.ok(ready || cleaned);
        return "";
      },
      query() {
        throw reachedTruth;
      },
      revoke() {
        revoked = true;
      },
    },
    prepareDocumentFiles,
    buildSha: "0".repeat(40),
    async runProduction() {
      throw new Error("Fixture setup must not invoke Eve");
    },
  });
  await assert.rejects(adapter.prepare(scenario), reachedTruth);
  assert.equal(ready, false);
  assert.equal(cleaned, true);
  assert.equal(revoked, true);
});

test("family wiring preserves shared historical distractors before the owning family seed", async () => {
  const scenario = questions.find(({ id }) => id === "interviews-05");
  assert.ok(scenario);
  const statements: string[] = [];
  const reachedTruth = new Error("Stop before the independent SQL read");
  const adapter = createProductionEveEvalAdapter({
    store: {
      ...createFixtureStore("evry-eve-fixture-000000000000-pg"),
      seed() {
        statements.push("base");
      },
      sql(statement) {
        statements.push(statement);
        return "";
      },
      query() {
        throw reachedTruth;
      },
      revoke() {},
    },
    buildSha: "0".repeat(40),
    async runProduction() {
      throw new Error("Seeding must not invoke Eve");
    },
  });
  await assert.rejects(adapter.prepare(scenario), reachedTruth);
  assert.equal(statements[0], "base");
  const historical = statements.findIndex((sql) =>
    sql.includes("Completed core follow-up")
  );
  const owningFamily = statements.findIndex((sql) =>
    sql.includes("first_name='Alex'")
  );
  assert.ok(
    historical > 0,
    "historical distractors apply beyond the family's binding IDs"
  );
  assert.ok(
    owningFamily > historical,
    "people-history seeding retains its original order"
  );
});
