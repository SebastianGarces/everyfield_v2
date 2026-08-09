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
import {
  invitationEmailMismatchMessage,
  registrationEmailMatchesInvitation,
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
const REGISTER_ACTIONS = read("app", "(auth)", "register", "actions.ts");
const REGISTER_FORM = read("app", "(auth)", "register", "register-form.tsx");
const REGISTER_BETA_GATE = read("app", "(auth)", "register", "beta-gate.ts");

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
  const schema = INVITATIONS_ACTIONS.slice(
    INVITATIONS_ACTIONS.indexOf("const createSchema"),
    INVITATIONS_ACTIONS.indexOf("const revokeSchema")
  );
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
  const body = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function createInvitationAs"),
    CORE_CODE.indexOf("// Respond")
  );

  assert.match(body, /await assertTargetSlotFree\(resolved\.values\)/);
  assert.ok(
    body.indexOf("assertTargetSlotFree") < body.indexOf("insertInvitation"),
    "the slot is checked BEFORE the row is written"
  );

  // …and the ROLE is settled before either. `resolveInvitationTarget` reads
  // `users` and tells "no such account" apart from "a planter with no church",
  // which is an account-enumeration oracle: it must be unreachable to anyone
  // who may not invite at all. The authority call is pure and takes no target,
  // so it can run first without a lookup.
  assert.ok(
    body.indexOf("const authority = resolveInvitationRequest") <
      body.indexOf("resolveInvitationTarget"),
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
  const guard = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function assertTargetSlotFree"),
    CORE_CODE.indexOf("export function slotRefusalMessage")
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
  const body = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function createInvitationAs"),
    CORE_CODE.indexOf("// Respond")
  );
  const calls = code(body).match(/resolveInvitation\w*\(/g) ?? [];

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
  const inputs = INVITATIONS_ACTIONS.slice(
    INVITATIONS_ACTIONS.indexOf("const createSchema"),
    INVITATIONS_ACTIONS.indexOf("const result = await createInvitation")
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
  const setClause = sql.slice(sql.indexOf(" set "), sql.indexOf(" where "));
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
  const body = REGISTER_ACTIONS.slice(
    REGISTER_ACTIONS.indexOf("async function redeemRegistrationInvitation")
  );
  assert.ok(
    body.indexOf("bindOpenInvitationTarget") <
      body.indexOf("acceptInvitationAs"),
    "the target must be bound before the invitation is accepted"
  );

  // And the actor is minted, never assembled — the same rule every other
  // invitation mutation follows.
  assert.match(body, /invitationActorFromSession\(\{ user \}\)/);

  // The association itself is never written here: `createAccountEntities` must
  // not set an oversight FK, or a plant could be bound with no acceptance.
  const entities = REGISTER_ACTIONS.slice(
    REGISTER_ACTIONS.indexOf("async function createAccountEntities"),
    REGISTER_ACTIONS.indexOf("async function redeemRegistrationInvitation")
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
  const target = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function resolveInvitationTarget"),
    CORE_CODE.indexOf("export async function assertTargetSlotFree")
  );
  assert.match(target, /return inviteeAccountTarget\(existing\)/);
  // The projection is the three columns the pure mapper reads — and nothing
  // else. Selecting the row would pull `password_hash` into memory to answer
  // "which org is this".
  assert.doesNotMatch(target, /\.select\(\)/);

  const create = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function createInvitationAs"),
    CORE_CODE.indexOf("// Respond")
  );
  assert.match(create, /await resolveInvitationTarget\(inviteeEmail\)/);
  assert.ok(
    create.indexOf("resolveInvitationTarget") <
      create.indexOf("insertInvitation"),
    "the address is judged BEFORE the row is written"
  );
  // Authority still comes first: this refusal is itself an account-existence
  // oracle, so it must be unreachable to anyone who may not invite at all.
  assert.ok(
    create.indexOf("const authority = resolveInvitationRequest") <
      create.indexOf("resolveInvitationTarget"),
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

test("the mismatch is refused server-side, before an account exists", () => {
  // The rule lives in the ACTION, not in the pre-filled field: this endpoint is
  // a POST that never saw the form. The refusal is returned before the account
  // is created and before the beta gate, which the same token also bypasses.
  const body = REGISTER_ACTIONS.slice(
    REGISTER_ACTIONS.indexOf("export async function register"),
    REGISTER_ACTIONS.indexOf("async function createAccountEntities")
  );

  assert.match(
    body,
    /!registrationEmailMatchesInvitation\(invitation\.inviteeEmail, identifier\)/
  );
  assert.match(
    body,
    /invitationEmailMismatchMessage\(invitation\.inviteeEmail\)/
  );
  assert.ok(
    body.includes(".insert(users)"),
    "the register action no longer inserts the account here — re-aim this check"
  );
  assert.ok(
    body.indexOf("registrationEmailMatchesInvitation") <
      body.indexOf(".insert(users)"),
    "the address is checked before an account is created"
  );
  assert.ok(
    body.indexOf("registrationEmailMatchesInvitation") <
      body.indexOf("isBetaGateEnabled()"),
    "the address is checked before the beta gate it would otherwise bypass"
  );

  // The bypass is bound to the address too — otherwise a forwarded link stayed
  // a free pass into a private beta for whoever received it.
  assert.match(body, /hasValidInvitationBypass\(invitationId, identifier\)/);
  const bypass = REGISTER_BETA_GATE.slice(
    REGISTER_BETA_GATE.indexOf("export async function hasValidInvitationBypass")
  );
  assert.match(bypass, /registrationEmailMatchesInvitation\(/);
});

test("an invitation with no address describes nothing to register with", () => {
  // `describeInvitationForRegistration` is what the page and the action both
  // read. A row with no `invitee_email` cannot be bound to anybody, so it stops
  // being a registration invitation at all rather than becoming an unbindable
  // one — and the type says so, which is what keeps the form's pre-fill total.
  const describe = REGISTER_BETA_GATE.slice(
    REGISTER_BETA_GATE.indexOf(
      "export async function describeInvitationForRegistration"
    )
  );
  assert.match(describe, /if \(!invitation\.inviteeEmail\) return null/);
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
  // address that WILL work and point at the person who can change it. The link
  // holder can already see that address on this page (the field is pre-filled
  // from the token), so naming it in the error leaks nothing new.
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
// 9. The success notice may only offer a link that works (#304, HR4 2026-08-09)
// ----------------------------------------------------------------------------

test("a targeted invitation is created with no register link at all", () => {
  const action = code(INVITATIONS_ACTIONS);

  // The distinction is read off the ROW the server just wrote, never guessed
  // from the address: `resolveInvitationTarget` is the only thing that knows
  // whether an account was found, and it answered inside the service.
  assert.match(action, /result\.invitation\.targetChurchId !== null/);
  assert.match(action, /result\.invitation\.targetSendingChurchId !== null/);
  assert.match(action, /inviteePath: targeted\s*\?\s*null/);

  // …and the type says null is possible, so the surface cannot forget the case.
  assert.match(
    action,
    /created\?: \{ inviteePath: string \| null; inviteeEmail: string \}/
  );
});

test("the notice branches on the null path rather than rendering a dead link", () => {
  const form = code(CREATE_FORM);

  // `/register` is the ONE place that link goes, and somebody who already has
  // an account cannot register again — so a targeted invitation's admin was
  // previously handed a dead end to forward, with a Copy button on it.
  assert.match(form, /created\.inviteePath === null/);

  // The link, the URL and the clipboard all live in the branch that has a path.
  const link = form.slice(form.indexOf("function InviteLink"));
  assert.match(link, /navigator\.clipboard\.writeText/);
  assert.match(link, /window\.location\.origin/);

  // Nothing outside that component composes the register URL, so the null case
  // cannot reach one by another route.
  const outsideLink = form.slice(0, form.indexOf("function InviteLink"));
  assert.doesNotMatch(outsideLink, /clipboard/);
  assert.doesNotMatch(outsideLink, /location\.origin/);

  // The copy for a targeted invitation says where the answer will happen. An
  // admin who is told "created" and given nothing to do is the failure this
  // branch exists to prevent.
  assert.match(form, /waiting for them in their own settings/);
});

test("the register path is still handed over for an OPEN invitation", () => {
  // The other half of the branch, and the one that must not regress: with no
  // account behind the address the link IS the delivery mechanism — email
  // delivery is not part of this surface yet.
  assert.match(
    code(INVITATIONS_ACTIONS),
    /\/register\?invitation=\$\{result\.invitation\.id\}/
  );
  assert.match(
    code(CREATE_FORM),
    /<InviteLink path=\{created\.inviteePath\} \/>/
  );
});
