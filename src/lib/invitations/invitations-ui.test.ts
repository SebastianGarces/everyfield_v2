import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ACCOUNT_NOT_INVITABLE_MESSAGE,
  bindOpenInvitationTargetQuery,
  inviteeAccountTarget,
  isInvitationTargetKind,
  normalizeInviteeEmail,
  resolveInvitationForResolvedTarget,
  resolveInvitationRequest,
  slotRefusalMessage,
  type InvitationActor,
} from "./core";
import { invitationCreatedNotice } from "./create-notice";
import { toInvitationListRow } from "./list-row";
import { assertInOrder, sourceReader } from "@/lib/testing/source-span";
import {
  describeInvitationForRegistration,
  hasValidInvitationBypass,
  invitationActedOnAtRegistration,
  invitationEmailMismatchMessage,
  isOpenRedeemableInvitation,
  registrationEmailMatchesInvitation,
  type InvitationForRegistration,
  type RegistrationInvitationReader,
} from "@/app/(auth)/register/beta-gate";

// ============================================================================
// #23 — the invitations SURFACE, and the two rulings that shaped it.
//
// `service.test.ts` owns the #265 auth surface and is not duplicated here. This
// file covers only what #23 added:
//
//   1. NO EXPIRY FIELD (ruled 2026-08-03 on #265 r2, restated on #23). Pinned
//      as an assertion about the create form itself, not just the request type
//      — the ruling is about what an admin is ASKED, and a form field is what
//      would break it.
//   2. THE OCCUPIED-SLOT REFUSAL (ruled 2026-08-03). `createInvitation` refuses
//      up front when the target's oversight slot is held. Pinned as a service-
//      layer fact: the guard runs inside `createInvitationAs`, so a forged
//      direct POST to the action hits it too and it cannot be satisfied by form
//      validation alone.
//   3. THE REGISTER TOKEN WIRE. The bug #23 exists to fix is that
//      `register/actions.ts` read a form field nothing rendered, so the token
//      never arrived. The two halves are asserted against each other here — a
//      rename on either side fails.
//
// Source-shaped assertions are used where the thing being pinned IS a piece of
// source (a form field, a call site). Everything with behaviour is executed.
//
// §6–§8 are the three rulings of 2026-08-04, made on the review of this PR:
//
//   6. AN ADDRESS THAT ALREADY HAS AN ACCOUNT IS REFUSED at create, until #277
//      ships somewhere to answer from. Same family as the occupied slot above:
//      no invitation that cannot be answered.
//   7. REVOKE IS ORG-SCOPED, exactly like the list it is rendered on.
//   8. THE TOKEN IS BOUND TO THE INVITED ADDRESS — a link holder can no longer
//      register under an address of their choosing.
// ============================================================================

const ROOT = path.join(process.cwd(), "src");

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/**
 * The code, minus its comments. These files explain their rulings at length, so
 * an assertion that a name is GONE has to look at what runs — otherwise the
 * comment recording why it was removed is what fails the test.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CORE_CODE = read("lib", "invitations", "core.ts");
const CREATE_FORM = read(
  "components",
  "oversight",
  "invitation-create-form.tsx"
);
const INVITATIONS_ACTIONS = read(
  "app",
  "(dashboard)",
  "oversight",
  "invitations",
  "actions.ts"
);
const INVITATIONS_PAGE = read(
  "app",
  "(dashboard)",
  "oversight",
  "invitations",
  "page.tsx"
);
const INVITATIONS_LIST = read(
  "components",
  "oversight",
  "invitations-list.tsx"
);
const LIST_ROW = read("lib", "invitations", "list-row.ts");
const REGISTER_ACTIONS = read("app", "(auth)", "register", "actions.ts");
const REGISTER_FORM = read("app", "(auth)", "register", "register-form.tsx");
const REGISTER_BETA_GATE = read("app", "(auth)", "register", "beta-gate.ts");

/**
 * The readers, and the ONLY way this file cuts a declaration out of a module.
 *
 * `span` / `after` throw naming the missing needle — see `@/lib/testing/source-span` for why
 * that is load-bearing. This file is where the rule was learnt the hard way a
 * third time: `async function createAccountEntities` was never `async`, so the
 * needle was -1, the "no oversight FK is written at registration" span was the
 * EMPTY STRING, and its `doesNotMatch` was a tautology; the same dead needle was
 * the END anchor of the `register` body 400 lines later, which made every
 * assertion about `register` an assertion about 93% of the module. Nothing below
 * slices `.code` by hand.
 */
const CORE = sourceReader(CORE_CODE, "core.ts");
const ACTIONS = sourceReader(
  INVITATIONS_ACTIONS,
  "oversight/invitations/actions.ts"
);
const REGISTER = sourceReader(REGISTER_ACTIONS, "register/actions.ts");

/**
 * `createInvitationAs`'s own body — the subject of every ordering assertion
 * about the create path below.
 *
 * Bounded at the NEXT DECLARATION rather than at the `// Respond` banner it used
 * to end on: a comment is prose, and this one sits 7,000 chars further down, so
 * "exactly these three `resolveInvitation*` calls happen here" was really a
 * claim about `emailInvitee` and `emailInviteeOutcome` as well.
 */
const CREATE_PATH = CORE.span(
  "export async function createInvitationAs",
  "export async function emailInvitee"
);

const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const PLANT = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "77777777-7777-4777-8777-777777777777";

function actor(overrides: Partial<InvitationActor>): InvitationActor {
  return {
    id: ADMIN_ID,
    role: "sending_church_admin",
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...overrides,
  } as InvitationActor;
}

const SC_ADMIN = actor({
  role: "sending_church_admin",
  sendingChurchId: SENDING_CHURCH,
});
const NET_ADMIN = actor({ role: "network_admin", sendingNetworkId: NETWORK });

/** A sending church that is NOT the one `SC_ADMIN` speaks for. */
const OTHER_SENDING_CHURCH = "66666666-6666-4666-8666-666666666666";
/** The stand-in for "the invitation was created" in the refusal enumeration. */
const SUCCESS = "created";

// ----------------------------------------------------------------------------
// 1. Ruling: no expiry field
// ----------------------------------------------------------------------------

test("the create form has no expiry field, and no way to grow one", () => {
  // RULED 2026-08-03: the window is server-fixed. `service.test.ts` already
  // pins that the REQUEST type and the logic layer carry no expiry; this pins
  // the half a user can see. A `<Input name="expires…">` or a day-count select
  // is what the ruling forbids, and it would type-check perfectly.
  assert.doesNotMatch(CREATE_FORM, /expiresIn|expiryDate|name="expires/i);
  assert.doesNotMatch(INVITATIONS_ACTIONS, /expiresIn|expiryDate/i);

  // The form is allowed to SAY what the fixed window is — that is the copy
  // that replaces the field — and it reads it from the constant rather than
  // hard-coding a number that could drift from `INVITATION_EXPIRY_DAYS`.
  assert.match(CREATE_FORM, /expiryDays/);
  assert.match(INVITATIONS_PAGE, /INVITATION_EXPIRY_DAYS/);

  // And the action's schema has exactly two keys, so an expiry cannot arrive
  // in the POST body either.
  const schema = ACTIONS.span("const createSchema", "const revokeSchema");
  assert.match(schema, /inviteeEmail:/);
  assert.match(schema, /inviteAs:/);
  assert.equal(schema.match(/^\s{2}\w+:/gm)?.length, 2, schema);
});

// ----------------------------------------------------------------------------
// 2. Ruling: the occupied slot is refused at CREATE time, in the service
// ----------------------------------------------------------------------------

test("the occupied-slot refusal is inside createInvitationAs, not the form", () => {
  // RULED 2026-08-03: "service-layer check (defense in depth), not just form
  // validation" — so the check has to sit on the path a FORGED direct call
  // takes. `createInvitation` (the only exported way in) calls
  // `createInvitationAs`, and the guard runs there, before the insert.
  const body = CREATE_PATH;

  assert.match(body, /await assertTargetSlotFree\(resolved\.values\)/);
  assertInOrder(
    body,
    "core.ts → createInvitationAs",
    ["assertTargetSlotFree", "insertInvitation"],
    "the slot is checked BEFORE the row is written"
  );

  // …and the ROLE is settled before either. `resolveInvitationTarget` reads
  // `users` and tells "no such account" apart from "a planter with no church",
  // which is an account-enumeration oracle: it must be unreachable to anyone
  // who may not invite at all. The authority call is pure and takes no target,
  // so it can run first without a lookup.
  assertInOrder(
    body,
    "core.ts → createInvitationAs",
    ["const authority = resolveInvitationRequest", "resolveInvitationTarget"],
    "a non-oversight caller must be refused before any address is looked up"
  );

  // The form surfaces whatever the service refused, verbatim — the ruling
  // requires the admin to be told clearly, and a generic "something went wrong"
  // would satisfy the code but not the ruling.
  assert.match(INVITATIONS_ACTIONS, /return \{ error: result\.error \}/);
  assert.match(CREATE_FORM, /state\.error/);
});

test("every slot refusal is the SAME sentence — ruled 2026-08-09", () => {
  // RULING 2 on #304. Until this ruling the slot check answered "that plant
  // belongs to another org" and "that plant is already yours" separately, and
  // `resolveInvitationTarget` answered "we cannot invite that account". An
  // authenticated admin could therefore type any address and read back which of
  // those was true of the stranger behind it — an account/association
  // enumeration oracle costing one form submission per probe.
  //
  // The domain of the verdict is three values and this enumerates all of them,
  // so the collapse is proven rather than asserted about one branch.
  assert.equal(slotRefusalMessage(null), null, "a free slot is not a refusal");
  for (const held of ["ours", "other"] as const) {
    assert.equal(slotRefusalMessage(held), ACCOUNT_NOT_INVITABLE_MESSAGE, held);
  }

  // …and it is the very message the ACCOUNT lookup already refused with, so
  // "we cannot invite that account" and "that plant's slot is taken" are one
  // outcome from outside: the two checks are the two halves of the oracle, and
  // collapsing only one of them would have collapsed nothing.
  assert.deepEqual(
    inviteeAccountTarget({
      role: "coach",
      churchId: null,
      sendingChurchId: null,
    }),
    { ok: false, error: slotRefusalMessage("other") }
  );
});

test("no second refusal message survives anywhere in the invitation logic", () => {
  // The constants the ruling retired. Kept as a source assertion because the
  // failure mode is a well-meaning re-introduction ("the admin can't tell
  // what's wrong"), and a deleted export is invisible to a behavioural test.
  assert.doesNotMatch(CORE_CODE, /SLOT_TAKEN_MESSAGE|ALREADY_OURS_MESSAGE/);
  assert.doesNotMatch(CORE_CODE, /already belongs to a sending church/);
  assert.doesNotMatch(CORE_CODE, /already part of your organization/);

  // `assertTargetSlotFree` has no message of its own: it asks
  // `slotRefusalMessage` and throws whatever it gets.
  const guard = CORE.span(
    "export async function assertTargetSlotFree",
    "export function slotRefusalMessage"
  );
  assert.match(guard, /const refusal = slotRefusalMessage\(held\)/);
  assert.match(guard, /throw new InvitationError\(refusal\)/);
  assert.doesNotMatch(guard, /"/, "no string literal is composed in the guard");
});

test("EVERY post-resolution refusal is the one message, for every account", () => {
  // The regression this file did not have. `assertTargetSlotFree` was collapsed
  // (above), but `createInvitationAs` re-runs the pure authority rules on the
  // RESOLVED target, and that second call had a sentence of its own: a
  // `sending_church_admin` who probed an address belonging to another
  // sending-church admin read back "A sending church can only invite church
  // plants" — a THIRD outcome, which is the oracle wearing a different hat.
  //
  // So the property is asserted over the whole email→verdict pipeline and over
  // the whole account domain, not over one branch: whatever the address turns
  // out to be, an admin may learn only "this worked" or "not this address".
  const accounts = [
    ["no account at all", undefined],
    ["planter with a plant", { role: "planter", churchId: PLANT }],
    ["planter with no plant yet", { role: "planter" }],
    ["team member", { role: "team_member", churchId: PLANT }],
    ["coach", { role: "coach", churchId: PLANT }],
    ["network admin", { role: "network_admin", sendingNetworkId: NETWORK }],
    [
      "sending church admin WITH a sending church",
      { role: "sending_church_admin", sendingChurchId: OTHER_SENDING_CHURCH },
    ],
    ["sending church admin with none yet", { role: "sending_church_admin" }],
  ] as const;

  for (const [who, actingFor] of [
    ["a sending church admin", SC_ADMIN],
    ["a network admin", NET_ADMIN],
  ] as const) {
    const outcomes = new Set<string>();

    for (const [label, account] of accounts) {
      const lookup = inviteeAccountTarget(
        account && {
          role: account.role,
          churchId: ("churchId" in account && account.churchId) || null,
          sendingChurchId:
            ("sendingChurchId" in account && account.sendingChurchId) || null,
        }
      );

      const verdict = !lookup.ok
        ? lookup.error
        : // Exactly what `createInvitationAs` does with the resolved target.
          (() => {
            const resolved = resolveInvitationForResolvedTarget(
              actingFor,
              { inviteeEmail: "probe@example.com" },
              lookup.target
            );
            return resolved.ok ? SUCCESS : resolved.error;
          })();

      assert.ok(
        verdict === SUCCESS || verdict === ACCOUNT_NOT_INVITABLE_MESSAGE,
        `${who} probing ${label} learned: ${verdict}`
      );
      outcomes.add(verdict);
    }

    // …and the set is exactly two values, so no branch smuggles a third.
    assert.deepEqual(
      [...outcomes].sort(),
      [ACCOUNT_NOT_INVITABLE_MESSAGE, SUCCESS].sort(),
      who
    );
  }
});

test("the post-resolution pass is the collapsed one, at the call site", () => {
  // The behavioural property above holds only while `createInvitationAs` routes
  // the second pass through the collapsing wrapper. Reverting it to a bare
  // `resolveInvitationRequest(actor, {...resolvedTarget.target})` re-opens the
  // oracle without failing anything else, so the wiring is pinned here.
  const calls = code(CREATE_PATH).match(/resolveInvitation\w*\(/g) ?? [];

  assert.deepEqual(calls, [
    // 1. AUTHORITY, before any lookup — legible, and about the ACTOR.
    "resolveInvitationRequest(",
    // 2. the address → target lookup.
    "resolveInvitationTarget(",
    // 3. the second pass, collapsed, because it speaks about the ADDRESS.
    "resolveInvitationForResolvedTarget(",
  ]);
});

// ----------------------------------------------------------------------------
// 3. The email is the only thing an admin names — never a plant id
// ----------------------------------------------------------------------------

test("a client cannot name a target; the address is resolved server-side", () => {
  // The privacy reason, as a test: an oversight admin sees only their own
  // plants, so a form that accepted a `targetChurchId` would need a picker, and
  // a picker would have to list every plant in the product. The action's schema
  // has no key for one, and the create form renders no field for one.
  const inputs = ACTIONS.span(
    "const createSchema",
    "const result = await createInvitation"
  );
  assert.doesNotMatch(inputs, /targetChurchId|targetSendingChurchId/);
  assert.doesNotMatch(CREATE_FORM, /targetChurchId|targetSendingChurchId/);
  assert.match(inputs, /inviteeEmail/);
});

test("addresses are normalized the way users.email is stored", () => {
  assert.equal(
    normalizeInviteeEmail("  Planter@Example.COM "),
    "planter@example.com"
  );
  assert.equal(normalizeInviteeEmail(undefined), "");
  assert.equal(normalizeInviteeEmail(42), "");
});

test("inviteAs accepts the two kinds and nothing else", () => {
  assert.ok(isInvitationTargetKind("church"));
  assert.ok(isInvitationTargetKind("sending_church"));
  for (const value of ["CHURCH", "network", "", null, undefined, 1, {}]) {
    assert.ok(!isInvitationTargetKind(value), JSON.stringify(value));
  }
});

test("an open invitation still derives its inviting org from the session", () => {
  // The #265 rule, re-checked on the new no-target path: an invitation with no
  // target still cannot name the org it is issued on behalf of.
  const open = resolveInvitationRequest(SC_ADMIN, {
    inviteeEmail: "new-planter@example.com",
    inviteAs: "church",
  });

  assert.ok(open.ok);
  assert.equal(open.values.type, "church_to_sending_church");
  assert.equal(open.values.sendingChurchId, SENDING_CHURCH);
  assert.equal(open.values.sendingNetworkId, null);
  assert.equal(open.values.targetChurchId, null);
  assert.equal(open.values.inviteeEmail, "new-planter@example.com");

  const netOpen = resolveInvitationRequest(NET_ADMIN, {
    inviteeEmail: "  NEW@Example.com ",
    inviteAs: "sending_church",
  });
  assert.ok(netOpen.ok);
  assert.equal(netOpen.values.type, "sending_church_to_network");
  assert.equal(netOpen.values.sendingNetworkId, NETWORK);
  // Normalized on the way to the row, so the duplicate check and the
  // `users.email` lookup compare the same string the admin typed.
  assert.equal(netOpen.values.inviteeEmail, "new@example.com");
});

// ----------------------------------------------------------------------------
// 4. Redeeming an invite link is single-use
// ----------------------------------------------------------------------------

test("binding an open invitation to a new org is a compare-and-set", () => {
  // The write that makes an invite link single-use, read off the SQL. Four
  // predicates matter and each closes a different hole:
  //   * `status = 'pending'` — a revoked or answered link binds nothing;
  //   * BOTH targets `is null` — an invitation already pointed at somebody's
  //     organization can never be re-aimed at a different one;
  //   * `expires_at > now` — trusted from the WRITE, not from the read that
  //     preceded it, so a link cannot be redeemed in the gap.
  // And `status` is NOT in the SET: the row stays pending with a target, which
  // is the only state `acceptInvitationAs` will act on and the only one that is
  // safe to crash in (pending + unbound, never accepted + unbound).
  const { sql, params } = bindOpenInvitationTargetQuery(
    INVITATION_ID,
    { targetChurchId: PLANT },
    ADMIN_ID,
    new Date("2026-08-04T00:00:00.000Z")
  ).toSQL();

  assert.match(sql, /update "organization_invitations"/);
  assert.match(sql, /"target_church_id" is null/);
  assert.match(sql, /"target_sending_church_id" is null/);
  assert.match(
    sql,
    /"expires_at" is null or "organization_invitations"\."expires_at" > \$\d+/
  );
  assert.match(sql, /"status" = \$\d+/);
  // Through the reader for the same reason the source spans are: a drizzle
  // release that stopped emitting a lowercase " where " would make a bare
  // `indexOf` pair return the empty string, and `doesNotMatch("", …)` is true of
  // everything.
  const setClause = sourceReader(
    sql,
    "the bindOpenInvitationTarget UPDATE"
  ).span(" set ", " where ");
  assert.doesNotMatch(setClause, /"status"/, setClause);
  assert.ok(params.includes(INVITATION_ID));
  assert.ok(params.includes("pending"));
  assert.ok(params.includes(PLANT));
  assert.ok(params.includes(ADMIN_ID));
});

// ----------------------------------------------------------------------------
// 5. The register token wire — the bug #23 exists to fix
// ----------------------------------------------------------------------------

test("the field the register action reads is the field the form renders", () => {
  // THE #23 regression, as one assertion. `register/actions.ts` has always read
  // `formData.get("invitationId")`; `register-form.tsx` never rendered it, so
  // the token could not reach the action: the beta-gate bypass never fired and
  // an invited planter finished signup unassociated. A rename on either side
  // silently restores that, so both sides are read from source and compared.
  const readField = REGISTER_ACTIONS.match(
    /formData\.get\("([^"]+)"\)[^;]*invitationId|invitationId[^=]*=\s*\(formData\.get\("([^"]+)"\)/
  );
  assert.ok(
    readField,
    "the register action no longer reads an invitation field"
  );
  const fieldName = readField[1] ?? readField[2];
  assert.equal(fieldName, "invitationId");
  assert.match(REGISTER_FORM, new RegExp(`name="${fieldName}"`));
});

test("registration binds THEN accepts, never the other way round", () => {
  // Order is the invariant (memory/invariants.md → Multi-Tenancy). Binding the
  // target leaves the row `pending` with a target — recoverable. Claiming first
  // and creating the church second would, on a crash, leave an invitation
  // reading `accepted` with no association behind it: the one state nothing in
  // the product can repair.
  const body = REGISTER.after("async function redeemRegistrationInvitation");
  assertInOrder(
    body,
    "register/actions.ts → redeemRegistrationInvitation",
    ["bindOpenInvitationTarget", "acceptInvitationAs"],
    "the target must be bound before the invitation is accepted"
  );

  // And the actor is minted, never assembled — the same rule every other
  // invitation mutation follows.
  assert.match(body, /invitationActorFromSession\(\{ user \}\)/);

  // The association itself is never written here: `createAccountEntities` must
  // not set an oversight FK, or a plant could be bound with no acceptance.
  //
  // The function is SYNCHRONOUS. Anchored on `async function` this span was -1
  // to 17862 — the empty string — so the `doesNotMatch` below was a tautology
  // and stayed green with `sendingChurchId: invitation` written into the body.
  const entities = REGISTER.span(
    "function createAccountEntities",
    "async function redeemRegistrationInvitation"
  );
  assert.doesNotMatch(
    entities,
    /sendingChurchId: invitation|sendingNetworkId: invitation/
  );
});

// ----------------------------------------------------------------------------
// 6. #304 restored the targeted path — an existing account now maps to its org
// ----------------------------------------------------------------------------
//
// The 2026-08-04 ruling refused EVERY existing account, on a premise it stated
// out loud: the only place an invitation could be answered was `/register`, and
// somebody who already registered cannot register again. #304 removed that
// premise by building `/settings/association` and the dashboard reminder, so the
// mapping the ruling described as the restoration is what is asserted here.
// ----------------------------------------------------------------------------

test("an existing account maps to the organization it speaks for", () => {
  // Pure, so this is a real behavioural assertion and not a grep.
  assert.deepEqual(
    inviteeAccountTarget({
      role: "planter",
      churchId: PLANT,
      sendingChurchId: null,
    }),
    { ok: true, target: { targetChurchId: PLANT } }
  );

  assert.deepEqual(
    inviteeAccountTarget({
      role: "sending_church_admin",
      churchId: null,
      sendingChurchId: SENDING_CHURCH,
    }),
    { ok: true, target: { targetSendingChurchId: SENDING_CHURCH } }
  );

  // No account at all is still the OPEN invitation path, untouched: no target,
  // and `/register` binds one when they sign up.
  assert.deepEqual(inviteeAccountTarget(undefined), { ok: true, target: {} });
});

test("an account that speaks for no invitable org is refused, with ONE message", () => {
  // The account-enumeration property the 2026-08-04 ruling introduced survives
  // the restoration: a team member, a coach, a network admin and a planter with
  // no plant yet are four different facts about an address, and the inviter is
  // told none of them — only "not this address".
  const refusals = [
    { role: "team_member", churchId: PLANT, sendingChurchId: null },
    { role: "coach", churchId: PLANT, sendingChurchId: null },
    { role: "network_admin", churchId: null, sendingChurchId: null },
    // A planter who has not created their plant yet: there is no row to target.
    { role: "planter", churchId: null, sendingChurchId: null },
    // A sending church admin with no sending church yet, likewise.
    { role: "sending_church_admin", churchId: null, sendingChurchId: null },
  ] as const;

  for (const account of refusals) {
    assert.deepEqual(
      inviteeAccountTarget(account),
      { ok: false, error: ACCOUNT_NOT_INVITABLE_MESSAGE },
      account.role
    );
  }
});

test("the account refusal is in the service, on the forged-call path", () => {
  // "Service-layer check (a forged direct call is also rejected)" — so the
  // refusal has to sit inside `createInvitationAs`, which is the single path
  // `createInvitation` takes, rather than in the form or the action's schema.
  // `resolveInvitationTarget` is where the address meets `users`, and it is
  // called before anything is written.
  const target = CORE.span(
    "export async function resolveInvitationTarget",
    "export async function assertTargetSlotFree"
  );
  assert.match(target, /return inviteeAccountTarget\(existing\)/);
  // The projection is the three columns the pure mapper reads — and nothing
  // else. Selecting the row would pull `password_hash` into memory to answer
  // "which org is this".
  assert.doesNotMatch(target, /\.select\(\)/);

  const create = CREATE_PATH;
  assert.match(create, /await resolveInvitationTarget\(inviteeEmail\)/);
  assertInOrder(
    create,
    "core.ts → createInvitationAs",
    ["resolveInvitationTarget", "insertInvitation"],
    "the address is judged BEFORE the row is written"
  );
  // Authority still comes first: this refusal is itself an account-existence
  // oracle, so it must be unreachable to anyone who may not invite at all.
  assertInOrder(
    create,
    "core.ts → createInvitationAs",
    ["const authority = resolveInvitationRequest", "resolveInvitationTarget"],
    "a non-oversight caller must be refused before any address is looked up"
  );
});

test("the account refusal reads as a next action, not as a failure", () => {
  // Surfaced as a FORM ERROR — the action returns `result.error` verbatim
  // (asserted in §2) and the create form renders it — so the wording is the
  // whole of what the admin gets. It has to say what happened and what to do.
  assert.doesNotMatch(ACCOUNT_NOT_INVITABLE_MESSAGE, /error|failed|invalid/i);

  // It is now the ONLY thing an admin reads about an address, so it has to be
  // true of all four situations behind it at once — which means naming none of
  // them. No role, no organization, no relationship: a message that said "that
  // plant already belongs to somebody" would be the oracle wearing softer
  // words.
  for (const leak of [
    /already (belongs|part of|yours)/i,
    /sending church|network/i,
    /coach|team member/i,
  ]) {
    assert.doesNotMatch(ACCOUNT_NOT_INVITABLE_MESSAGE, leak);
  }

  // What it must still do is point at the two lists that answer "is this
  // already handled?" from inside the admin's own tenancy.
  assert.match(ACCOUNT_NOT_INVITABLE_MESSAGE, /pending invitations/i);
  assert.match(ACCOUNT_NOT_INVITABLE_MESSAGE, /plants/i);

  // The form's own copy has to describe TODAY's rule, not the one #304
  // replaced: an existing planter can now be invited and answers from
  // `/settings/association`. Copy that survives only because nobody changed it
  // is not truthful copy — the same standard `OVERSIGHT_SHARING_TOGGLE` is held
  // to.
  assert.doesNotMatch(
    CREATE_FORM,
    /already has an EveryField account cannot be invited/
  );
  assert.match(CREATE_FORM, /planter/i);
});

// ----------------------------------------------------------------------------
// 7. Ruling (2026-08-04): revoke is scoped to the ORG, like the list
// ----------------------------------------------------------------------------

test("the surface no longer decides revoke from the inviter's id", () => {
  // `service.test.ts` owns the SQL half (the WHERE names the actor's own org and
  // no longer names `inviter_user_id`). This is the surface half: the page used
  // to compute `canRevoke: invitation.inviterUserId === user.id`, which is what
  // made a colleague's pending invitation unactionable. Any pending row the
  // org-scoped list can see is now revocable, and the check that matters stays
  // in the UPDATE.
  assert.doesNotMatch(code(INVITATIONS_PAGE), /canRevoke/);
  assert.doesNotMatch(code(INVITATIONS_LIST), /canRevoke/);
  assert.doesNotMatch(code(INVITATIONS_PAGE), /inviterUserId/);

  // The Revoke button is rendered for a pending row, and for nothing else — a
  // revoke of an answered invitation is refused by the compare-and-set anyway,
  // but offering it would be a lie.
  assert.match(
    INVITATIONS_LIST,
    /row\.status === "pending" && \(\s*<RevokeButton/
  );

  // The list is still read with the actor minted from the session, so "our org"
  // has no client-supplied half to disagree about.
  assert.match(INVITATIONS_PAGE, /getInvitationsForOrg\(actor\)/);
  assert.match(INVITATIONS_PAGE, /invitationActorFromSession\(\{ user \}\)/);
});

// ----------------------------------------------------------------------------
// 8. Ruling (2026-08-04): the invite token is bound to the invited address
// ----------------------------------------------------------------------------

test("only the invited address matches an invitation token", () => {
  // The bearer-token hole, closed and executed. An invitation link is a uuid in
  // a URL — forwarded, pasted, archived — so holding one must not be enough to
  // register under an address of your choosing.
  assert.ok(
    registrationEmailMatchesInvitation(
      "planter@example.com",
      "planter@example.com"
    )
  );
  // Casing and stray whitespace are the same address, not an attack.
  assert.ok(
    registrationEmailMatchesInvitation(
      "Planter@Example.COM",
      "  planter@example.com "
    )
  );

  assert.ok(
    !registrationEmailMatchesInvitation(
      "planter@example.com",
      "someone-else@example.com"
    )
  );
  // A near miss is still a miss.
  assert.ok(
    !registrationEmailMatchesInvitation(
      "planter@example.com",
      "planter@example.com.evil.test"
    )
  );
  // An invitation with no recorded address (rows predating #23) binds to
  // NOBODY — that row is exactly the bearer token this ruling closes.
  assert.ok(!registrationEmailMatchesInvitation(null, "planter@example.com"));
  assert.ok(!registrationEmailMatchesInvitation("planter@example.com", ""));
});

// ----------------------------------------------------------------------------
// THE `/register` SEAM FIXTURE — ONE definition, shared by §8 and §9c
// ----------------------------------------------------------------------------
//
// Both readers of the invitation row on `/register` read the database, so every
// test of them is built the same way: a reader seam over rows the REAL resolver
// produced — a hand-written row can be written to agree with whatever the code
// happens to do — carrying the canonical triple (a targeted plant, a targeted
// sending church, an open invitation, identical in every other respect).
//
// It is ONE copy on purpose. The triple is the fixture for the single rule this
// whole round exists to state, `isOpenRedeemableInvitation`, so three pasted
// copies differing only in uuid literals would be the same drift risk the
// production fix just removed: a fifth clause added to the predicate must widen
// exactly one fixture. It lives above its first use so the file reads
// top-to-bottom rather than relying on function hoisting.

/** A guessed uuid — an id no fixture row in this file carries. */
const GUESSED_ID = "00000000-0000-4000-8000-000000000000";

/** The three addresses the canonical triple is issued to. */
const TARGETED_PLANTER_EMAIL = "planter@example.com";
const TARGETED_SC_ADMIN_EMAIL = "sc-admin@example.com";
const OPEN_INVITEE_EMAIL = "nobody@example.com";

/** A reader over a fixed row set, counting how far the function got. */
function readerFor(
  rows: InvitationForRegistration[]
): RegistrationInvitationReader & {
  orgLookups: number;
} {
  const seam = {
    orgLookups: 0,
    loadInvitation: async (id: string) =>
      rows.find((row) => row.id === id) ?? null,
    lookupInvitingOrgName: async () => {
      seam.orgLookups += 1;
      return "Dev Church Planting Network";
    },
  };
  return seam;
}

/** The stored row shape `/register` reads, built from what the resolver returned. */
function registrationRowFrom(
  id: string,
  resolved: ReturnType<typeof resolveInvitationRequest>
): InvitationForRegistration {
  assert.ok(resolved.ok, "the resolver refused a request this test needs");
  return {
    id,
    type: resolved.values.type,
    status: "pending",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    inviteeEmail: resolved.values.inviteeEmail,
    targetChurchId: resolved.values.targetChurchId,
    targetSendingChurchId: resolved.values.targetSendingChurchId,
    sendingChurchId: resolved.values.sendingChurchId,
    sendingNetworkId: resolved.values.sendingNetworkId,
  };
}

/**
 * The canonical triple, under caller-chosen ids, plus a reader seam over it.
 *
 * The rows differ ONLY in what the server found behind the address, which is
 * what makes the target the only thing a refusal below can be reacting to. The
 * ids are a parameter because each test wants its own, so a row leaking between
 * tests through a shared seam is impossible.
 */
function threeRowSeam(ids: {
  targetedPlant: string;
  targetedOrg: string;
  open: string;
}) {
  const rows = [
    registrationRowFrom(
      ids.targetedPlant,
      resolveInvitationForResolvedTarget(
        NET_ADMIN,
        { inviteeEmail: TARGETED_PLANTER_EMAIL, inviteAs: "church" },
        { targetChurchId: PLANT }
      )
    ),
    registrationRowFrom(
      ids.targetedOrg,
      resolveInvitationForResolvedTarget(
        NET_ADMIN,
        { inviteeEmail: TARGETED_SC_ADMIN_EMAIL, inviteAs: "sending_church" },
        { targetSendingChurchId: SENDING_CHURCH }
      )
    ),
    registrationRowFrom(
      ids.open,
      resolveInvitationForResolvedTarget(
        NET_ADMIN,
        { inviteeEmail: OPEN_INVITEE_EMAIL, inviteAs: "church" },
        {}
      )
    ),
  ];
  return { rows, seam: readerFor(rows) };
}

// ----------------------------------------------------------------------------
// THE ANONYMOUS POST ANSWERS ONE WAY (Ruling C, #304 round 11, 2026-08-12)
// ----------------------------------------------------------------------------
//
// What stood here until round 11 was three regexes over `register/actions.ts`
// asserting that the mismatch guard existed, in that order, before the insert.
// Every one of them passed for the whole of rounds 8, 9 and 10 while the
// property they stood for — "a session-free POST cannot tell a targeted id from
// an open one from a guessed uuid" — was FALSE, because a regex can only see
// the branch it names and the disclosure was in a different branch
// (`hasValidInvitationBypass`) two files away. That is the fourth guard of this
// family in this track to fail that way; `memory/invariants.md` → Multi-Tenancy
// records the rule that came out of it.
//
// So the decision is a callable now. `invitationActedOnAtRegistration` IS the
// action's whole invitation decision, and it is asserted deepEqual across the
// four rows an attacker can submit — with an address that matches none of them.

test("the anonymous POST acts on no invitation it was not addressed to", async () => {
  const TARGETED_PLANT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const TARGETED_ORG = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const OPEN = "12121212-1212-4121-8121-121212121212";

  // The canonical triple, from `threeRowSeam` above — the SAME fixture §9c
  // holds both readers to, so a fifth clause in `isOpenRedeemableInvitation`
  // widens one definition rather than three copies of it.
  const { seam } = threeRowSeam({
    targetedPlant: TARGETED_PLANT,
    targetedOrg: TARGETED_ORG,
    open: OPEN,
  });

  // The submitted address matches NONE of the three rows — the attacker is
  // probing ids, not answering an invitation.
  const SUBMITTED = "attacker@example.com";

  const decisions = await Promise.all(
    [TARGETED_PLANT, TARGETED_ORG, OPEN, GUESSED_ID].map(async (id) => [
      id,
      invitationActedOnAtRegistration(
        await describeInvitationForRegistration(id, seam),
        SUBMITTED
      ),
    ])
  );

  // FOUR IDS, ONE ANSWER. deepEqual over the whole set rather than four
  // separate `assert.equal(…, null)` calls, because the property is that they
  // AGREE: a diff here names the id that answered differently.
  assert.deepEqual(decisions, [
    [TARGETED_PLANT, null],
    [TARGETED_ORG, null],
    [OPEN, null],
    [GUESSED_ID, null],
  ]);

  // …and the open row is genuinely live, or the four nulls prove nothing: the
  // SAME id with the SAME reader, submitted by the address it names, is acted
  // on. This is the one distinguishable POST the ruling leaves — and it is an
  // invitation being consumed, not a row being read. (The GET is the other,
  // wider half of the residual; see §9c and `memory/invariants.md`.)
  const answered = invitationActedOnAtRegistration(
    await describeInvitationForRegistration(OPEN, seam),
    OPEN_INVITEE_EMAIL
  );
  assert.equal(answered?.id, OPEN);
  assert.equal(answered?.inviteeEmail, OPEN_INVITEE_EMAIL);

  // Casing and stray whitespace are the same person, not a probe.
  assert.equal(
    invitationActedOnAtRegistration(
      await describeInvitationForRegistration(OPEN, seam),
      "  NoBody@Example.COM "
    )?.id,
    OPEN
  );
});

test("no per-row message survives on the anonymous POST", () => {
  // Ruling C as a source fact, which is the honest shape for it: the claim is
  // that a particular STRING BUILDER is not reachable from this endpoint, and
  // its absence is not observable by calling anything. The behavioural half —
  // that all four ids answer identically — is the callable test above; this is
  // what stops the message being wired back in.
  // `register`'s own body, bounded at the next declaration. The old end anchor
  // was the dead `async function createAccountEntities` needle, so this span was
  // 17,669 of the module's 18,951 chars and every assertion below was
  // module-wide rather than about `register`.
  const body = REGISTER.span(
    "export async function register",
    "const DUPLICATE_EMAIL_MESSAGE"
  );

  assert.doesNotMatch(code(body), /invitationEmailMismatchMessage/);
  assert.doesNotMatch(code(REGISTER_ACTIONS), /invitationEmailMismatchMessage/);

  // The decision is made ONCE, above the gate and above the insert, and every
  // later branch reads that one result. `invitationId` — the raw submitted
  // string — must not be what any of them consults.
  assert.match(body, /invitationActedOnAtRegistration\(/);
  assert.ok(
    body.includes(".insert(users)"),
    "the register action no longer inserts the account here — re-aim this check"
  );
  assertInOrder(
    body,
    "register/actions.ts → the register action",
    ["invitationActedOnAtRegistration", "isBetaGateEnabled()"],
    "the invitation decision is made before the beta gate the token bypasses"
  );
  assertInOrder(
    body,
    "register/actions.ts → the register action",
    ["invitationActedOnAtRegistration", ".insert(users)"],
    "the invitation decision is made before an account is created"
  );
  assert.match(
    body,
    /hasValidInvitationBypass\(\s*invitation\?\.id \?\? null,\s*identifier\s*\)/,
    "the gate bypass is handed the decided invitation, not the submitted id"
  );
});

test("an invitation with no address describes nothing to register with", async () => {
  // A row with no `invitee_email` cannot be bound to anybody, so it stops being
  // a registration invitation at all rather than becoming an unbindable one —
  // and the type says so, which is what keeps the form's pre-fill total.
  //
  // Asserted by CALLING both readers since round 11: the guard used to be an
  // inline `if` in `describeInvitationForRegistration` and a regex found it
  // there. It now lives in the shared predicate, and the property worth pinning
  // was never where the line sat — it is that BOTH readers refuse the row.
  const ADDRESSLESS = "18181818-1818-4181-8181-181818181818";
  const addressless: InvitationForRegistration = {
    ...registrationRowFrom(
      ADDRESSLESS,
      resolveInvitationForResolvedTarget(
        NET_ADMIN,
        { inviteeEmail: "nobody@example.com", inviteAs: "church" },
        {}
      )
    ),
    inviteeEmail: "",
  };
  const seam = readerFor([addressless]);

  assert.equal(isOpenRedeemableInvitation(addressless), false);
  assert.equal(
    await describeInvitationForRegistration(ADDRESSLESS, seam),
    null
  );
  // …and it buys no beta-gate bypass either, for ANY submitted address.
  assert.equal(
    await hasValidInvitationBypass(ADDRESSLESS, "nobody@example.com", seam),
    false
  );
  assert.equal(await hasValidInvitationBypass(ADDRESSLESS, "", seam), false);

  // The narrowing that makes the described shape's address non-null.
  assert.match(REGISTER_BETA_GATE, /inviteeEmail: string;/);
});

test("the register form fills the invited address in and locks it", () => {
  // Not the enforcement — that is above — but the half that stops an honest
  // user walking into it. `readOnly`, deliberately not `disabled`: a disabled
  // input is not submitted, so locking it that way would send no address at all.
  assert.match(
    REGISTER_FORM,
    /const emailLockedToInvitation = Boolean\(invitation\)/
  );
  assert.match(REGISTER_FORM, /readOnly=\{emailLockedToInvitation\}/);
  assert.doesNotMatch(REGISTER_FORM, /disabled=\{emailLockedToInvitation\}/);
  assert.match(REGISTER_FORM, /useState\(invitation\?\.inviteeEmail \?\? ""\)/);
  // And it says why the field cannot be edited, wired to the input for a screen
  // reader rather than floating next to it.
  assert.match(REGISTER_FORM, /aria-describedby=\{/);
  assert.match(REGISTER_FORM, /id="email-invitation-note"/);
});

test("the mismatch message says which address the invitation is for", () => {
  // "Wrong address = admin revokes + re-invites" — so the copy has to name the
  // address that WILL work and point at the person who can change it.
  //
  // THE COPY IS RULED AND THE FUNCTION HAS NO CALLER (Ruling C, round 11). It
  // named the invited address, which is safe only where the reader has already
  // been proven to be the invitee — and the anonymous `/register` POST is not
  // that place, so the message was taken off it rather than reworded. The test
  // above (`no per-row message survives on the anonymous POST`) is what keeps
  // it off; this one keeps the copy correct for the invitee-proven surface it
  // returns on.
  const message = invitationEmailMismatchMessage("planter@example.com");
  assert.match(message, /planter@example\.com/);
  assert.match(message, /invite/i);
  assert.doesNotMatch(message, /error|failed|invalid/i);

  // With no address on the row there is nothing to name, and the copy must not
  // pretend otherwise.
  const addressless = invitationEmailMismatchMessage(null);
  assert.doesNotMatch(addressless, /undefined|null/);
  assert.match(addressless, /new one/i);
});

// ----------------------------------------------------------------------------
// 9. The success notice NEVER asserts whether an account exists
//    (#304 ruling 4 item 5, RULED 2026-08-09 — supersedes the HR4 fix that
//    branched the notice)
// ----------------------------------------------------------------------------
//
// The earlier revision returned `/register?invitation=…` for an OPEN invitation
// and `null` for a TARGETED one, and rendered a different notice for each. That
// is the enumeration oracle ruling 2 closed on the REFUSAL path, reopened on the
// success path where it costs an attacker no error at all. The ruling: one
// neutral message for both, and no register link on this surface.

test("the create action returns one success shape, carrying no target signal", () => {
  const action = code(INVITATIONS_ACTIONS);

  // The two columns that answer "does this address already have an account" are
  // the server's alone. Nothing derived from either may be composed into the
  // response — not a boolean, not a nullable path.
  assert.doesNotMatch(action, /result\.invitation\.targetChurchId/);
  assert.doesNotMatch(action, /result\.invitation\.targetSendingChurchId/);
  assert.doesNotMatch(action, /inviteePath/);

  // …and the state type has no key for one to come back in, so a future edit
  // has to change the contract rather than slip a field through it.
  //
  // `emailSent` joined it with OV-003b (#293) and is NOT a target signal: it
  // reports what the mail provider said, which is the same question for an
  // address with an account and one without. The exact shape is asserted so a
  // third key cannot arrive unnoticed.
  assert.match(
    action,
    /created\?: \{ inviteeEmail: string; emailSent\?: boolean \}/
  );
});

test("the create surface renders no register link and no target branch", () => {
  const form = code(CREATE_FORM);

  // No branch on the TARGET shape: one message whatever kind was created. The
  // notice does branch on `emailSent` since OV-003b (#293), which is a fact
  // about the mail provider and not about the address — see the create-action
  // test above and `create-notice.ts`.
  assert.doesNotMatch(form, /inviteePath/);
  assert.doesNotMatch(form, /InviteLink/);
  assert.doesNotMatch(form, /targetChurchId|targetSendingChurchId|isOpen/);

  // The link, its URL composition and the clipboard control are all gone from
  // this surface — `/register` is the invitee's own path, not something an
  // admin is handed to forward. #293 shipped the email the ruling called this
  // link a stopgap for, so it does not come back with delivery.
  assert.doesNotMatch(form, /register\?invitation=/);
  assert.doesNotMatch(form, /invitationRegisterPath/);
  assert.doesNotMatch(form, /clipboard/);
  assert.doesNotMatch(form, /location\.origin/);
  assert.doesNotMatch(form, /Copy link/);

  // The words are no longer JSX — they come from `invitationCreatedNotice`, so
  // the sentences #293's AC names are executable. The component renders them
  // and composes none of its own.
  assert.match(form, /invitationCreatedNotice\(/);
  assert.match(form, /\{notice\.headline\}/);
  assert.match(form, /\{notice\.detail\}/);
  assert.doesNotMatch(form, /already have an EveryField account/);

  // The copy itself, asserted where it now lives. It is true whether or not the
  // address has an account and it names neither, in all three states.
  for (const emailSent of [true, false, undefined]) {
    const { headline, detail } = invitationCreatedNotice({
      inviteeEmail: "someone@example.com",
      emailSent,
    });
    const copy = `${headline} ${detail}`;

    assert.doesNotMatch(copy, /register\?invitation=|this link/i, copy);
    assert.doesNotMatch(copy, /already have an EveryField account/i, copy);

    // DELIVERY-NEUTRAL survives #293 (round 10, ruled 2026-08-11). The copy may
    // now report whether THIS email went out — that is the branch above — but
    // it still promises no answer nobody can give and describes no mechanics.
    for (const mechanic of [
      /you will hear/i,
      /not live yet/i,
      /out of band/i,
    ]) {
      assert.doesNotMatch(copy, mechanic, `${String(mechanic)} — ${copy}`);
    }
  }

  // …and the invitation still sits in the revocable list, said out loud on the
  // one state where nothing was sent to point at instead.
  assert.match(
    invitationCreatedNotice({ inviteeEmail: "someone@example.com" }).detail,
    /sits in the list below/
  );
});

test("no copy on the create surface claims an account does or does not exist", () => {
  // Comments stripped, JSX text kept: the disclosure would be in a rendered
  // sentence, and the comment RECORDING the removed sentence must not be what
  // fails the test (the same reason `code()` exists).
  const rendered = code(CREATE_FORM).split(
    "export function InvitationCreateForm"
  )[1];

  for (const tell of [
    /they already have/i,
    /has not signed up/i,
    /creates their account/i,
    /no link to send/i,
  ]) {
    assert.doesNotMatch(rendered, tell, String(tell));
  }
});

test("the register token wire is untouched by the notice ruling", () => {
  // What item 5 removed is the ADMIN-FACING link, not the token. `/register`
  // still redeems an open invitation — it is what an invitation email will
  // carry — so the register surface's own binding must not have moved.
  assert.match(code(REGISTER_ACTIONS), /invitation/i);
  assert.match(code(REGISTER_FORM), /invitation/i);
});

// ----------------------------------------------------------------------------
// 9b. …and neither does the PENDING LIST, on the same page
//     (#304 ruling 4 item 5, extended 2026-08-09 on the integration verdict)
// ----------------------------------------------------------------------------
//
// The first pass at item 5 fixed the notice and left the oracle standing one
// section below it. `/oversight/invitations` mounts the create form and the
// list together; each row arrived with `isOpen` (both target columns null) and
// the list rendered a `/register?invitation=` Copy-link button on exactly those
// rows. Type an address, read the neutral notice, look at the row that just
// appeared: Copy link present means no EveryField account, absent means there
// is one. Same probe, in a control instead of a sentence, and cheaper — the row
// is already on screen.
//
// It was DEAD CODE before this track: `resolveInvitationTarget` refused every
// address that already had an account, so `isOpen` was always true. #304 revives
// targeting and makes the conditional live. Hence the behavioural test below:
// the two target shapes an admin can now produce must both render one surface.

test("the two target shapes an admin can produce are distinguishable — server-side only", () => {
  // The PREMISE, executed, so this section cannot rot into a tautology: with
  // targeting revived, one admin typing two addresses gets two different rows.
  // Everything after this test is about that difference never being rendered.
  const accountless = resolveInvitationForResolvedTarget(
    NET_ADMIN,
    { inviteeEmail: "nobody@example.com" },
    {}
  );
  const hasAccount = resolveInvitationForResolvedTarget(
    NET_ADMIN,
    { inviteeEmail: "planter@example.com" },
    { targetChurchId: PLANT }
  );

  assert.ok(accountless.ok && hasAccount.ok);
  assert.equal(accountless.values.targetChurchId, null);
  assert.equal(hasAccount.values.targetChurchId, PLANT);
});

// ----------------------------------------------------------------------------
// …AND NEITHER DOES THE ROW'S CAPTION
// (#304 ruling 4 item 5, extended a SECOND time, 2026-08-10)
// ----------------------------------------------------------------------------
//
// The attempt above removed `isOpen` and the Copy-link button, and left the
// oracle standing ONE FIELD OVER on the same row. The caption was
//
//     kindLabel: invitation.type === "sending_church_to_network"
//       ? "Sending church" : "Church plant"
//
// and `type` is target-derived as well: `resolveInvitationRequest` picks the
// kind from the RESOLVED target and falls back to the admin's `inviteAs` only
// when there is no target. Executed, the four combinations an admin can produce
// were:
//
//     inviteAs=church,         accountless   -> "Church plant"
//     inviteAs=church,         sc-admin addr -> "Sending church"
//     inviteAs=sending_church, accountless   -> "Sending church"
//     inviteAs=sending_church, planter addr  -> "Church plant"
//
// i.e. the caption equalled the admin's own selection when the address had no
// EveryField account and flipped when it had one of the other kind. One
// submission, no error, same screen.
//
// WHY EVERY GUARD ABOVE MISSED IT, and what this section does instead. The
// checks were regexes over `page.tsx` (`/targetChurchId/`, `/isOpen/`) plus an
// allowed-field set that WHITELISTED `kindLabel` — all of them passed while the
// property was false, because the derivation was transitive through `type`. A
// regex cannot follow that. So the row mapping is now one exported pure
// function, `toInvitationListRow`, and the test below CALLS it: it runs the
// real resolver for the two target shapes an admin can produce and asserts the
// rendered row is byte-identical. Any field that varies with the target — named
// after `type`, `targetChurchId` or anything else — fails it whatever it is
// called. The regexes are kept as a cheap second net, never as the proof.

/** One stored invitation row, built from what the resolver actually returned. */
function storedRowFrom(resolved: ReturnType<typeof resolveInvitationRequest>) {
  assert.ok(resolved.ok, "the resolver refused a request this test needs");
  const sentAt = new Date("2026-08-10T15:00:00.000Z");
  return {
    id: "99999999-9999-4999-8999-999999999999",
    ...resolved.values,
    status: "pending" as const,
    createdAt: sentAt,
    expiresAt: new Date("2026-08-24T15:00:00.000Z"),
    respondedAt: null,
    respondedBy: null,
  };
}

test("the rendered row is identical for an accountless address and for one with an account of the other kind", () => {
  // A network admin submits the SAME form selection twice. The only difference
  // is what the server found behind each address — which is exactly the fact
  // item 5 says the admin may not learn from this page.
  for (const inviteAs of ["church", "sending_church"] as const) {
    const accountless = storedRowFrom(
      resolveInvitationForResolvedTarget(
        NET_ADMIN,
        { inviteeEmail: "nobody@example.com", inviteAs },
        {}
      )
    );
    // The other kind, so `type` flips: a plant for "sending_church", a sending
    // church for "church".
    const withAccount = storedRowFrom(
      resolveInvitationForResolvedTarget(
        NET_ADMIN,
        { inviteeEmail: "nobody@example.com", inviteAs },
        inviteAs === "sending_church"
          ? { targetChurchId: PLANT }
          : { targetSendingChurchId: SENDING_CHURCH }
      )
    );

    // The premise: the two rows really are different on the server, so this is
    // not a tautology. If targeting is ever refused again this fails loudly
    // rather than passing vacuously.
    assert.notEqual(
      accountless.type,
      withAccount.type,
      `inviteAs=${inviteAs}: the two target shapes produced the same type`
    );

    // The property: one rendered row for both.
    assert.deepEqual(
      toInvitationListRow(accountless),
      toInvitationListRow(withAccount),
      `inviteAs=${inviteAs}: the row differs with what the server found behind the address`
    );
  }
});

test("no row field on the invitations page is derived from a target column", () => {
  const page = code(INVITATIONS_PAGE);
  const listRow = code(LIST_ROW);

  // The mapping that builds `InvitationListRow[]` — now `toInvitationListRow`,
  // with the page holding only the call. Neither target column may be read in
  // either, and neither may `type`, which is computed from them (that is the
  // derivation both previous attempts missed).
  for (const source of [page, listRow]) {
    assert.doesNotMatch(source, /targetChurchId/);
    assert.doesNotMatch(source, /targetSendingChurchId/);
    assert.doesNotMatch(source, /isOpen/);
    assert.doesNotMatch(source, /invitation\.type/);
    assert.doesNotMatch(source, /kindLabel/);
  }

  // The row type is the contract, so a future edit has to change the type
  // rather than slip a field through it.
  assert.doesNotMatch(code(INVITATIONS_LIST), /isOpen/);
  assert.doesNotMatch(code(INVITATIONS_LIST), /kindLabel/);
});

test("the pending list renders no register link and no per-row variation", () => {
  const list = code(INVITATIONS_LIST);

  // The control, its URL composition and the clipboard call are all gone.
  assert.doesNotMatch(list, /register\?invitation=/);
  assert.doesNotMatch(list, /clipboard/);
  assert.doesNotMatch(list, /location\.origin/);
  assert.doesNotMatch(list, /Copy link/);

  // Every pending row renders the SAME controls. The only row fields this
  // component may read are the five `toInvitationListRow` builds — `status` is
  // the invitee's own answer and may branch; a sixth field is how the oracle
  // came back BOTH previous times, so it has to be added here deliberately.
  // Adding one here is not enough on its own: the deep-equal test above is what
  // decides whether it varies with the target.
  const allowed = new Set([
    "id",
    "inviteeEmail",
    "status",
    "sentLabel",
    "expiresLabel",
  ]);
  const readFields = new Set(
    [...list.matchAll(/\brow\.(\w+)/g)].map((match) => match[1])
  );
  assert.ok(readFields.size > 0, "the component reads no row fields at all");
  for (const field of readFields) {
    assert.ok(allowed.has(field), `row.${field} is not an allowed row field`);
  }
});

// ----------------------------------------------------------------------------
// 9c. …AND NEITHER DOES `/register` — the oracle one route over
//     (#304 round 10, RULED 2026-08-11)
// ----------------------------------------------------------------------------
//
// Items 5, its extension to the page, and its extension to the caption all
// closed the account-existence question on `/oversight/invitations`. The same
// question stayed answerable on the PUBLIC register route, and this track is
// what armed it: `describeInvitationForRegistration` returned
//
//     redeemable: targetChurchId === null && targetSendingChurchId === null
//
// and `register-form.tsx` branched the whole rendered form on it. On `main`
// that was inert — every creatable invitation was open, so the flag was
// constant true. #304 revives targeting and makes it live, which is the same
// "reviving a refused path re-arms every conditional that was only safe
// because the path was dead" lesson `list-row.ts` records about `kindLabel`.
//
// THE ATTACK needs no session and no error. An admin types any address, reads
// the deliberately neutral notice, takes the new row's id — which is in their
// own DOM by design, since Revoke needs it — and opens
// `/register?invitation=<id>` in a private window.
//
// THE FIX is a null-return for any targeted row, so a targeted token and a
// guessed uuid produce byte-identical pages, and `redeemable` is DELETED rather
// than left constant.
//
// PINNED BY CALLING THE FUNCTION. Every previous guard of this family was a
// regex over a page and every one of them passed while the property was false.
// The function reads the database, so it is called through the reader seam
// `threeRowSeam` builds (defined above §8, one copy for all three tests) with
// rows the REAL resolver produced — the same technique §9b uses, for the same
// reason: a hand-written row can be written to agree with whatever the code
// does.

test("/register cannot describe a targeted invitation, and says nothing about a guessed uuid", async () => {
  const TARGETED_PLANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const TARGETED_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const OPEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  const { rows, seam } = threeRowSeam({
    targetedPlant: TARGETED_PLANT,
    targetedOrg: TARGETED_ORG,
    open: OPEN,
  });

  // THE PREMISE: these rows differ only in what the server found behind the
  // address. Everything else about them — pending, unexpired, addressed, from
  // an org whose name resolves — is identical, so the target is the ONLY reason
  // an answer below can be null.
  assert.equal(rows[0].targetChurchId, PLANT);
  assert.equal(rows[1].targetSendingChurchId, SENDING_CHURCH);
  assert.equal(rows[2].targetChurchId, null);
  assert.equal(rows[2].targetSendingChurchId, null);

  // The three nulls, deep-equal so a `{}` or an `undefined` cannot pass as one.
  assert.deepEqual(
    await describeInvitationForRegistration(TARGETED_PLANT, seam),
    null,
    "a resolved-church target is describable to /register"
  );
  assert.deepEqual(
    await describeInvitationForRegistration(TARGETED_ORG, seam),
    null,
    "a resolved-sending-church target is describable to /register"
  );
  assert.deepEqual(
    await describeInvitationForRegistration(GUESSED_ID, seam),
    null
  );

  // The refusal happens BEFORE anything else is read, so a targeted token and a
  // guessed uuid cost the same work as well as returning the same answer.
  assert.equal(seam.orgLookups, 0, "a targeted row reached the org lookup");

  // …and the OPEN row still describes, or the three nulls above prove nothing.
  // That asymmetry is the GET half of the accepted residual (`memory/
  // invariants.md` → Multi-Tenancy): an open row renders the redeeming form
  // where the other three render the plain page, and it is inherent to
  // invite-at-registration.
  const open = await describeInvitationForRegistration(OPEN, seam);
  assert.ok(open, "an open invitation stopped describing");
  assert.equal(open.inviteeEmail, OPEN_INVITEE_EMAIL);
  assert.equal(open.accountType, "planter");
});

test("the register invitation shape carries no redeemable flag, and nothing branches on one", async () => {
  const OPEN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const seam = readerFor([
    registrationRowFrom(
      OPEN,
      resolveInvitationForResolvedTarget(
        NET_ADMIN,
        { inviteeEmail: "nobody@example.com", inviteAs: "sending_church" },
        {}
      )
    ),
  ]);

  const open = await describeInvitationForRegistration(OPEN, seam);
  assert.ok(open);
  // The shape that crosses to the client. `redeemable` was the field that
  // varied with the two target columns; it is gone, not merely always true.
  assert.deepEqual(Object.keys(open).sort(), [
    "accountType",
    "id",
    "inviteeEmail",
    "invitingOrgName",
  ]);
  // An OPEN `sending_church_to_network` row still registers a SENDING CHURCH —
  // which is why `accountType` survived the deletion. `type` follows the
  // admin's own `inviteAs` here, because there was no target to derive it from.
  assert.equal(open.accountType, "sending_church");

  // The second net, never the proof: no client-side branch on redeemability
  // survives in the form or in the action that redeems.
  for (const source of [code(REGISTER_FORM), code(REGISTER_ACTIONS)]) {
    assert.doesNotMatch(source, /redeemable/);
    assert.doesNotMatch(source, /const redeeming/);
  }
  assert.doesNotMatch(code(REGISTER_BETA_GATE), /redeemable/);
});

// ----------------------------------------------------------------------------
// 9c (round 11, RULED 2026-08-12). …AND NEITHER DOES THE OTHER READER.
// ----------------------------------------------------------------------------
//
// Round 10 fixed `describeInvitationForRegistration` and stopped. The same row
// is read a SECOND time on the same route by `hasValidInvitationBypass` — the
// other thing an invitation token buys — and that reader kept its own copy of
// the rule: pending, expiry, address, and no target check. With
// `BETA_INVITE_CODE` set, that copy was the whole oracle back, on the POST
// instead of the GET.
//
// The fix is not a third copy of four guards. It is one exported predicate,
// `isOpenRedeemableInvitation`, that both readers call — and these tests hold
// them to it BY CALLING BOTH, through the seam the bypass gained for exactly
// this reason.

test("the beta-gate bypass reads the row by the SAME rule, not its own", async () => {
  // THE ROUND-11 HOLE ITSELF. `hasValidInvitationBypass` is the second reader of
  // the same row on the same public route, and until 2026-08-12 it checked only
  // pending + expiry + address — so with `BETA_INVITE_CODE` set, a targeted id
  // bypassed the gate (and the response became "an account with this email
  // already exists") while a guessed uuid did not (`BETA_GATE_ERROR`). Two
  // responses, no session, one question answered.
  //
  // Asserted by CALLING it through the reader seam it gained for this purpose.
  const TARGETED_PLANT = "13131313-1313-4131-8131-131313131313";
  const TARGETED_ORG = "14141414-1414-4141-8141-141414141414";
  const OPEN = "15151515-1515-4151-8151-151515151515";

  const { seam } = threeRowSeam({
    targetedPlant: TARGETED_PLANT,
    targetedOrg: TARGETED_ORG,
    open: OPEN,
  });

  // Each id is submitted with THE ADDRESS THAT ROW NAMES — the strongest form
  // of the claim, because the address check cannot be what refuses the targeted
  // rows. Only the target columns can.
  const bypasses = await Promise.all(
    (
      [
        [TARGETED_PLANT, TARGETED_PLANTER_EMAIL],
        [TARGETED_ORG, TARGETED_SC_ADMIN_EMAIL],
        [GUESSED_ID, TARGETED_PLANTER_EMAIL],
        [OPEN, OPEN_INVITEE_EMAIL],
      ] as const
    ).map(async ([id, email]) => [
      id,
      await hasValidInvitationBypass(id, email, seam),
    ])
  );

  assert.deepEqual(bypasses, [
    [TARGETED_PLANT, false],
    [TARGETED_ORG, false],
    [GUESSED_ID, false],
    // The premise. Without this the three falses are satisfied by a bypass that
    // refuses everything.
    [OPEN, true],
  ]);

  // A forwarded OPEN link is still not a bearer token: the right id with the
  // wrong address buys nothing either.
  assert.equal(
    await hasValidInvitationBypass(OPEN, "attacker@example.com", seam),
    false
  );
  assert.equal(await hasValidInvitationBypass(null, OPEN_INVITEE_EMAIL), false);
});

test("ONE definition decides what /register may act on", async () => {
  // The structural half of the ruling, and the reason the two tests above stay
  // true: `isOpenRedeemableInvitation` is the single exported predicate, and
  // BOTH readers of the row on this route call it. Round 11 happened because
  // round 10 fixed one reader and left the other with its own copy of a
  // four-clause rule; a second copy is what drifts.
  const OPEN = "16161616-1616-4161-8161-161616161616";
  const open = registrationRowFrom(
    OPEN,
    resolveInvitationForResolvedTarget(
      NET_ADMIN,
      { inviteeEmail: OPEN_INVITEE_EMAIL, inviteAs: "church" },
      {}
    )
  );

  assert.equal(isOpenRedeemableInvitation(open), true);

  // The four clauses, each falsified on its own from that one accepted row —
  // so the predicate is the whole rule and not three-quarters of it.
  assert.equal(
    isOpenRedeemableInvitation({ ...open, status: "accepted" }),
    false
  );
  assert.equal(
    isOpenRedeemableInvitation({ ...open, expiresAt: new Date(0) }),
    false
  );
  assert.equal(
    isOpenRedeemableInvitation({ ...open, inviteeEmail: "" }),
    false
  );
  assert.equal(
    isOpenRedeemableInvitation({ ...open, targetChurchId: PLANT }),
    false
  );
  assert.equal(
    isOpenRedeemableInvitation({
      ...open,
      targetSendingChurchId: SENDING_CHURCH,
    }),
    false
  );

  // Expiry is judged against the `now` the caller passes, not only the wall
  // clock — the shipped readers pass none, so this is what pins the boundary.
  const expiring = { ...open, expiresAt: new Date(1_000) };
  assert.equal(isOpenRedeemableInvitation(expiring, new Date(999)), true);
  assert.equal(isOpenRedeemableInvitation(expiring, new Date(1_001)), false);

  // BOTH READERS, ONE RULE. Not a grep for the identifier: the same row that
  // the predicate refuses is refused by each reader, and the row it accepts is
  // accepted by each.
  const REFUSED = "17171717-1717-4171-8171-171717171717";
  const refused = { ...open, id: REFUSED, targetChurchId: PLANT };
  const seam = readerFor([open, refused]);

  assert.equal(await describeInvitationForRegistration(REFUSED, seam), null);
  assert.equal(
    await hasValidInvitationBypass(REFUSED, OPEN_INVITEE_EMAIL, seam),
    false
  );
  assert.ok(await describeInvitationForRegistration(OPEN, seam));
  assert.equal(
    await hasValidInvitationBypass(OPEN, OPEN_INVITEE_EMAIL, seam),
    true
  );

  // THE SECOND NET, never the proof (the calls above are the proof): the target
  // comparison appears in the module exactly where the predicate defines it. A
  // reader that grows its own copy — which is literally what round 11 removed —
  // fails here by count, before the two readers have had time to drift apart.
  const gate = code(REGISTER_BETA_GATE);
  assert.equal(
    (gate.match(/targetChurchId === null/g) ?? []).length,
    1,
    "a second copy of the open-invitation rule appeared in beta-gate.ts"
  );
  assert.equal(
    (gate.match(/targetSendingChurchId === null/g) ?? []).length,
    1,
    "a second copy of the open-invitation rule appeared in beta-gate.ts"
  );
  // …and both readers reach it by NAME, so neither can be reverted to an
  // inline `if` without this failing.
  for (const reader of [
    "export async function describeInvitationForRegistration",
    "export async function hasValidInvitationBypass",
  ]) {
    const body = sourceReader(
      gate,
      "register/beta-gate.ts (comments stripped)"
    ).after(reader);
    // Inside its OWN body: the opening brace, the call, then the first
    // top-level `}` — so a call that drifted into the next declaration fails
    // here too.
    assertInOrder(
      body,
      `register/beta-gate.ts → ${reader} (comments stripped)`,
      ["{", "isOpenRedeemableInvitation(", "\n}\n"],
      `${reader} no longer calls the shared predicate inside its own body`
    );
  }
});
