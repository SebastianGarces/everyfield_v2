import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCommunicationCapabilityInventoryCurrent,
  generateCommunicationCapabilityInventory,
} from "../../../../../ops/evry/communication-inventory";

const repoRoot = process.cwd();

test("generated Communication inventory is current and fully classified", async () => {
  const inventory = generateCommunicationCapabilityInventory(repoRoot);
  await assertCommunicationCapabilityInventoryCurrent(repoRoot, inventory);

  assert.equal(inventory.summary.actions, 9);
  assert.equal(inventory.summary.routes, 6);
  assert.equal(inventory.summary.externalExclusions, 2);
  assert.equal(inventory.summary.productGaps, 1);
  assert.equal(inventory.summary.unclassified, 0);
  assert.ok(inventory.summary.rscReads > 0);
  assert.ok(inventory.summary.readCapabilities > 0);
  assert.ok(inventory.summary.effectCapabilities > 0);

  for (const capability of inventory.capabilities) {
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
