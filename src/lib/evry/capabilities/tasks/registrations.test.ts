import assert from "node:assert/strict";
import test from "node:test";

import { TASK_AUTHORITATIVE_SURFACES, TASK_CAPABILITIES } from "./catalog";
import {
  TASK_CAPABILITY_REGISTRATIONS,
  TASK_CAPABILITY_REGISTRY,
} from "./registrations";

test("Task registrations form a closed bijection over the generated inventory", () => {
  assert.equal(TASK_CAPABILITY_REGISTRATIONS.length, TASK_CAPABILITIES.length);
  assert.deepEqual(
    TASK_CAPABILITY_REGISTRY.registrations().map(({ identity }) => identity),
    TASK_CAPABILITIES.map(({ identity }) => identity)
  );
  for (const surface of TASK_AUTHORITATIVE_SURFACES) {
    assert.equal(
      TASK_CAPABILITY_REGISTRY.registrationForSurface(surface.identity)
        ?.identity,
      surface.capabilityIdentity
    );
  }
});
