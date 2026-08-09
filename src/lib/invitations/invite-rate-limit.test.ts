import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ACCOUNT_NOT_INVITABLE_MESSAGE,
  INVITATION_EXPIRY_DAYS,
  INVITES_PER_INVITEE_PER_WINDOW,
  INVITE_RATE_LIMITED_MESSAGE,
  invitesFromOrgToAddressQuery,
} from "./core";

// ============================================================================
// #304, HR4 2026-08-09 — an org cannot keep a banner on a stranger's dashboard.
//
// THE ATTACK, stated once. A targeted invitation raises the dashboard reminder
// on the invitee's plant; OV-005 makes that reminder dismissible ONLY by
// answering; and the card renders the INVITING ORG'S OWN NAME, which its admin
// chose. `assertNoDuplicatePending` stops two standing at once and nothing else
// — a declined row is no longer pending, so before this cap an org could
// re-invite the instant it was refused, forever. Declining has to end something.
//
// Three properties, and they fail in three different ways:
//
//   1. THE SCOPE AND THE WINDOW, read off the generated SQL. Counting only
//      pending rows, or forgetting the org predicate, are both invisible in
//      behaviour until somebody actually runs the loop.
//   2. THE PLACEMENT. The cap must run BEFORE `resolveInvitationTarget`, or it
//      becomes exactly the enumeration oracle ruling 2 closed: a refusal that
//      only a targeted address can trigger says "somebody has an account here".
//   3. THE MESSAGE is the org's own state and not the one collapsed refusal —
//      distinct from `ACCOUNT_NOT_INVITABLE_MESSAGE`, and legible precisely
//      because property 2 holds.
// ============================================================================

const CORE = readFileSync(
  path.join(process.cwd(), "src", "lib", "invitations", "core.ts"),
  "utf8"
);

const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const SINCE = new Date("2026-07-10T12:00:00.000Z");
const ADDRESS = "planter@example.com";

// ----------------------------------------------------------------------------
// 1. What is counted
// ----------------------------------------------------------------------------

test("the cap counts one org's invitations to one address, whatever their status", () => {
  const { sql, params } = invitesFromOrgToAddressQuery(
    {
      inviteeEmail: ADDRESS,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: null,
    },
    SINCE
  ).toSQL();

  assert.match(sql, /"invitee_email" = \$1/);
  assert.match(sql, /"sending_church_id" = \$2/);
  assert.match(sql, /"created_at" >= \$3/);
  assert.deepEqual(params.slice(0, 2), [ADDRESS, SENDING_CHURCH]);
  assert.equal(
    new Date(params[2] as string | Date).toISOString(),
    SINCE.toISOString()
  );

  // NO status predicate, and that absence is the whole control. Every row this
  // is meant to stop reads `declined` by the time the next one is attempted, so
  // counting pending rows only would count exactly the invitations that are not
  // the problem.
  assert.doesNotMatch(sql, /"status"/);

  // Bounded by the cap: the question is "are there at least N?", never "how
  // many has this org ever sent".
  assert.match(sql, /limit \$4/);
  assert.equal(params[3], INVITES_PER_INVITEE_PER_WINDOW);
});

test("a network admin's cap is scoped to their network, not to a sending church", () => {
  // The org predicate is `invitingOrgFilter`, shared with the list and the
  // duplicate check. An arm that read the wrong column would make one org's
  // allowance spendable by another — and, worse, would leak nothing and look
  // fine.
  const { sql, params } = invitesFromOrgToAddressQuery(
    {
      inviteeEmail: ADDRESS,
      sendingChurchId: null,
      sendingNetworkId: NETWORK,
    },
    SINCE
  ).toSQL();

  assert.match(sql, /"sending_network_id" = \$2/);
  assert.doesNotMatch(sql, /"sending_church_id"/);
  assert.equal(params[1], NETWORK);
});

test("an org with neither id matches nothing rather than everything", () => {
  // `and()` DROPS an undefined predicate, so a helper that returned one here
  // would turn the count into "every invitation in the product to this address"
  // — which refuses a legitimate first invitation and, in the other direction,
  // is a fact about other orgs. `invitingOrgFilter` returns `false` instead.
  const { sql } = invitesFromOrgToAddressQuery(
    { inviteeEmail: ADDRESS, sendingChurchId: null, sendingNetworkId: null },
    SINCE
  ).toSQL();

  assert.match(sql, /false/);
});

// ----------------------------------------------------------------------------
// 2. Where it runs — the property that keeps it from being an oracle
// ----------------------------------------------------------------------------

test("the cap is applied before the address is resolved to a target", () => {
  const create = CORE.slice(
    CORE.indexOf("export async function createInvitationAs")
  );

  const cap = create.indexOf("assertInviteRateLimit");
  const resolve = create.indexOf("await resolveInvitationTarget");
  const slot = create.indexOf("assertTargetSlotFree");

  assert.ok(cap > 0, "the cap is not wired into createInvitationAs at all");
  assert.ok(
    cap < resolve,
    "the cap must run before the users lookup, or its refusal describes a stranger"
  );
  assert.ok(cap < slot, "…and therefore before every post-resolution guard");

  // It is fed the AUTHORITY pass's values — the target-less resolution, whose
  // org ids come from the session. Feeding it the post-resolution values would
  // work identically and quietly move it after the lookup.
  assert.match(create, /assertInviteRateLimit\(authority\.values\)/);
});

test("the cap applies to open invitations too", () => {
  // A cap that only bit on the TARGETED path would be the same oracle in
  // another costume: "that address is rate-limited" would mean "somebody has an
  // account there". Running before the lookup makes it structurally impossible
  // for the guard to know which kind it is refusing — there is no branch in it,
  // and nothing it can read that would say.
  const guard = CORE.slice(
    CORE.indexOf("export async function assertInviteRateLimit"),
    CORE.indexOf("/** Resolve + guard + insert.")
  );

  assert.doesNotMatch(guard, /targetChurchId|targetSendingChurchId/);
  assert.doesNotMatch(guard, /users/);
});

// ----------------------------------------------------------------------------
// 3. The window and the message
// ----------------------------------------------------------------------------

test("the window is the invitation's own lifetime, and the cap is small", () => {
  // The window is derived from `INVITATION_EXPIRY_DAYS` rather than being a
  // second number to keep in step: an org gets a handful of attempts per
  // invitation lifetime, so the allowance cannot be reset faster than an
  // invitation can expire.
  const guard = CORE.slice(
    CORE.indexOf("export async function assertInviteRateLimit"),
    CORE.indexOf("/** Resolve + guard + insert.")
  );
  assert.match(guard, /INVITATION_EXPIRY_DAYS/);
  assert.match(guard, /now\.getTime\(\)/);
  assert.equal(INVITES_PER_INVITEE_PER_WINDOW, 3);
  assert.equal(INVITATION_EXPIRY_DAYS, 30);
});

test("the refusal names the org's own behaviour, not the collapsed one message", () => {
  // Legible ONLY because the guard runs pre-resolution (see above). It reports
  // how many invitations THIS org sent to an address THIS admin typed — the
  // same category of fact as `assertNoDuplicatePending`, which the 2026-08-09
  // ruling explicitly leaves legible.
  assert.notEqual(INVITE_RATE_LIMITED_MESSAGE, ACCOUNT_NOT_INVITABLE_MESSAGE);

  // It names no role, no organization and no relationship of the INVITEE's.
  assert.doesNotMatch(
    INVITE_RATE_LIMITED_MESSAGE,
    /account|planter|plant|network|sending church/i
  );
  assert.doesNotMatch(INVITE_RATE_LIMITED_MESSAGE, /error|failed|invalid/i);

  // …and it says what to do next, which is the whole point of keeping it
  // legible rather than collapsing it too.
  assert.match(INVITE_RATE_LIMITED_MESSAGE, /wait|another way/i);
});
