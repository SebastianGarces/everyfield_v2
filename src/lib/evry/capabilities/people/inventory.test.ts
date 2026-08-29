import assert from "node:assert/strict";
import { test } from "node:test";

import generated from "./inventory.generated.json";
import { generatePeopleCapabilityInventory } from "../../../../../ops/evry/people-inventory";

test("generated People inventory is current and classifies every concrete surface", () => {
  const actual = generatePeopleCapabilityInventory(process.cwd());
  assert.deepEqual(actual, generated);
  assert.deepEqual(actual.summary, {
    actions: 41,
    routes: 10,
    routeHandlers: 1,
    rscReads: 19,
    productGaps: 1,
    readCapabilities: 22,
    effectCapabilities: 30,
    unclassified: 0,
  });

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
});

test("read/effect kind is independent from the required product capability", () => {
  const preview = generated.entries.find(
    ({ identity }) =>
      identity ===
      "action:src/app/(dashboard)/people/import-export-actions.ts → previewImportAction"
  );
  assert.ok(preview);
  assert.equal(preview.operationKind, "read");
  assert.equal(preview.applicationCapability, "people.write");
  assert.equal(preview.confirmation, "not_required");

  for (const entry of generated.entries) {
    if (entry.operationKind === "read") {
      assert.equal(entry.confirmation, "not_required");
    }
    if (entry.operationKind === "effect") {
      assert.equal(entry.confirmation, "required");
      assert.notEqual(entry.mutationShape, null);
    }
  }
});

test("photo read is covered and route composition does not invent navigation tools", () => {
  const photo = generated.entries.find(
    ({ identity }) => identity === "handler:GET:/api/people/[personId]/photo"
  );
  assert.ok(photo);
  assert.equal(photo.capabilityIdentity, "people.crm.people.get-person-photo");
  assert.equal(photo.operationKind, "read");

  assert.equal(
    generated.capabilities.some(({ identity }) =>
      identity.startsWith("people.crm.routes.")
    ),
    false
  );
  const navigationOnly = generated.entries.find(
    ({ identity }) => identity === "route:/people/new"
  );
  assert.deepEqual(navigationOnly?.classification, {
    state: "excluded",
    reason: "ui_navigation_only",
  });
});

test("the absent duplicate merge is an owning-product gap, not fake parity", () => {
  const merge = generated.entries.find(
    ({ identity }) => identity === "product-gap:people.duplicates.merge"
  );
  assert.deepEqual(merge?.classification, {
    state: "excluded",
    reason: "owning_product_gap",
  });
});

test("every generated capability declares all required fixture classes", () => {
  const required = [
    "selection",
    "arguments",
    "confirmation",
    "execution",
    "idempotency",
    "failure",
  ];
  for (const capability of generated.capabilities) {
    assert.deepEqual(capability.fixtureClasses, required, capability.identity);
  }
});
