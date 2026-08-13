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
import { assertInOrder, sourceReader } from "@/lib/testing/source-span";

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

/**
 * `core.ts`, and the ONLY way this file cuts a function out of it.
 *
 * `span` / `after` throw when an anchor has moved — see `@/lib/testing/source-span` for why
 * that is load-bearing rather than defensive dressing, and for the two times a
 * bare `indexOf` turned an assertion about one function into an assertion about
 * the whole module without anything going red. Nothing below slices `CORE.code`
 * by hand.
 */
const CORE = sourceReader(
  readFileSync(
    path.join(process.cwd(), "src", "lib", "invitations", "core.ts"),
    "utf8"
  ),
  "core.ts"
);

const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const TARGET_CHURCH = "44444444-4444-4444-8444-444444444444";
const TARGET_SENDING_CHURCH = "55555555-5555-4555-8555-555555555555";
const SINCE = new Date("2026-07-10T12:00:00.000Z");
const ADDRESS = "planter@example.com";

/**
 * The row filter WITHOUT the post-sever floor (#304 round 10).
 *
 * Both count queries now carry a correlated `not exists (…)` over
 * `association_events`, and that subquery legitimately names both target
 * columns — it has to, because it is what matches an event's subject to the
 * invitation's own. Assertions about which column the OUTER predicate scopes on
 * would otherwise read the subquery's mention and fail on a property that is
 * still true.
 */
function outerWhere(sql: string): string {
  const floor = sql.indexOf("not exists (");
  return floor === -1 ? sql : sql.slice(0, floor);
}

/** The floor's own subquery, for assertions about the reset. */
function postSeverFloor(sql: string): string {
  const floor = sql.indexOf("not exists (");
  assert.ok(floor > 0, "the post-sever floor is missing from this count");
  return sql.slice(floor);
}

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

/**
 * BOTH guards' own source — `assertInviteRateLimit` (address scope, pre-
 * resolution), the shared `rateLimitWindowStart`, and
 * `assertTargetInviteRateLimit` (target scope, post-resolution) — minus
 * everything after them.
 *
 * They were one function until ruling 5 (2026-08-10) split them, so that the
 * legible message lives somewhere the post-resolution path does not call. The
 * span still covers both because the properties below ("no `users` read", "the
 * window is derived, not a second constant") are true of the pair.
 *
 * The end anchor is the `CreatedInvitation` declaration rather than a comment:
 * a docblock is prose and gets reworded, and this one did.
 */
const RATE_LIMIT_GUARD = CORE.span(
  "export async function assertInviteRateLimit",
  "export interface CreatedInvitation"
);

/**
 * `createInvitationAs`'s own body — the call site every ordering assertion below
 * is about.
 *
 * Bounded at the next declaration for the same reason the guard above is: an
 * unbounded slice runs to the end of a 3,000-line module, so "exactly one call
 * to `assertInviteRateLimit` here" would silently become "exactly one in
 * everything that follows", and would keep passing with the call deleted from
 * this function and present in another.
 */
const CREATE_PATH = CORE.span(
  "export async function createInvitationAs",
  "export async function emailInvitee"
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
  // many has this org ever sent". The limit is the LAST bound parameter, not a
  // fixed index — the post-sever floor binds the org pair ahead of it.
  assert.match(sql, /limit \$\d+$/);
  assert.equal(params.at(-1), INVITES_PER_INVITEE_PER_WINDOW);
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
  const create = CREATE_PATH;

  assertInOrder(
    create,
    "core.ts → createInvitationAs",
    [
      "assertInviteRateLimit",
      "await resolveInvitationTarget",
      "assertTargetSlotFree",
    ],
    "the cap must run before the users lookup — and therefore before every post-resolution guard — or its refusal describes a stranger"
  );

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
  assert.match(CREATE_PATH, /assertInviteRateLimit\(authority\.values\)/);
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
  assert.equal(params.at(-1), INVITES_PER_INVITEE_PER_WINDOW);

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

  // The OUTER predicate only — the floor's subquery names both target columns
  // by design, because it matches an event's subject against whichever one this
  // row carries.
  assert.match(outerWhere(sql), /"target_sending_church_id" = \$1/);
  assert.doesNotMatch(outerWhere(sql), /"target_church_id"/);
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
  const afterReach = sourceReader(
    RATE_LIMIT_GUARD,
    "core.ts (the two rate-limit guards)"
  ).after("const reach = targetReachFilter");
  assert.match(
    afterReach,
    /throw new InvitationError\(ACCOUNT_NOT_INVITABLE_MESSAGE\)/
  );
  assert.doesNotMatch(afterReach, /INVITE_RATE_LIMITED_MESSAGE/);
});

test("createInvitationAs runs the cap again once a target exists", () => {
  const create = CREATE_PATH;

  assertInOrder(
    create,
    "core.ts → createInvitationAs",
    [
      "await resolveInvitationTarget",
      "assertTargetInviteRateLimit(resolved.values)",
    ],
    "the target-scoped pass must run AFTER the address is resolved"
  );
});

test("the post-resolution pass cannot compose the legible cap message", () => {
  // RULED 2026-08-10 (round 5 of #304). The two passes were one function, so the
  // post-resolution call re-ran the ADDRESS count first and could throw
  // `INVITE_RATE_LIMITED_MESSAGE` from a position where every refusal has to be
  // the one collapsed message — reachable whenever a row landed between the two
  // calls, and reachable by construction rather than by race in any future edit
  // that moved the first call.
  //
  // The fix is structural: the legible message lives in a function the
  // post-resolution path does not call. So this asserts the CALL GRAPH, not an
  // ordering comment — `assertTargetInviteRateLimit` must not name the legible
  // constant anywhere in its body, and `createInvitationAs` must not call the
  // address-scoped guard a second time.
  //
  // The end anchor is the `CreatedInvitation` declaration, the same one
  // `RATE_LIMIT_GUARD` uses. It was `/** Resolve + guard + insert.` until this
  // round: OV-003b (#293) reworded that docblock to say "+ send", the needle
  // stopped matching, and the span quietly became 82,835 chars of module
  // instead of the 1,133-char function — at which point `doesNotMatch` passed
  // by luck and `match` was satisfied by ANOTHER function's throw. Prose is not
  // an anchor. `span` throws now, so the guard below is redundant and gone.
  const targetGuard = CORE.span(
    "export async function assertTargetInviteRateLimit",
    "export interface CreatedInvitation"
  );

  assert.doesNotMatch(targetGuard, /INVITE_RATE_LIMITED_MESSAGE/);
  assert.match(
    targetGuard,
    /throw new InvitationError\(ACCOUNT_NOT_INVITABLE_MESSAGE\)/
  );

  // Exactly ONE call to the address-scoped guard in the whole create path, and
  // it is the pre-resolution one. A second call is the bug this test exists for.
  const create = CREATE_PATH;
  // `assertTargetInviteRateLimit` does not contain this substring — "assert" is
  // followed by "Target", not by "Invite" — so the count is unambiguous.
  const addressCalls = create.match(/assertInviteRateLimit\(/g) ?? [];

  assert.equal(addressCalls.length, 1, create);
  assert.match(create, /assertInviteRateLimit\(authority\.values\)/);
});

test("the duplicate check counts the target as well as the address", () => {
  const duplicate = CORE.span(
    "async function assertNoDuplicatePending",
    "export const INVITE_RATE_LIMITED_MESSAGE"
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

// ----------------------------------------------------------------------------
// 5. THE CAP RESETS AFTER A SEVER (#304 round 10, RULED 2026-08-11)
// ----------------------------------------------------------------------------
//
// Counting every status is what defeats the decline–reinvite loop, and it also
// meant an association that was ACCEPTED and later ENDED still spent the
// allowance. This track ships three severs, so a plant that joined and left
// inside the 30-day window burned an org's three attempts on invitations it had
// answered — and the fourth was refused by `INVITE_RATE_LIMITED_MESSAGE`, which
// says "wait for an answer" while nothing is pending, or by
// `ACCOUNT_NOT_INVITABLE_MESSAGE`, which points at a plants list showing
// nothing. `remove-plant-dialog.tsx` promises "you can invite them back later"
// in the very dialog that spent the allowance.
//
// The floor is per ROW and correlated: an invitation counts unless this org has
// an `association_events` row about the same subject that is NEWER than it. A
// decline writes no event, so the loop is untouched.

test("both counts drop invitations older than the org's last association event", () => {
  const address = invitesFromOrgToAddressQuery(
    {
      inviteeEmail: ADDRESS,
      sendingChurchId: null,
      sendingNetworkId: NETWORK,
    },
    SINCE
  ).toSQL();
  const target = invitesFromOrgToTargetQuery(
    { sendingChurchId: null, sendingNetworkId: NETWORK },
    reach({ targetChurchId: TARGET_CHURCH, targetSendingChurchId: null }),
    SINCE
  ).toSQL();

  for (const { sql, params } of [address, target]) {
    const floor = postSeverFloor(sql);

    // The org side is the discriminated pair the audit table stores, and it is
    // the CALLER's own org — never coalesced with anything.
    assert.match(floor, /"association_events"\."org_type" = \$\d+/);
    assert.match(floor, /"association_events"\."org_id" = \$\d+/);
    assert.ok(
      (params as unknown[]).includes("network") &&
        (params as unknown[]).includes(NETWORK),
      "the floor is not bound to the caller's own org"
    );

    // The subject side is matched by FK against the invitation's own target,
    // which is what makes it per (org, subject) rather than per org.
    assert.match(
      floor,
      /"association_events"\."church_id" = "organization_invitations"\."target_church_id"/
    );
    assert.match(
      floor,
      /"association_events"\."subject_sending_church_id" = "organization_invitations"\."target_sending_church_id"/
    );

    // STRICTLY NEWER. `>=` would drop an invitation written in the same
    // millisecond as the event it answered, and the event is what that
    // invitation produced.
    assert.match(
      floor,
      /"association_events"\."created_at" > "organization_invitations"\."created_at"/
    );

    // A DECLINE writes no association event, so nothing here reads a status and
    // the decline–reinvite loop still exhausts the allowance.
    assert.doesNotMatch(floor, /"status"/);
  }
});

test("the floor is ONE predicate, shared by both scopes", () => {
  // Two copies is how the address scope and the target scope start answering
  // differently for one org — the same failure `targetReachFilter` exists to
  // prevent one level up.
  const both = CORE.span(
    "export function invitesFromOrgToAddressQuery",
    "export async function assertInviteRateLimit"
  );
  const calls = both.match(/afterTheLastAssociationEventFilter\(values\)/g);
  assert.equal(calls?.length, 2, both);

  // An org with neither id fails CLOSED here: it matches no event, so every
  // invitation still counts. The opposite default would hand a caller with a
  // malformed org an unlimited allowance.
  const { sql } = invitesFromOrgToAddressQuery(
    { inviteeEmail: ADDRESS, sendingChurchId: null, sendingNetworkId: null },
    SINCE
  ).toSQL();
  assert.match(postSeverFloor(sql), /false/);
});
