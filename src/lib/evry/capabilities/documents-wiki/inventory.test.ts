import assert from "node:assert/strict";
import { test } from "node:test";

import { generateDocumentsWikiInventory } from "../../../../../ops/evry/documents-wiki-inventory";
import generated from "./inventory.generated.json";

test("generated Documents/wiki inventory is current and a closed bijection", () => {
  const actual = generateDocumentsWikiInventory(process.cwd());
  assert.deepEqual(actual, generated);
  assert.deepEqual(actual.summary, {
    actions: 6,
    routes: 5,
    routeHandlers: 3,
    rscReads: 18,
    delegatedPeopleFileSurfaces: 4,
    excludedExternalWebhooks: 2,
    readCapabilities: 7,
    effectCapabilities: 4,
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

test("People-owned file surfaces are delegated exactly and external webhooks stay excluded", () => {
  const delegated = generated.entries.filter(
    ({ classification }) => classification.state === "delegated"
  );
  assert.ok(
    generated.entries
      .filter(({ classification }) => classification.state === "delegated")
      .every(({ domain }) => domain === "people_files")
  );
  assert.deepEqual(
    delegated.map(
      ({
        identity,
        capabilityIdentity,
        operationKind,
        applicationCapability,
        confirmation,
      }) => ({
        identity,
        capabilityIdentity,
        operationKind,
        applicationCapability,
        confirmation,
      })
    ),
    [
      {
        identity:
          "action:src/app/(dashboard)/people/import-export-actions.ts → downloadCsvTemplateAction",
        capabilityIdentity: "people.crm.imports.download-csv-template",
        operationKind: "read",
        applicationCapability: "read",
        confirmation: "not_required",
      },
      {
        identity:
          "action:src/app/(dashboard)/people/import-export-actions.ts → executeBulkImportAction",
        capabilityIdentity: "people.crm.imports.execute-bulk-import",
        operationKind: "effect",
        applicationCapability: "people.write",
        confirmation: "required",
      },
      {
        identity:
          "action:src/app/(dashboard)/people/import-export-actions.ts → exportPeopleAction",
        capabilityIdentity: "people.crm.exports.export-people",
        operationKind: "read",
        applicationCapability: "read",
        confirmation: "not_required",
      },
      {
        identity:
          "action:src/app/(dashboard)/people/import-export-actions.ts → previewImportAction",
        capabilityIdentity: "people.crm.imports.preview-import",
        operationKind: "read",
        applicationCapability: "people.write",
        confirmation: "not_required",
      },
    ]
  );
  assert.deepEqual(
    generated.entries
      .filter(({ classification }) => classification.state === "excluded")
      .map(({ identity }) => identity)
      .toSorted(),
    ["handler:DELETE:/api/wiki/revalidate", "handler:POST:/api/wiki/revalidate"]
  );
});

test("every effect requires exact confirmation and every capability owns behavioral fixture classes", () => {
  for (const capability of generated.capabilities) {
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
