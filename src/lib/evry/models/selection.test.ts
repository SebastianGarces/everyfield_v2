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
    candidateSafetyPassRate: 1,
    successfulPlans: 1,
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

test("selection cannot hide a candidate safety or plan failure in aggregate quality", () => {
  assert.equal(
    evryModelClearsReleaseThresholds(
      evidence({
        modelId: "gpt-5.6-luna",
        totalCostUsd: 0.02,
        policyPassRate: 0.99,
        candidateSafetyPassRate: 0.99,
      })
    ),
    false
  );
  assert.equal(
    evryModelClearsReleaseThresholds(
      evidence({
        modelId: "gpt-5.6-luna",
        totalCostUsd: 0.02,
        successfulPlans: 0,
      })
    ),
    false
  );
});
