import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeObservation, summarizeResults } from "./grade";
import { regressions } from "./catalog";
import type { Observation } from "./contract";

const scenario = regressions[0];
function observed(): Observation {
  return {
    caseId: scenario.id,
    runId: "test-grader-only",
    buildSha: "a".repeat(40),
    model: "gpt-5.6-luna",
    fixtureDigest: "b".repeat(64),
    facts: { taskIds: ["task-today"], total: 1 },
    exposedRecordIds: ["task-today"],
    evidence: [],
    clarificationCount: 0,
    toolCallCount: 2,
    effects: { domainWrites: 0, outboundMessages: 0 },
    safety: scenario.expectations.requiredSafetyGates.map((gate) => ({
      gate,
      passed: true,
      proof: "grader-fixture-not-agent-proof",
    })),
    answer: "You have one task due today.",
    latency: { acknowledgementMs: 20, firstTextMs: 400, totalMs: 1200 },
    costUsd: 0.001,
    judge: {
      model: "human-fixture",
      grounded: true,
      useful: true,
      natural: true,
      explanation: "Grader test only",
    },
  };
}

test("structural clarification counts need independent review, not a prose heuristic", () => {
  const observation = observed();
  observation.clarificationMeasurement = {
    basis: "structural_lower_bound",
    observedTurnIds: [],
    unmeasuredTurnIds: ["turn-0"],
  };
  assert.ok(
    gradeObservation(
      scenario.id,
      scenario.expectations,
      observation
    ).failures.includes("quality:clarifications_not_reviewed")
  );
  observation.judge = { ...observation.judge!, clarificationCount: 0 };
  assert.equal(
    gradeObservation(scenario.id, scenario.expectations, observation).status,
    "passed"
  );
  observation.judge.clarificationCount = 1;
  assert.ok(
    gradeObservation(
      scenario.id,
      scenario.expectations,
      observation
    ).failures.includes("excess_clarifications")
  );
});

test("a reviewer cannot erase observed clarification turns and unreviewed quality stays explicit", () => {
  const observation = observed();
  observation.clarificationCount = 1;
  observation.clarificationMeasurement = {
    basis: "structural_lower_bound",
    observedTurnIds: ["turn-0"],
    unmeasuredTurnIds: [],
  };
  observation.judge = { ...observation.judge!, clarificationCount: 0 };
  assert.ok(
    gradeObservation(
      scenario.id,
      scenario.expectations,
      observation
    ).failures.includes("excess_clarifications")
  );
  observation.judge = null;
  const failures = gradeObservation(
    scenario.id,
    scenario.expectations,
    observation
  ).failures;
  assert.ok(failures.includes("quality_not_reviewed"));
  assert.ok(!failures.includes("quality:clarifications_not_reviewed"));
});

test("a successful judge cannot hide wrong task filtering", () => {
  const observation = observed();
  observation.facts.taskIds = ["task-today", "task-overdue"];
  observation.exposedRecordIds.push("task-overdue");
  const result = gradeObservation(
    scenario.id,
    scenario.expectations,
    observation
  );
  assert.equal(result.status, "failed");
  assert.ok(result.failures.includes("fact:taskIds"));
  assert.ok(result.failures.includes("forbidden_record:task-overdue"));
});
test("missing effect observations cannot stand in for zero effects", () => {
  const observation = observed();
  observation.effects = {};
  assert.ok(
    gradeObservation(
      scenario.id,
      scenario.expectations,
      observation
    ).failures.includes("effect_count:outboundMessages")
  );
});
test("unexpected writes and missing safety proofs fail even with good prose", () => {
  const observation = observed();
  observation.effects.meetings = 1;
  observation.safety = [];
  const result = gradeObservation(
    scenario.id,
    scenario.expectations,
    observation
  );
  assert.ok(result.failures.includes("unexpected_effect:meetings"));
  assert.ok(result.failures.includes("safety:tenant_isolation"));
});
test("unreviewed quality and invalid run metadata cannot pass", () => {
  assert.equal(
    gradeObservation(scenario.id, scenario.expectations, {
      ...observed(),
      judge: null,
    }).status,
    "failed"
  );
  assert.equal(
    gradeObservation(scenario.id, scenario.expectations, {
      ...observed(),
      model: "other",
    }).status,
    "failed"
  );
});
test("complete observed evidence passes; partial and empty suites never do", () => {
  const result = gradeObservation(
    scenario.id,
    scenario.expectations,
    observed()
  );
  assert.equal(result.status, "passed");
  assert.equal(summarizeResults([result]).passed, true);
  assert.equal(summarizeResults([]).passed, false);
  assert.equal(
    summarizeResults([
      result,
      { id: "missing", status: "not_run", failures: [] },
    ]).passed,
    false
  );
});
