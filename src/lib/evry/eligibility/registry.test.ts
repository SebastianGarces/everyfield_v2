import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createEvryCapabilityRegistry,
  defineEvryCapabilityRegistration,
} from "./registry";

function registration(
  identity: string,
  surfaceIdentity: string,
  operationKind: "read" | "effect" = "read"
) {
  return defineEvryCapabilityRegistration({
    identity,
    surfaceIdentities: [surfaceIdentity],
    parityCapability: "fixture",
    operationKind,
    applicationCapability:
      operationKind === "read" ? "people.write" : "people.write",
  });
}

function surface(registrationValue: ReturnType<typeof registration>) {
  return {
    identity: registrationValue.surfaceIdentities[0],
    capabilityIdentity: registrationValue.identity,
    parityCapability: registrationValue.parityCapability,
    operationKind: registrationValue.operationKind,
    applicationCapability: registrationValue.applicationCapability,
  } as const;
}

function registryOf(registrations: readonly ReturnType<typeof registration>[]) {
  return createEvryCapabilityRegistry({
    registrations,
    authoritativeSurfaces: registrations.map(surface),
  });
}

test("operation kind is independent from the application seat capability", () => {
  const preview = registration(
    "people.crm.imports.preview",
    "action:previewImportAction",
    "read"
  );
  assert.equal(preview.operationKind, "read");
  assert.equal(preview.applicationCapability, "people.write");
});

test("registry maps semantic and concrete identities bijectively", () => {
  const preview = registration(
    "people.crm.imports.preview",
    "action:previewImportAction"
  );
  const registry = registryOf([preview]);
  assert.equal(registry.registrationFor(preview.identity), preview);
  assert.equal(
    registry.registrationForSurface("action:previewImportAction"),
    preview
  );
  assert.equal(registry.registrationFor("action:previewImportAction"), null);
});

test("registry refuses duplicate semantic identities and source claims", () => {
  assert.throws(
    () =>
      registryOf([
        registration("people.one", "action:one"),
        registration("people.one", "action:two"),
      ]),
    /Duplicate semantic Evry capability/
  );
  assert.throws(
    () =>
      registryOf([
        registration("people.one", "action:one"),
        registration("people.two", "action:one"),
      ]),
    /Duplicate authoritative Evry surface|classified by both/
  );
  assert.throws(
    () => registration("action:src/app/people", "action:one"),
    /Invalid semantic Evry capability identity/
  );
});

test("registry refuses unknown, conflicting, and uncovered source claims", () => {
  const one = registration("people.one", "action:one");
  assert.throws(
    () =>
      createEvryCapabilityRegistry({
        registrations: [one],
        authoritativeSurfaces: [
          { ...surface(one), identity: "action:different" },
        ],
      }),
    /claims unknown surface/
  );
  assert.throws(
    () =>
      createEvryCapabilityRegistry({
        registrations: [one],
        authoritativeSurfaces: [
          { ...surface(one), applicationCapability: "read" },
        ],
      }),
    /conflicts with authoritative surface/
  );
  assert.throws(
    () =>
      createEvryCapabilityRegistry({
        registrations: [],
        authoritativeSurfaces: [surface(one)],
      }),
    /Uncovered authoritative Evry surfaces/
  );
});
