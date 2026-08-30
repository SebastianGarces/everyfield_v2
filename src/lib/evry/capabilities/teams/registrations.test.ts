import assert from "node:assert/strict";
import { test } from "node:test";

import { TEAMS_CAPABILITIES } from "./catalog";
import { TEAMS_CAPABILITY_REGISTRY } from "./registrations";

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
