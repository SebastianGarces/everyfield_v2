import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTaskCapabilityInventoryCurrent,
  generateTaskCapabilityInventory,
} from "../../../../../ops/evry/tasks-inventory";
import {
  TASK_ACTION_CONTRACTS,
  TASK_AUTHORITATIVE_SURFACES,
  TASK_CAPABILITIES,
} from "./catalog";

test("generated Task inventory is current and has zero unclassified surfaces", async () => {
  const inventory = generateTaskCapabilityInventory(process.cwd());
  await assertTaskCapabilityInventoryCurrent(process.cwd(), inventory);
  assert.deepEqual(inventory.summary, {
    actions: 18,
    routes: 4,
    rscReads: 25,
    exclusions: 9,
    readCapabilities: 7,
    effectCapabilities: 17,
    unclassified: 0,
  });
  assert.equal(TASK_AUTHORITATIVE_SURFACES.length, 38);
  assert.equal(TASK_CAPABILITIES.length, 24);
  assert.equal(Object.keys(TASK_ACTION_CONTRACTS).length, 18);
});

test("Task reads never request confirmation and every effect names its material action", () => {
  const reads = TASK_CAPABILITIES.filter(
    ({ operationKind }) => operationKind === "read"
  );
  const effects = TASK_CAPABILITIES.filter(
    ({ operationKind }) => operationKind === "effect"
  );
  assert.equal(reads.length, 7);
  assert.equal(effects.length, 17);
  assert.ok(reads.every(({ actionLabel }) => actionLabel === null));
  assert.ok(effects.every(({ actionLabel }) => Boolean(actionLabel)));
});

test("write-only Task planning reads keep the product permission without becoming effects", () => {
  const permission = Object.fromEntries(
    TASK_CAPABILITIES.filter(
      ({ operationKind }) => operationKind === "read"
    ).map(({ identity, applicationCapability }) => [
      identity,
      applicationCapability,
    ])
  );
  assert.deepEqual(permission, {
    "tasks.read.counts": "read",
    "tasks.read.detail": "read",
    "tasks.read.follow-up-ownership": "read",
    "tasks.read.list": "read",
    "tasks.read.phase-template-prompt": "phase.signal",
    "tasks.read.planning-options": "tasks.write",
    "tasks.read.templates": "tasks.write",
  });
});

test("phase-template dismissal preserves its phase authority", () => {
  assert.equal(
    TASK_CAPABILITIES.find(
      ({ identity }) => identity === "tasks.phase-template.dismiss"
    )?.applicationCapability,
    "phase.signal"
  );
});
