import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ALREADY_OURS_MESSAGE,
  SLOT_TAKEN_MESSAGE,
  bindOpenInvitationTargetQuery,
  isInvitationTargetKind,
  normalizeInviteeEmail,
  resolveInvitationRequest,
  type InvitationActor,
} from "./core";

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
// ============================================================================

const ROOT = path.join(process.cwd(), "src");

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
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
const REGISTER_ACTIONS = read("app", "(auth)", "register", "actions.ts");
const REGISTER_FORM = read("app", "(auth)", "register", "register-form.tsx");

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

test("the two refusals say different things", () => {
  // "already yours" and "belongs to somebody else" are different facts and lead
  // to different next actions (nothing to do vs. ask them to leave that org
  // first, #277/#278). They must not read alike — the same rule
  // `lostClaimReason` follows for accept-time refusals.
  assert.notEqual(SLOT_TAKEN_MESSAGE, ALREADY_OURS_MESSAGE);
  for (const message of [SLOT_TAKEN_MESSAGE, ALREADY_OURS_MESSAGE]) {
    assert.ok(message.length > 20, message);
    assert.doesNotMatch(message, /error|failed|invalid/i);
  }
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
