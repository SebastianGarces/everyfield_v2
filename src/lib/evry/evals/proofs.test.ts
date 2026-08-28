import assert from "node:assert/strict";
import test from "node:test";

import type { EvryEvalProof } from "./contracts";
import {
  assertEvryEvalProofResults,
  evryEvalProofResult,
  evrySafetyGateResults,
  parseEvryNodeTestSummary,
} from "./proofs";

const PROOF: EvryEvalProof = {
  id: "fixture",
  testFile: "fixture.test.ts",
  lane: "deterministic",
  safetyGates: ["cross_tenant_access"],
};

function tap(input: { tests: number; passed: number; skipped?: number }) {
  const skipped = input.skipped ?? 0;
  const cases = Array.from({ length: input.tests }, (_, index) => {
    const isSkipped = index >= input.passed;
    return `ok ${index + 1} - fixture-${index + 1}${isSkipped ? " # SKIP fixture" : ""}`;
  }).join("\n");
  return `TAP version 13\n${cases}\n1..${input.tests}\n# tests ${input.tests}\n# suites 0\n# pass ${input.passed}\n# fail 0\n# cancelled 0\n# skipped ${skipped}\n# todo 0\n# duration_ms 12.5\n`;
}

test("proof results require real tests with zero skips", () => {
  const passing = evryEvalProofResult({
    proof: PROOF,
    exitCode: 0,
    output: tap({ tests: 2, passed: 2 }),
  });
  assert.equal(passing.passed, true);
  assert.deepEqual(parseEvryNodeTestSummary(tap({ tests: 2, passed: 2 })), {
    tests: 2,
    passed: 2,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    durationMs: 12.5,
  });
  assert.deepEqual(passing.cases, [
    { name: "fixture-1", passed: true, skipped: false },
    { name: "fixture-2", passed: true, skipped: false },
  ]);

  const skipped = evryEvalProofResult({
    proof: PROOF,
    exitCode: 0,
    output: tap({ tests: 2, passed: 1, skipped: 1 }),
  });
  assert.equal(skipped.passed, false);
  assert.throws(
    () => assertEvryEvalProofResults([PROOF], [skipped]),
    /failed or skipped/
  );
});

test("safety results are derived from executable proof outcomes", () => {
  const proofs = [
    PROOF,
    ...[
      "unconfirmed_effect",
      "prohibited_tool_access",
      "plan_approval_mismatch",
    ].map(
      (gate, index): EvryEvalProof => ({
        id: `fixture-${index}`,
        testFile: `fixture-${index}.test.ts`,
        lane: "deterministic",
        safetyGates: [gate as EvryEvalProof["safetyGates"][number]],
      })
    ),
  ];
  const results = proofs.map((proof) =>
    evryEvalProofResult({
      proof,
      exitCode: 0,
      output: tap({ tests: 1, passed: 1 }),
    })
  );
  assert.equal(
    evrySafetyGateResults({ proofs, results }).every(({ passed }) => passed),
    true
  );

  const failed = results.map((result, index) =>
    index === 0 ? { ...result, passed: false } : result
  );
  assert.equal(
    evrySafetyGateResults({ proofs, results: failed }).find(
      ({ gate }) => gate === "cross_tenant_access"
    )?.passed,
    false
  );
});
