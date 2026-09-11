import assert from "node:assert/strict";
import { test } from "node:test";

import { TEAMS_CAPABILITIES } from "./catalog";
import { TEAMS_CAPABILITY_REGISTRY } from "./registrations";
import { TEAMS_EXECUTION_REGISTRY } from "./runtime";

test("the Teams registry installs every generated capability and source", () => {
  for (const capability of TEAMS_CAPABILITIES) {
    assert.equal(
      TEAMS_CAPABILITY_REGISTRY.registrationFor(capability.identity)?.identity,
      capability.identity
    );
    for (const surface of capability.surfaceIdentities) {
      assert.equal(
        TEAMS_CAPABILITY_REGISTRY.registrationForSurface(surface)?.identity,
        capability.identity
      );
    }
  }
});

test("every Teams effect registers pre-authorization claim recovery", () => {
  for (const capability of TEAMS_CAPABILITIES) {
    if (capability.operationKind !== "effect") continue;
    assert.equal(
      typeof TEAMS_EXECUTION_REGISTRY.registrationFor(capability.identity)
        ?.reconcileClaimed,
      "function",
      capability.identity
    );
  }
});
