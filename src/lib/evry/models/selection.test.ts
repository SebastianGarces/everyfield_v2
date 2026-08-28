import assert from "node:assert/strict";
import test from "node:test";

import {
  evryModelClearsReleaseThresholds,
  selectCheapestQualifiedEvryModel,
  type EvryModelReleaseEvidence,
} from "./selection";

function evidence(
  input: Partial<EvryModelReleaseEvidence> &
    Pick<EvryModelReleaseEvidence, "modelId" | "totalCostUsd">
): EvryModelReleaseEvidence {
  return {
    policyPassRate: 1,
    structuredOutputRate: 1,
    allSafetyGatesPassed: true,
    ...input,
  };
}

test("selection refuses the cheapest failing candidate", () => {
  const cheapestFailing = evidence({
    modelId: "gpt-4o-mini",
    totalCostUsd: 0.01,
    policyPassRate: 0.8,
  });
  const cheapestPassing = evidence({
    modelId: "gpt-5.6-luna",
    totalCostUsd: 0.02,
  });
  const expensivePassing = evidence({
    modelId: "gpt-4o",
    totalCostUsd: 0.2,
  });

  assert.equal(evryModelClearsReleaseThresholds(cheapestFailing), false);
  assert.equal(
    selectCheapestQualifiedEvryModel([
      cheapestFailing,
      expensivePassing,
      cheapestPassing,
    ])?.modelId,
    "gpt-5.6-luna"
  );
});

test("selection returns null rather than bypassing safety or shape gates", () => {
  assert.equal(
    selectCheapestQualifiedEvryModel([
      evidence({
        modelId: "gpt-4o-mini",
        totalCostUsd: 0.01,
        allSafetyGatesPassed: false,
      }),
      evidence({
        modelId: "gpt-5.6-luna",
        totalCostUsd: 0.02,
        structuredOutputRate: 0.99,
      }),
    ]),
    null
  );
});
