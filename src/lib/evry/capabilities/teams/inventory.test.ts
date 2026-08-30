import assert from "node:assert/strict";
import { test } from "node:test";

import { generateTeamsCapabilityInventory } from "../../../../../ops/evry/teams-inventory";
import { EVRY_CAPABILITY_EVAL_LAYERS } from "@/lib/evry/evals/contracts";
import { EVRY_CAPABILITY_EVAL_FIXTURES } from "@/lib/evry/evals/registry";
import generated from "./inventory.generated.json";

test("generated Teams inventory is current, closed, and confirmation-complete", () => {
  const actual = generateTeamsCapabilityInventory(process.cwd());
  assert.deepEqual(actual, generated);
  assert.equal(actual.summary.actions, 20);
  assert.equal(actual.summary.routes, 7);
  assert.equal(actual.summary.rscOperations, 16);
  assert.equal(actual.summary.unclassified, 0);
  const supported = actual.entries.filter(
    ({ classification }) => classification.state === "supported"
  );
  const claimed = actual.capabilities.flatMap(
    ({ surfaceIdentities }) => surfaceIdentities
  );
  assert.deepEqual(
    claimed.toSorted(),
    supported.map(({ identity }) => identity).toSorted()
  );
  assert.equal(new Set(claimed).size, claimed.length);
  for (const capability of actual.capabilities) {
    assert.deepEqual(capability.fixtureClasses, [
      "selection",
      "arguments",
      "confirmation",
      "execution",
      "idempotency",
      "failure",
    ]);
    assert.equal(
      capability.confirmation,
      capability.operationKind === "read" ? "not_required" : "required"
    );
    const fixture = EVRY_CAPABILITY_EVAL_FIXTURES.find(
      ({ capabilityIdentity }) => capabilityIdentity === capability.identity
    );
    assert.ok(
      fixture,
      `missing executable eval fixture for ${capability.identity}`
    );
    for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
      assert.deepEqual(fixture.cases[layer], [
        {
          id: `${capability.identity}:${layer}`,
          proofId: "teams-capability-contract",
          testName: `${capability.identity}:${layer}`,
        },
      ]);
    }
  }
});

test("the first-view responsibility seed is an effect, never smuggled through a read", () => {
  const route = generated.entries.find(
    ({ identity }) => identity === "route:/teams/[teamId]/responsibilities"
  );
  assert.equal(route?.capabilityIdentity, "teams.responsibilities.initialize");
  assert.equal(route?.operationKind, "effect");
  assert.equal(route?.confirmation, "required");
});
