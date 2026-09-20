import assert from "node:assert/strict";
import { test } from "node:test";

import { CAPABILITY_BY_EXPORT } from "@/lib/auth/capability-map";
import { evryCapabilityRegistrationFor } from "@/lib/evry/eligibility/capabilities";
import communication from "./communication/inventory.generated.json";
import parity from "./inventory.generated.json";
import meetings from "./meetings/inventory.generated.json";
import teams from "./teams/inventory.generated.json";
import { evePreparations } from "@/lib/evry/eve/preparation";
import { EVE_CHURCH_MERGE_READ } from "@/lib/evry/eve/capabilities/merge-context";

test("scoped app permissions stay visible without widening Evry execution", () => {
  for (const [inventory, sourceCapability, executionCapability, expected] of [
    [teams, "teams.own", "teams.write", 12],
    [meetings, "meetings.attendance", "meetings.write", 6],
  ] as const) {
    const sourceActions = Object.entries(CAPABILITY_BY_EXPORT).filter(
      ([, capability]) => capability === sourceCapability
    );
    assert.equal(sourceActions.length, expected);
    for (const [action] of sourceActions) {
      const identity = `action:${action}`;
      assert.equal(
        parity.entries.find((entry) => entry.identity === identity)
          ?.applicationCapability,
        sourceCapability
      );
      const entry = inventory.entries.find((row) => row.identity === identity);
      assert.ok(entry);
      assert.ok("sourceApplicationCapability" in entry);
      assert.equal(entry.sourceApplicationCapability, sourceCapability);
      assert.equal(entry.applicationCapability, executionCapability);
      assert.ok(entry.capabilityIdentity);
      assert.equal(
        evryCapabilityRegistrationFor(entry.capabilityIdentity)
          ?.applicationCapability,
        executionCapability
      );
    }
  }
});

test("church merge facts are readable while human acceptance stays outside model execution", () => {
  const gap = communication.entries.find(
    (entry) =>
      entry.capabilityIdentity === "communication.compose.get-church-merge-data"
  );
  assert.deepEqual(gap?.classification, {
    state: "supported",
  });
  assert.equal(
    evryCapabilityRegistrationFor("communication.compose.get-church-merge-data")
      ?.operationKind,
    "read"
  );
  for (const identity of [
    "route:/seat-invitation",
    "action:src/app/(auth)/seat-invitation/actions.ts → acceptSeatInvitationAction",
  ]) {
    assert.deepEqual(
      parity.entries.find((entry) => entry.identity === identity)
        ?.classification,
      { state: "excluded", reason: "authentication" }
    );
  }
  assert.equal(
    EVE_CHURCH_MERGE_READ.capabilityIdentity,
    gap?.capabilityIdentity
  );
  assert.ok(
    evePreparations.some((entry) => entry.id === "recipe.meeting-invite")
  );
  assert.equal(
    evePreparations.some((entry) =>
      /acceptSeatInvitation|church-merge-data/.test(entry.id)
    ),
    false
  );
});

test("new own-RSVP context is recorded as a gap, not claimed as an Evry read", () => {
  const entry = meetings.entries.find((row) =>
    row.identity.endsWith(" → getOwnRsvp")
  );
  assert.deepEqual(entry?.classification, {
    state: "excluded",
    reason: "evry_capability_gap",
  });
});
