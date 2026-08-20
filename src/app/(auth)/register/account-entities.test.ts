import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { codeOf } from "@/lib/auth/server-action-surface";
import { isPlantOwner, oversightOrgOf } from "@/lib/auth/tenancy";
import type { AccountType } from "@/lib/validations/auth";

import { createAccountEntities } from "./account-entities";

// ----------------------------------------------------------------------------
// AS-012 — REGISTRATION GRANTS THE SEAT AND THE TENANCY IN ONE WRITE, and it is
// the only place outside seat management that grants a seat at all.
//
// The planner is asserted rather than the rendered INSERT, because the planner
// is where the decision is: what the three account types MEAN in the seat model
// (ruling 185) is the whole subject of #494's registration half. The insert is
// tied to it by the source assertion at the end — one field, one direction, so
// a planner that starts returning the right seat into a write that ignores it
// cannot pass.
//
// Hermetic. `createAccountEntities` builds drizzle statements but awaits
// nothing, so this suite needs no database.
// ----------------------------------------------------------------------------

const USER_ID = "44444444-4444-4444-8444-444444444444";

/**
 * Every account type, the seat it grants, and the tenancy that seat is held in.
 *
 * ALL THREE GRANT `owner`, and that is the point of the table rather than a
 * defect in it: a planter signing up, a sending church signing up and a network
 * signing up are all the first account in a new tenancy, and the first account
 * in a tenancy is its Owner. What differs is WHICH tenancy, which is why a seat
 * is never read without one.
 */
const ACCOUNT_TYPES: {
  accountType: AccountType;
  orgName: string | null;
  seat: "owner";
  tenancy: "plant" | "sending_church" | "network" | "none";
}[] = [
  { accountType: "planter", orgName: null, seat: "owner", tenancy: "none" },
  {
    accountType: "sending_church",
    orgName: "Scratch Sending Church",
    seat: "owner",
    tenancy: "sending_church",
  },
  {
    accountType: "network",
    orgName: "Scratch Network",
    seat: "owner",
    tenancy: "network",
  },
];

for (const { accountType, orgName, seat, tenancy } of ACCOUNT_TYPES) {
  test(`registering as ${accountType} grants ${seat} in ${tenancy}`, () => {
    const planned = createAccountEntities(accountType, orgName, USER_ID);

    assert.equal(planned.seat, seat, "the seat");

    const account = {
      seat: planned.seat,
      churchId: planned.churchId,
      sendingChurchId: planned.sendingChurchId,
      sendingNetworkId: planned.sendingNetworkId,
    };

    if (tenancy === "sending_church" || tenancy === "network") {
      assert.deepEqual(
        oversightOrgOf(account),
        {
          type: tenancy === "network" ? "network" : "sending_church",
          id:
            tenancy === "network"
              ? planned.sendingNetworkId
              : planned.sendingChurchId,
        },
        "the tenancy the seat is held in"
      );
      // …and the org row it points at is created in the SAME batch, before the
      // users insert, so the FK can never name a row that does not exist.
      assert.equal(planned.statements.length, 1, "the org row is planned");
    } else {
      // A planter signs up with no plant — they create it from the dashboard —
      // so the Owner seat is held in a tenancy that does not exist yet. That is
      // the shape `isChurchLevelOwner` exists for, and `isPlantOwner` is false
      // until the plant lands.
      assert.equal(oversightOrgOf(account), null, "no oversight tenancy");
      assert.equal(planned.churchId, null);
      assert.equal(isPlantOwner(account), false);
    }
  });
}

test("an INVITED planter is the Owner of the plant created with them", () => {
  // The one arm that mints a plant at registration: the invitation exists to
  // associate a church plant, so the plant is created here and named by the
  // planter, and the seat and the tenancy land together.
  const planned = createAccountEntities(
    "planter",
    "Scratch Plant",
    USER_ID,
    true
  );

  assert.equal(planned.seat, "owner");
  assert.ok(planned.churchId, "the plant is minted up front");
  assert.equal(
    isPlantOwner({
      seat: planned.seat,
      churchId: planned.churchId,
      sendingChurchId: planned.sendingChurchId,
      sendingNetworkId: planned.sendingNetworkId,
    }),
    true
  );

  // NEITHER OVERSIGHT FK IS SET. The association is written by the accept path,
  // guarded on the invitation reading `accepted`, so a plant can never be bound
  // to an org without an acceptance behind it — and, since #494, a stray
  // oversight FK on a plant row is no longer merely noise: it would make the
  // account's tenancy unresolvable (`oversightOrgOf`).
  assert.equal(planned.sendingChurchId, null);
  assert.equal(planned.sendingNetworkId, null);

  // The church tuple goes AFTER the users insert, which is FK-safe and is what
  // makes register and onboarding's step 1 issue identical church-creation SQL.
  assert.equal(planned.statements.length, 0);
  assert.ok(planned.linkStatements.length > 0);
});

test("the users insert writes the seat the planner decided, and no role", () => {
  // Comments stripped: this asserts what the module WRITES, and the docblock
  // beside the insert legitimately explains the column it no longer names.
  const source = codeOf(
    path.join(process.cwd(), "src/app/(auth)/register/actions.ts")
  );

  // Destructured from the planner and passed straight through — not re-derived
  // from `accountType`, which would be the same decision made twice.
  assert.match(
    source,
    /const \{ seat, churchId, sendingChurchId, sendingNetworkId \} =\s*account;/
  );
  assert.match(source, /\.values\(\{[\s\S]*?\n\s*seat,/);
  assert.doesNotMatch(source, /\brole\b/);
});

test("the planner is NOT an exported endpoint", () => {
  // Every export of a `"use server"` module is a POSTable endpoint reachable
  // with no session and no UI (`memory/invariants.md` → Authentication). The
  // planner lives in a sibling module with no directive precisely so that
  // exporting it — which this suite needs — does not open one.
  // Comments stripped: the header QUOTES the directive to explain why it is
  // absent, the way `@/lib/oversight/session` does.
  const planner = codeOf(
    path.join(process.cwd(), "src/app/(auth)/register/account-entities.ts")
  );
  assert.doesNotMatch(planner, /"use server"/);
});
