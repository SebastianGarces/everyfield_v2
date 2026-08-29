import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCommunicationCapabilityInventoryCurrent,
  generateCommunicationCapabilityInventory,
} from "../../../../../ops/evry/communication-inventory";
import { EVRY_CAPABILITY_EVAL_LAYERS } from "@/lib/evry/evals/contracts";
import { EVRY_CAPABILITY_EVAL_FIXTURES } from "@/lib/evry/evals/registry";

const repoRoot = process.cwd();

test("generated Communication inventory is current and fully classified", async () => {
  const inventory = generateCommunicationCapabilityInventory(repoRoot);
  await assertCommunicationCapabilityInventoryCurrent(repoRoot, inventory);

  assert.equal(inventory.summary.actions, 9);
  assert.equal(inventory.summary.routes, 6);
  assert.equal(inventory.summary.externalExclusions, 2);
  assert.equal(inventory.summary.productGaps, 0);
  assert.equal(inventory.summary.unclassified, 0);
  assert.ok(inventory.summary.rscReads > 0);
  assert.ok(inventory.summary.readCapabilities > 0);
  assert.ok(inventory.summary.effectCapabilities > 0);

  for (const capability of inventory.capabilities) {
    const fixture = EVRY_CAPABILITY_EVAL_FIXTURES.find(
      ({ capabilityIdentity }) => capabilityIdentity === capability.identity
    );
    assert.ok(fixture, `missing eval fixture for ${capability.identity}`);
    for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
      const live =
        capability.operationKind === "effect" &&
        ["execution", "idempotency", "errors"].includes(layer);
      assert.deepEqual(fixture.cases[layer], [
        {
          id: `${capability.identity}:${layer}`,
          proofId: live
            ? "communication-effect-live"
            : "communication-capability-contract",
          testName: live
            ? `${capability.identity}:${layer}:live`
            : `${capability.identity}:${layer}`,
        },
      ]);
    }
    assert.equal(
      capability.confirmation,
      capability.operationKind === "effect" ? "required" : "not_required"
    );
  }
});

test("Communication send and resend remain exact named effects", () => {
  const inventory = generateCommunicationCapabilityInventory(repoRoot);
  const effects = inventory.capabilities.filter(
    ({ operationKind }) => operationKind === "effect"
  );
  const identities = effects.map(({ identity }) => identity);

  assert.ok(identities.includes("communication.messages.send"));
  assert.ok(identities.includes("communication.resends.send-to-non-openers"));
  assert.equal(
    identities.some((identity) => identity.includes("generic")),
    false
  );
});
