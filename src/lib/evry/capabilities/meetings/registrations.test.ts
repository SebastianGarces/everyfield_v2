import assert from "node:assert/strict";
import { test } from "node:test";

import inventory from "@/lib/evry/capabilities/inventory.generated.json";
import generated from "@/lib/evry/capabilities/meetings/inventory.generated.json";
import { generateMeetingsCapabilityInventory } from "../../../../../ops/evry/meetings-inventory";
import {
  discoverMeetingsPageReadOperations,
  MEETINGS_DISCOVERED_READ_EXCLUSIONS,
} from "../../../../../ops/evry/meetings-source-discovery";

import {
  MEETINGS_ACTION_CONTRACTS,
  MEETINGS_CAPABILITY_SURFACES,
  MEETINGS_EXCLUDED_OPERATIONS,
} from "./catalog";
import {
  MEETINGS_EFFECT_OPERATION_IDENTITIES,
  MEETINGS_OPERATION_REGISTRATIONS,
  MEETINGS_READ_OPERATION_IDENTITIES,
} from "./registrations";

test("generated Meetings inventory is current and has no unclassified surface", () => {
  const actual = generateMeetingsCapabilityInventory();
  assert.deepEqual(actual, generated);
  assert.deepEqual(actual.summary, {
    actions: 25,
    routes: 10,
    readOperations: 31,
    exclusions: 17,
    readCapabilities: 4,
    effectCapabilities: 25,
    unclassified: 0,
  });
});

test("Meetings registrations bijectively cover generated actions and routes", () => {
  assert.equal(MEETINGS_CAPABILITY_SURFACES.length, 35);
  assert.equal(MEETINGS_EFFECT_OPERATION_IDENTITIES.length, 25);
  assert.equal(MEETINGS_READ_OPERATION_IDENTITIES.length, 4);
  assert.equal(Object.keys(MEETINGS_ACTION_CONTRACTS).length, 25);

  const registeredSurfaces = MEETINGS_OPERATION_REGISTRATIONS.flatMap(
    ({ surfaceIdentities }) => surfaceIdentities
  );
  assert.equal(
    new Set(registeredSurfaces).size,
    registeredSurfaces.length,
    "one authoritative surface must belong to one semantic operation"
  );

  const generatedActions = inventory.entries
    .filter(
      (entry) =>
        entry.kind === "action" &&
        entry.source === "src/app/(dashboard)/meetings/actions.ts"
    )
    .map(({ identity }) => identity)
    .toSorted();
  assert.deepEqual(
    registeredSurfaces
      .filter((identity) => identity.startsWith("action:"))
      .toSorted(),
    generatedActions
  );

  const generatedRoutes = inventory.entries
    .filter(
      (entry) => entry.kind === "route" && entry.parityCapability === "meetings"
    )
    .map(({ identity }) => identity)
    .toSorted();
  assert.deepEqual(
    registeredSurfaces
      .filter((identity) => identity.startsWith("route:"))
      .toSorted(),
    generatedRoutes
  );
});

test("every nested Meetings page data read belongs to exactly one read operation", () => {
  const registered = MEETINGS_OPERATION_REGISTRATIONS.filter(
    ({ operationKind }) => operationKind === "read"
  )
    .flatMap(({ surfaceIdentities }) => surfaceIdentities)
    .filter((identity) => identity.startsWith("read-operation:"))
    .toSorted();

  const excluded = MEETINGS_DISCOVERED_READ_EXCLUSIONS.map(
    ({ identity }) => identity
  );
  assert.equal(
    new Set([...registered, ...excluded]).size,
    registered.length + excluded.length
  );
  assert.deepEqual(
    [...registered, ...excluded].toSorted(),
    discoverMeetingsPageReadOperations()
  );
});

test("operation kind is independent from application permission", () => {
  for (const registration of MEETINGS_OPERATION_REGISTRATIONS) {
    assert.equal(registration.parityCapability, "meetings");
    if (registration.operationKind === "read") {
      assert.equal(registration.actionLabel, null);
      assert.equal(
        registration.applicationCapability,
        registration.identity === "meetings.read.schedule"
          ? "meetings.write"
          : "read"
      );
      continue;
    }
    assert.equal(registration.applicationCapability, "meetings.write");
    assert.ok(registration.actionLabel);
    assert.ok(registration.argumentKeys.length > 0);
  }
});

test("non-surface service operations remain explicit exclusions", () => {
  assert.deepEqual(
    MEETINGS_EXCLUDED_OPERATIONS.map(({ identity }) => identity),
    [
      "read-import:src/lib/meetings/locations.ts → getLocation",
      "effect-import:src/lib/meetings/locations.ts → deactivateLocation",
    ]
  );
});
