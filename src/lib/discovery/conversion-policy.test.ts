import assert from "node:assert/strict";
import { test } from "node:test";

import {
  discoveryConversionDecision,
  type DiscoveryProfile,
} from "./conversion-policy";

const account = {
  id: "discovery-account",
  seat: null,
  churchId: null,
  sendingChurchId: null,
  sendingNetworkId: null,
};
const emptyProfile: DiscoveryProfile = {
  userId: account.id,
  sendingChurchId: null,
  sendingNetworkId: null,
};

test("absence of a tenancy does not turn a coach or removed seat into discovery", () => {
  for (const destination of ["plant", "seat"] as const) {
    assert.deepEqual(discoveryConversionDecision(account, null, destination), {
      status: "not-discovery",
    });
  }
});

test("a foreign profile never authorizes conversion", () => {
  for (const destination of ["plant", "seat"] as const) {
    assert.deepEqual(
      discoveryConversionDecision(
        account,
        { ...emptyProfile, userId: "somebody-else" },
        destination
      ),
      { status: "refused", reason: "account-mismatch" }
    );
  }
});

test("either discovery association prevents joining a seat, but permits creating a plant", () => {
  for (const sendingChurchId of [null, "sending-church"]) {
    for (const sendingNetworkId of [null, "network"]) {
      const profile = Object.freeze({
        ...emptyProfile,
        sendingChurchId,
        sendingNetworkId,
      });
      assert.deepEqual(
        discoveryConversionDecision(account, profile, "seat"),
        sendingChurchId || sendingNetworkId
          ? { status: "refused", reason: "leave-associations" }
          : { status: "eligible" }
      );
      assert.deepEqual(discoveryConversionDecision(account, profile, "plant"), {
        status: "eligible",
      });
      assert.equal(profile.sendingChurchId, sendingChurchId);
      assert.equal(profile.sendingNetworkId, sendingNetworkId);
    }
  }
});

test("a stale profile cannot authorize an account that acquired any seat or tenancy", () => {
  for (const seat of [null, "owner", "admin", "member"] as const) {
    for (let tenancyMask = 0; tenancyMask < 8; tenancyMask++) {
      if (seat === null && tenancyMask === 0) continue;
      const changedAccount = {
        ...account,
        seat,
        churchId: tenancyMask & 1 ? "plant" : null,
        sendingChurchId: tenancyMask & 2 ? "org-church" : null,
        sendingNetworkId: tenancyMask & 4 ? "org-network" : null,
      };
      for (const destination of ["plant", "seat"] as const) {
        assert.deepEqual(
          discoveryConversionDecision(
            changedAccount,
            emptyProfile,
            destination
          ),
          { status: "refused", reason: "account-has-standing" }
        );
      }
    }
  }
});

test("leaving only one association is insufficient; leaving both enables seat conversion", () => {
  const both = {
    ...emptyProfile,
    sendingChurchId: "sending-church",
    sendingNetworkId: "network",
  };
  assert.deepEqual(discoveryConversionDecision(account, both, "seat"), {
    status: "refused",
    reason: "leave-associations",
  });
  assert.deepEqual(
    discoveryConversionDecision(
      account,
      { ...both, sendingChurchId: null },
      "seat"
    ),
    { status: "refused", reason: "leave-associations" }
  );
  assert.deepEqual(discoveryConversionDecision(account, emptyProfile, "seat"), {
    status: "eligible",
  });
});
