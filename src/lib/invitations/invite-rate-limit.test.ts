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
  invitesFromOrgToTargetQuery,
  targetReachFilter,
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
// Four properties, and they fail in four different ways:
//
//   1. THE SCOPE AND THE WINDOW, read off the generated SQL. Counting only
//      pending rows, or forgetting the org predicate, are both invisible in
//      behaviour until somebody actually runs the loop.
//   2. THE PLACEMENT. The LEGIBLE cap must run BEFORE `resolveInvitationTarget`,
//      or it becomes exactly the enumeration oracle ruling 2 closed: a refusal
//      that only a targeted address can trigger says "somebody has an account
//      here".
//   3. THE MESSAGE is the org's own state and not the one collapsed refusal —
//      distinct from `ACCOUNT_NOT_INVITABLE_MESSAGE`, and legible precisely
//      because property 2 holds.
//   4. THE TARGET SCOPE (#304 ruling 4, fix 4). Counting the ADDRESS alone let
//      an org re-address the same organization through a second one of its
//      accounts; both caps now also count the resolved TARGET, and that count's
//      refusal speaks with the one message because it is post-resolution.
// ============================================================================

const CORE = readFileSync(
  path.join(process.cwd(), "src", "lib", "invitations", "core.ts"),
  "utf8"
);

const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const TARGET_CHURCH = "44444444-4444-4444-8444-444444444444";
const TARGET_SENDING_CHURCH = "55555555-5555-4555-8555-555555555555";
const SINCE = new Date("2026-07-10T12:00:00.000Z");
const ADDRESS = "planter@example.com";

/**
 * `targetReachFilter` where the caller knows a target is set — the `null` arm
 * has its own test below.
 */
function reach(values: {
  targetChurchId: string | null;
  targetSendingChurchId: string | null;
}) {
  const filter = targetReachFilter(values);
  assert.ok(filter, "expected a target predicate");
  return filter;
}

/** The guard's own source, minus everything after it. */
const RATE_LIMIT_GUARD = CORE.slice(
  CORE.indexOf("export async function assertInviteRateLimit"),
  CORE.indexOf("/** Resolve + guard + insert.")
);

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
  // A cap whose LEGIBLE refusal only bit on the TARGETED path would be the same
  // oracle in another costume: "that address is rate-limited" would mean
  // "somebody has an account there". The first pass runs before the lookup, and
  // is fed target-less values, so it cannot know which kind it is refusing —
  // it reads no `users` row and asks nothing about the invitee.
  const guard = RATE_LIMIT_GUARD;

  assert.doesNotMatch(guard, /users/);

  // The pre-resolution CALL SITE passes `authority.values`, whose two target
  // keys are null by construction (the authority pass is run on
  // `{ inviteeEmail, inviteAs }`), so the address scope is the only one that can
  // fire there. §4 covers the second pass.
  const create = CORE.slice(
    CORE.indexOf("export async function createInvitationAs")
  );
  assert.match(create, /assertInviteRateLimit\(authority\.values\)/);
});

// ----------------------------------------------------------------------------
// 3. The window and the message
// ----------------------------------------------------------------------------

test("the window is the invitation's own lifetime, and the cap is small", () => {
  // The window is derived from `INVITATION_EXPIRY_DAYS` rather than being a
  // second number to keep in step: an org gets a handful of attempts per
  // invitation lifetime, so the allowance cannot be reset faster than an
  // invitation can expire.
  assert.match(RATE_LIMIT_GUARD, /INVITATION_EXPIRY_DAYS/);
  assert.match(RATE_LIMIT_GUARD, /now\.getTime\(\)/);
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

// ----------------------------------------------------------------------------
// 4. The SECOND scope — the resolved TARGET (#304 ruling 4, fix 4)
// ----------------------------------------------------------------------------
//
// THE BYPASS THIS CLOSES. Both create-time caps counted `invitee_email`, and an
// address is not the thing the cap defends — the banner lands on an
// ORGANIZATION, and an organization can be reached through more than one
// account. Every `sending_church_admin` of one sending church resolves to that
// sending church; a plant may carry more than one `planter`. So an org that had
// spent its three attempts at `admin1@…` typed `admin2@…` and started again,
// against the same target, with `assertNoDuplicatePending` blind to the
// standing invitation as well.

test("the target-scoped count is the org's own rows aimed at one target", () => {
  const { sql, params } = invitesFromOrgToTargetQuery(
    { sendingChurchId: null, sendingNetworkId: NETWORK },
    reach({ targetChurchId: TARGET_CHURCH, targetSendingChurchId: null }),
    SINCE
  ).toSQL();

  assert.match(sql, /"target_church_id" = \$1/);
  assert.match(sql, /"sending_network_id" = \$2/);
  assert.match(sql, /"created_at" >= \$3/);
  assert.deepEqual(params.slice(0, 2), [TARGET_CHURCH, NETWORK]);

  // Same two properties as the address scope: no status predicate (a decline
  // must spend the allowance, not refund it) and bounded by the cap itself.
  assert.doesNotMatch(sql, /"status"/);
  assert.equal(params[3], INVITES_PER_INVITEE_PER_WINDOW);

  // The address is NOT in this predicate. That is the point — the count has to
  // cross addresses to see the bypass.
  assert.doesNotMatch(sql, /"invitee_email"/);
});

test("a sending-church target is counted on its own column", () => {
  const { sql, params } = invitesFromOrgToTargetQuery(
    { sendingChurchId: null, sendingNetworkId: NETWORK },
    reach({
      targetChurchId: null,
      targetSendingChurchId: TARGET_SENDING_CHURCH,
    }),
    SINCE
  ).toSQL();

  assert.match(sql, /"target_sending_church_id" = \$1/);
  assert.doesNotMatch(sql, /"target_church_id"/);
  assert.equal(params[0], TARGET_SENDING_CHURCH);
});

test("an open invitation has no target scope to apply", () => {
  // No target means no second count — and, critically, no second count means
  // the OPEN path answers exactly as it did before, so the two paths still take
  // the same number of queries' worth of observable behaviour on the address
  // scope alone.
  assert.equal(
    targetReachFilter({ targetChurchId: null, targetSendingChurchId: null }),
    null
  );

  assert.match(RATE_LIMIT_GUARD, /const reach = targetReachFilter\(values\)/);
  assert.match(RATE_LIMIT_GUARD, /if \(!reach\) return;/);
});

test("the target-scoped refusal is the ONE message, not the legible cap", () => {
  // It can only fire on an address the org has NOT exhausted, so naming the cap
  // would say "this address and one you already used belong to the same
  // organization" — a fact about somebody else's tenancy, which is exactly what
  // ruling 2 collapsed.
  const afterReach = RATE_LIMIT_GUARD.slice(
    RATE_LIMIT_GUARD.indexOf("const reach = targetReachFilter")
  );
  assert.match(
    afterReach,
    /throw new InvitationError\(ACCOUNT_NOT_INVITABLE_MESSAGE\)/
  );
  assert.doesNotMatch(afterReach, /INVITE_RATE_LIMITED_MESSAGE/);
});

test("createInvitationAs runs the cap again once a target exists", () => {
  const create = CORE.slice(
    CORE.indexOf("export async function createInvitationAs")
  );

  const resolve = create.indexOf("await resolveInvitationTarget");
  const second = create.indexOf("assertInviteRateLimit(resolved.values)");

  assert.ok(second > 0, "the post-resolution pass is missing");
  assert.ok(
    second > resolve,
    "the target-scoped pass must run AFTER the address is resolved"
  );
});

test("the duplicate check counts the target as well as the address", () => {
  const duplicate = CORE.slice(
    CORE.indexOf("async function assertNoDuplicatePending"),
    CORE.indexOf("export const INVITE_RATE_LIMITED_MESSAGE")
  );

  // Two scopes, two messages. The ADDRESS scope stays legible — it reports the
  // actor's own pending row, on an address the actor typed, which their own
  // list already shows them. The TARGET scope speaks with the one message.
  assert.match(duplicate, /already a pending invitation to that address/);
  assert.match(
    duplicate,
    /const reach = targetReachFilter\(values\)[\s\S]*ACCOUNT_NOT_INVITABLE_MESSAGE/
  );

  // Both counts are the caller's OWN org's pending rows, from one predicate, so
  // the two scopes cannot drift into two definitions of "ours".
  assert.match(duplicate, /const ourPending = and\(/);
  assert.match(duplicate, /invitingOrgFilter\(/);
});
