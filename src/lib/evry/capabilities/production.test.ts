import assert from "node:assert/strict";
import test from "node:test";

import communicationInventory from "./communication/inventory.generated.json";
import meetingsInventory from "./meetings/inventory.generated.json";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_PLAN_REGISTRY,
} from "./production";

test("production installs every Communication and Meetings effect together", () => {
  const effectIdentities = [
    ...communicationInventory.capabilities,
    ...meetingsInventory.capabilities,
  ]
    .filter(({ operationKind }) => operationKind === "effect")
    .map(({ identity }) => identity);

  assert.equal(new Set(effectIdentities).size, effectIdentities.length);
  for (const identity of effectIdentities) {
    assert.ok(
      PRODUCTION_EVRY_PLAN_REGISTRY.registrationFor(identity),
      `missing production plan registration for ${identity}`
    );
    assert.ok(
      PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(identity),
      `missing production execution registration for ${identity}`
    );
  }
});
