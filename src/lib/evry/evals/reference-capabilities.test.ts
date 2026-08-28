import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import generatedInventory from "@/lib/evry/capabilities/inventory.generated.json";
import { EVRY_SUPPORTED_CAPABILITIES } from "@/lib/evry/policy/inventory";
import {
  ADD_GUESTS_IDENTITY,
  CREATE_MEETING_IDENTITY,
  createFixtureRecipeRegistry,
  RECIPE_IDENTITY,
  SEND_MESSAGE_IDENTITY,
} from "@/lib/evry/recipes/fixtures.test-helper";

import { EVRY_CAPABILITY_EVAL_LAYERS } from "./contracts";

const CAPABILITIES = [
  CREATE_MEETING_IDENTITY,
  ADD_GUESTS_IDENTITY,
  SEND_MESSAGE_IDENTITY,
] as const;
const registry = createFixtureRecipeRegistry();
const recipe = registry.registrationFor(RECIPE_IDENTITY);
assert.ok(recipe);
const golden = JSON.parse(
  readFileSync(
    new URL("../recipes/meeting-invitation.golden.json", import.meta.url),
    "utf8"
  )
) as {
  confirmation: { title: string; actionLabel: string };
  steps: Array<{
    capabilityIdentity: string;
    arguments: Record<string, unknown>;
  }>;
};

for (const identity of CAPABILITIES) {
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    test(`${identity}:${layer}`, () => {
      const inventoryEntry = generatedInventory.entries.find(
        (entry) => entry.identity === identity
      );
      const definitionStep = recipe.steps.find(
        (step) => step.capabilityIdentity === identity
      );
      const goldenStep = golden.steps.find(
        (step) => step.capabilityIdentity === identity
      );
      const execution = registry.executionRegistry.registrationFor(identity);
      const plan =
        registry.executionRegistry.planRegistry.registrationFor(identity);

      assert.equal(inventoryEntry?.classification.state, "supported");
      assert.ok(definitionStep);
      assert.ok(goldenStep);
      assert.ok(execution);
      assert.ok(plan);

      switch (layer) {
        case "policy":
          assert.ok(
            inventoryEntry.parityCapability &&
              EVRY_SUPPORTED_CAPABILITIES.includes(
                inventoryEntry.parityCapability
              )
          );
          break;
        case "selection":
          assert.ok(recipe.eligibleCapabilities.includes(identity));
          break;
        case "arguments":
          assert.equal(
            plan.argumentsSchema.safeParse(goldenStep.arguments).success,
            true
          );
          assert.equal(
            plan.argumentsSchema.safeParse({
              ...goldenStep.arguments,
              unauthorizedExtra: true,
            }).success,
            false
          );
          break;
        case "tenancy":
          assert.equal(
            Object.keys(goldenStep.arguments).some((key) =>
              /actor|church|plant|user/i.test(key)
            ),
            false,
            "authority stays outside model/provider arguments"
          );
          break;
        case "permission":
          assert.equal(execution.planCapability.identity, identity);
          break;
        case "confirmation":
          assert.ok(golden.confirmation.title);
          assert.ok(golden.confirmation.actionLabel);
          assert.ok(definitionStep.disclosure.consequences.length > 0);
          break;
        case "execution":
          assert.equal(
            registry.executionRegistry.registrationFor(identity),
            execution
          );
          break;
        case "idempotency":
          assert.ok(
            ["same_plan", "never"].includes(definitionStep.failurePolicy.retry)
          );
          break;
        case "errors":
          assert.ok(definitionStep.failurePolicy.retry);
          break;
        case "ui_artifact": {
          const disclosed = definitionStep.disclosure.items.flatMap((item) =>
            item.value.kind === "argument" ? [item.value.argumentKey] : []
          );
          assert.deepEqual(
            disclosed.toSorted(),
            Object.keys(definitionStep.arguments).toSorted()
          );
          break;
        }
      }
    });
  }
}
