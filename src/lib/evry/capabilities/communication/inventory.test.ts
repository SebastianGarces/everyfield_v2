import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCommunicationCapabilityInventoryCurrent,
  communicationExternalSurfaces,
  discoverCommunicationRouteHandlers,
  discoverCommunicationRscReads,
  generateCommunicationCapabilityInventory,
} from "../../../../../ops/evry/communication-inventory";
import { EVRY_CAPABILITY_EVAL_LAYERS } from "@/lib/evry/evals/contracts";
import { EVRY_CAPABILITY_EVAL_FIXTURES } from "@/lib/evry/evals/registry";

const repoRoot = process.cwd();

function writeFixture(root: string, relative: string, source: string) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source, "utf8");
}

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

test("RSC discovery follows real awaited symbols through aliases, namespaces, re-exports, and dynamic imports", () => {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "communication-inventory-rsc-")
  );
  try {
    writeFixture(
      fixtureRoot,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      })
    );
    writeFixture(
      fixtureRoot,
      "src/lib/communication/queries.ts",
      [
        "export async function countCommunications() { return 0; }",
        "export async function getCommunication() { return null; }",
        "export async function getTemplates() { return []; }",
        "export async function getMeetingCommunications() { return []; }",
        "export async function getPersonCommunications() { return []; }",
      ].join("\n")
    );
    writeFixture(
      fixtureRoot,
      "src/lib/communication/barrel.ts",
      'export { getMeetingCommunications as meetingHistory } from "./queries";'
    );
    writeFixture(
      fixtureRoot,
      "src/app/(dashboard)/proof/page.ts",
      [
        'import { countCommunications, getCommunication as message } from "@/lib/communication/queries";',
        'import * as communication from "@/lib/communication/queries";',
        'import { meetingHistory } from "@/lib/communication/barrel";',
        "export async function proof() {",
        "  await message();",
        "  await communication.getTemplates();",
        "  await meetingHistory();",
        '  const dynamic = await import("@/lib/communication/queries");',
        "  await dynamic.getPersonCommunications();",
        "}",
      ].join("\n")
    );

    const reads = discoverCommunicationRscReads(fixtureRoot);
    assert.deepEqual(
      reads.map(({ modulePath, exportName }) => `${modulePath}#${exportName}`),
      [
        "@/lib/communication/queries#getCommunication",
        "@/lib/communication/queries#getMeetingCommunications",
        "@/lib/communication/queries#getPersonCommunications",
        "@/lib/communication/queries#getTemplates",
      ]
    );
    assert.equal(
      reads.some(({ exportName }) => exportName === "countCommunications"),
      false,
      "an unused import must not become an inventory surface"
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("external route discovery names exact handlers and fails closed on a new method", () => {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "communication-inventory-routes-")
  );
  try {
    writeFixture(
      fixtureRoot,
      "src/app/api/rsvp/[token]/route.ts",
      [
        'import { resolveConfirmation } from "@/lib/communication/confirmation";',
        "export async function POST() { return resolveConfirmation; }",
      ].join("\n")
    );
    writeFixture(
      fixtureRoot,
      "src/app/api/webhooks/resend/route.ts",
      [
        'import { communicationRecipients } from "@/db/schema/communication";',
        "export async function POST() { return communicationRecipients; }",
      ].join("\n")
    );
    writeFixture(
      fixtureRoot,
      "src/app/api/unrelated/route.ts",
      'export async function GET() { return new Response("ok"); }'
    );

    assert.deepEqual(
      discoverCommunicationRouteHandlers(fixtureRoot).map(
        ({ identity }) => identity
      ),
      ["handler:POST:/api/rsvp/[token]", "handler:POST:/api/webhooks/resend"]
    );
    assert.equal(communicationExternalSurfaces(fixtureRoot).length, 2);

    writeFixture(
      fixtureRoot,
      "src/app/api/rsvp/[token]/route.ts",
      [
        'import { resolveConfirmation } from "@/lib/communication/confirmation";',
        "export async function GET() { return resolveConfirmation; }",
        "export async function POST() { return resolveConfirmation; }",
      ].join("\n")
    );
    assert.throws(
      () => communicationExternalSurfaces(fixtureRoot),
      /no closed external contract for handler:GET:\/api\/rsvp\/\[token\]/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
