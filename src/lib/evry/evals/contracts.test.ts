import assert from "node:assert/strict";
import test from "node:test";

import {
  assertEvryAbsoluteSafetyGates,
  defineEvryCapabilityEvalFixture,
  defineEvryRecipeEvalFixture,
  EVRY_ABSOLUTE_SAFETY_GATES,
  EVRY_CAPABILITY_EVAL_LAYERS,
  EVRY_RECIPE_EVAL_LAYERS,
  type EvryCapabilityEvalFixture,
  type EvryRecipeEvalFixture,
} from "./contracts";
import {
  assertEvryEvalRegistryComplete,
  EVRY_CAPABILITY_EVAL_FIXTURES,
  EVRY_RECIPE_EVAL_FIXTURES,
} from "./registry";

function casesFor<Layer extends string>(layers: readonly Layer[]) {
  return Object.fromEntries(
    layers.map((layer) => [layer, [{ id: `fixture:${layer}`, proof: "test" }]])
  );
}

test("every generated capability and recipe fixture is complete", () => {
  assert.doesNotThrow(assertEvryEvalRegistryComplete);
  assert.ok(EVRY_CAPABILITY_EVAL_FIXTURES.length > 0);
  assert.ok(EVRY_RECIPE_EVAL_FIXTURES.length > 0);
});

test("capability registry rejects each missing required layer", () => {
  for (const missing of EVRY_CAPABILITY_EVAL_LAYERS) {
    const cases = casesFor(EVRY_CAPABILITY_EVAL_LAYERS) as Record<
      string,
      readonly { id: string; proof: string }[]
    >;
    delete cases[missing];
    assert.throws(
      () =>
        defineEvryCapabilityEvalFixture({
          capabilityIdentity: "fixture:capability",
          cases,
        } as unknown as EvryCapabilityEvalFixture),
      new RegExp(`missing eval layer ${missing}`)
    );
  }
});

test("recipe registry rejects end-to-end or partial-failure gaps", () => {
  for (const missing of EVRY_RECIPE_EVAL_LAYERS) {
    const cases = casesFor(EVRY_RECIPE_EVAL_LAYERS) as Record<
      string,
      readonly { id: string; proof: string }[]
    >;
    delete cases[missing];
    assert.throws(
      () =>
        defineEvryRecipeEvalFixture({
          recipeIdentity: "fixture:recipe",
          cases,
        } as unknown as EvryRecipeEvalFixture),
      new RegExp(`missing eval layer ${missing}`)
    );
  }
});

test("every absolute safety class is a 100% gate", () => {
  const passing = EVRY_ABSOLUTE_SAFETY_GATES.map((gate) => ({
    gate,
    passed: true,
    proof: "fixture",
  }));
  assert.doesNotThrow(() => assertEvryAbsoluteSafetyGates(passing));

  for (const failedGate of EVRY_ABSOLUTE_SAFETY_GATES) {
    assert.throws(
      () =>
        assertEvryAbsoluteSafetyGates(
          passing.map((result) =>
            result.gate === failedGate ? { ...result, passed: false } : result
          )
        ),
      new RegExp(`failed: ${failedGate}`)
    );
  }
});
