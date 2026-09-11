import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertLaunchCapabilityInventoryCurrent,
  generateLaunchCapabilityInventory,
} from "../../../../../ops/evry/launch-inventory";

test("generated Launch inventory classifies every owning surface", async () => {
  const inventory = generateLaunchCapabilityInventory(process.cwd());
  await assertLaunchCapabilityInventoryCurrent(process.cwd());
  assert.deepEqual(inventory.summary, {
    actions: 6,
    adapterOperations: 1,
    routes: 1,
    rscOperations: 22,
    exclusions: 19,
    readCapabilities: 3,
    effectCapabilities: 6,
    unclassified: 0,
  });
  assert.equal(
    new Set(inventory.entries.map(({ identity }) => identity)).size,
    inventory.entries.length
  );
  assert.ok(
    inventory.capabilities.every(
      ({ fixtureClasses }) => fixtureClasses.length === 6
    )
  );
  const ownerRepair = inventory.entries.find(
    ({ exportName }) => exportName === "convergeLaunchReadiness"
  );
  assert.equal(ownerRepair?.classification.state, "excluded");
  assert.equal(ownerRepair?.operationKind, "excluded");
  const readinessAdapter = inventory.entries.find(
    ({ identity }) =>
      identity === "adapter:src/lib/launch/milestones.ts → getLaunchReadiness"
  );
  assert.equal(readinessAdapter?.capabilityIdentity, "launch.read.readiness");
  assert.equal(readinessAdapter?.operationKind, "read");
});

test("Launch inventory fails closed on a new called RSC operation", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "launch-inventory-"));
  try {
    const page = "src/app/(dashboard)/launch/page.tsx";
    mkdirSync(path.dirname(path.join(root, page)), { recursive: true });
    writeFileSync(
      path.join(root, page),
      'import { mystery } from "@/lib/launch/mystery"; export default async function Page(){ await mystery(); return null; }'
    );
    assert.throws(
      () => generateLaunchCapabilityInventory(root),
      /Unclassified Launch RSC operation: mystery/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const probe of [
  {
    name: "aliased synchronous import",
    source:
      'import { mystery as renamed } from "@/lib/launch/mystery"; export default function Page(){ renamed(); return null; }',
    expected: /Unclassified Launch RSC operation: mystery/,
  },
  {
    name: "namespace import",
    source:
      'import * as launchReads from "@/lib/launch/mystery"; export default async function Page(){ const pending = launchReads.mystery(); await pending; return null; }',
    expected: /Unclassified Launch RSC operation: mystery/,
  },
  {
    name: "default import",
    source:
      'import mystery from "@/lib/launch/mystery"; export default function Page(){ mystery(); return null; }',
    expected: /Unclassified Launch RSC operation: default/,
  },
  {
    name: "inline server action",
    source:
      'export default function Page(){ async function mystery(){ "use server"; } void mystery; return null; }',
    expected: /Unclassified Launch inline server action: mystery/,
  },
  {
    name: "dynamic import",
    source:
      'export default async function Page(){ await import("@/lib/launch/mystery"); return null; }',
    expected: /Unclassified Launch dynamic RSC import/,
  },
  {
    name: "rendered imported component",
    source:
      'import { Mystery } from "@/lib/launch/mystery"; export default function Page(){ return <Mystery />; }',
    expected: /Unclassified Launch RSC operation: Mystery/,
  },
  {
    name: "rendered namespace component",
    source:
      'import * as mystery from "@/lib/launch/mystery"; export default function Page(){ return <mystery.Panel />; }',
    expected: /Unclassified Launch RSC operation: Panel/,
  },
] as const) {
  test(`Launch inventory fails closed on a ${probe.name}`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "launch-inventory-"));
    try {
      const page = "src/app/(dashboard)/launch/page.tsx";
      mkdirSync(path.dirname(path.join(root, page)), { recursive: true });
      writeFileSync(path.join(root, page), probe.source);
      assert.throws(
        () => generateLaunchCapabilityInventory(root),
        probe.expected
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("Launch inventory refuses a second page source for the same route", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "launch-inventory-"));
  try {
    const primary = "src/app/(dashboard)/launch/page.tsx";
    const duplicate = "src/app/(other)/launch/page.tsx";
    for (const source of [primary, duplicate]) {
      mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
      writeFileSync(
        path.join(root, source),
        "export default function Page(){ return null; }"
      );
    }
    assert.throws(
      () => generateLaunchCapabilityInventory(root),
      /Launch route has unexpected sources/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
