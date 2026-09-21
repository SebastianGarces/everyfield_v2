import assert from "node:assert/strict";
import { test } from "node:test";
import { accountTypes } from "@/lib/validations/auth";
import { registrationAccountTypeChoices } from "./account-type-choices";

for (const accountType of ["planter", "sending_church"] as const) {
  const invitation = {
    id: "invitation",
    inviteeEmail: "invitee@example.test",
    invitingOrgName: "Network",
    accountType,
  };
  test(`${accountType} org invitees can choose the intended account or discovery`, () => {
    assert.deepEqual(registrationAccountTypeChoices(invitation, false), [
      accountType,
      "discovery",
    ]);
  });
  test(`seat/coach tokens suppress choices even with a ${accountType} organization invitation`, () => {
    assert.deepEqual(registrationAccountTypeChoices(invitation, true), []);
  });
}

test("ordinary registration retains every account choice", () => {
  assert.deepEqual(registrationAccountTypeChoices(null, false), accountTypes);
  assert.deepEqual(registrationAccountTypeChoices(null, true), []);
});
