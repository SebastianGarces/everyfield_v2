import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  format as formatWithPrettier,
  resolveConfig as resolvePrettierConfig,
} from "prettier";

import {
  buildParityInventory,
  collectActionSurfaces,
  collectAuthoritativeSources,
  collectRouteSurfaces,
  generateParityInventory,
  generatedInventoryPath,
  loadParityCapabilities,
  serializeParityInventory,
} from "../../../../ops/evry/inventory";
import { CAPABILITY_BY_EXPORT } from "../../auth/capability-map";
import { UNSEATED_EXPORTS } from "../../auth/seat-rules";
import { defineEvryParityCapabilities } from "./contract";
import { SETTINGS_SECTIONS } from "../../settings/sections";

const REPO_ROOT = process.cwd();

test("the checked-in inventory is the deterministic output of two runs", async () => {
  const first = await generateParityInventory(REPO_ROOT);
  const second = await generateParityInventory(REPO_ROOT);
  const outputPath = generatedInventoryPath(REPO_ROOT);
  const serialized = await serializeParityInventory(first, REPO_ROOT);
  const prettierConfig = await resolvePrettierConfig(outputPath);

  assert.equal(serialized, await serializeParityInventory(second, REPO_ROOT));
  assert.equal(
    serialized,
    await formatWithPrettier(serialized, {
      ...prettierConfig,
      filepath: outputPath,
      parser: "json",
    }),
    "the generator must emit the repository formatter's JSON shape"
  );
  assert.equal(
    serialized,
    readFileSync(outputPath, "utf8"),
    "run `pnpm evry:inventory` after changing a route, action, or parity declaration"
  );
  assert.equal(first.summary.unclassified, 0);
  assert.equal(
    first.summary.routes > 50,
    true,
    "route walk is suspiciously small"
  );
  assert.equal(
    first.summary.actions > 150,
    true,
    "action registry is suspiciously small"
  );
});

test("the inventory keeps every ruled exclusion visible", async () => {
  const inventory = await generateParityInventory(REPO_ROOT);
  const reasons = new Set(
    inventory.entries.flatMap((entry) =>
      entry.classification.state === "excluded"
        ? [entry.classification.reason]
        : []
    )
  );

  assert.deepEqual([...reasons].toSorted(), [
    "authentication",
    "coaching",
    "oversight",
    "pre_tenancy_onboarding",
    "public_or_sessionless",
    "settings",
  ]);
});

test("the generated settings registry includes source keywords in stable order", async () => {
  const inventory = await generateParityInventory(REPO_ROOT);

  assert.deepEqual(
    inventory.registries.settingsSections,
    SETTINGS_SECTIONS.map(({ id, label, keywords }) => ({
      id,
      label,
      keywords: [...keywords].toSorted(),
    })).toSorted((a, b) => a.id.localeCompare(b.id))
  );
  assert.deepEqual(
    inventory.registries.settingsSections.find(({ id }) => id === "church")
      ?.keywords,
    [
      "address",
      "city",
      "clock",
      "consent",
      "country",
      "digest",
      "inactive",
      "inactivity",
      "location",
      "name",
      "network",
      "oversight",
      "privacy",
      "quiet",
      "region",
      "schedule",
      "sending church",
      "sharing",
      "state",
      "street",
      "time zone",
      "timezone",
      "weekday",
    ]
  );
});

test("parallel slots normalize interception matchers and retain every page source", (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "evry-inventory-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const pages = [
    "src/app/(dashboard)/people/[id]/page.tsx",
    "src/app/(dashboard)/@modal/(.)people/[id]/page.tsx",
    "src/app/(dashboard)/tasks/[id]/page.tsx",
    "src/app/(dashboard)/people/@modal/(..)tasks/[id]/page.tsx",
    "src/app/(dashboard)/wiki/[...slug]/page.tsx",
    "src/app/(dashboard)/people/@modal/(...)wiki/[...slug]/page.tsx",
  ];
  for (const page of pages) {
    const fixturePage = path.join(fixtureRoot, page);
    mkdirSync(path.dirname(fixturePage), { recursive: true });
    writeFileSync(fixturePage, "export default function Page() {}\n");
  }

  assert.deepEqual(collectRouteSurfaces(fixtureRoot), [
    {
      kind: "route",
      identity: "route:/people/[id]",
      path: "/people/[id]",
      sources: [pages[0], pages[1]].toSorted(),
    },
    {
      kind: "route",
      identity: "route:/tasks/[id]",
      path: "/tasks/[id]",
      sources: [pages[2], pages[3]].toSorted(),
    },
    {
      kind: "route",
      identity: "route:/wiki/[...slug]",
      path: "/wiki/[...slug]",
      sources: [pages[4], pages[5]].toSorted(),
    },
  ]);
});

test("an unclassified route inside a parallel slot is red until declared", async (t) => {
  const sources = collectAuthoritativeSources(REPO_ROOT);
  const capabilities = await loadParityCapabilities(REPO_ROOT);

  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "evry-inventory-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const fixturePage = path.join(
    fixtureRoot,
    "src/app/(dashboard)/@modal/(.)evry-fixture/page.tsx"
  );
  mkdirSync(path.dirname(fixturePage), { recursive: true });
  writeFileSync(fixturePage, "export default function Page() {}\n");
  const [routeFixture] = collectRouteSurfaces(fixtureRoot);
  assert.deepEqual(routeFixture, {
    kind: "route",
    identity: "route:/evry-fixture",
    path: "/evry-fixture",
    sources: ["src/app/(dashboard)/@modal/(.)evry-fixture/page.tsx"],
  });

  const mutatedSources = {
    ...sources,
    routes: [...sources.routes, routeFixture],
  };

  assert.throws(
    () => buildParityInventory(mutatedSources, capabilities),
    /unclassified route:\/evry-fixture/,
    "the slot page must make the coverage guard red"
  );

  const fixtureDeclaration = defineEvryParityCapabilities({
    id: "fixture-route-capability",
    classification: { state: "supported" },
    selectors: [{ kind: "route", match: "exact", path: "/evry-fixture" }],
  });
  const green = buildParityInventory(mutatedSources, [
    ...capabilities,
    ...fixtureDeclaration,
  ]);

  assert.deepEqual(
    green.entries
      .filter(
        ({ parityCapability }) =>
          parityCapability === "fixture-route-capability"
      )
      .map(({ identity }) => identity),
    [routeFixture.identity]
  );
  assert.equal(green.summary.unclassified, 0);
});

test("an unclassified guarded registry entry is red until declared", async () => {
  const sources = collectAuthoritativeSources(REPO_ROOT);
  const capabilities = await loadParityCapabilities(REPO_ROOT);
  const actionRegistryIdentity =
    "src/app/(dashboard)/evry-fixture/actions.ts → fixtureAction";
  const collectedActions = collectActionSurfaces({
    guarded: {
      ...CAPABILITY_BY_EXPORT,
      [actionRegistryIdentity]: "read",
    },
    exempt: UNSEATED_EXPORTS,
  });
  const actionFixture = collectedActions.find(
    ({ identity }) => identity === `action:${actionRegistryIdentity}`
  );
  assert.deepEqual(actionFixture, {
    kind: "action",
    identity: `action:${actionRegistryIdentity}`,
    source: "src/app/(dashboard)/evry-fixture/actions.ts",
    exportName: "fixtureAction",
    applicationCapability: "read",
    exemption: null,
  });
  const mutatedSources = { ...sources, actions: collectedActions };

  assert.throws(
    () => buildParityInventory(mutatedSources, capabilities),
    /unclassified action:.*fixtureAction/,
    "the registry entry must make the coverage guard red"
  );

  const fixtureDeclaration = defineEvryParityCapabilities({
    id: "fixture-action-capability",
    classification: { state: "supported" },
    selectors: [
      {
        kind: "action-identity",
        identity: `action:${actionRegistryIdentity}`,
      },
    ],
  });
  const green = buildParityInventory(mutatedSources, [
    ...capabilities,
    ...fixtureDeclaration,
  ]);

  assert.equal(
    green.entries.find(
      ({ identity }) => identity === `action:${actionRegistryIdentity}`
    )?.parityCapability,
    "fixture-action-capability"
  );
  assert.equal(green.summary.unclassified, 0);
});

test("module contributions reject a duplicate capability identity", async () => {
  const sources = collectAuthoritativeSources(REPO_ROOT);
  const capabilities = await loadParityCapabilities(REPO_ROOT);

  assert.throws(
    () =>
      buildParityInventory(sources, [...capabilities, { ...capabilities[0] }]),
    /duplicate Evry capability identity/
  );
});
