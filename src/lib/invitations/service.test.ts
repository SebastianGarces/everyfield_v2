import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  INVITATION_EXPIRY_DAYS,
  InvitationError,
  MAX_EXPIRY_DAYS,
  NOT_AUTHORIZED_MESSAGE,
  invitationActorFromSession,
  getInvitation,
  isUuid,
  resolveInvitationRequest,
  respondToInvitationQuery,
  revokeInvitationQuery,
  verifyInvitationAuthority,
  type InvitationActor,
} from "./core";

// ============================================================================
// Invitations — the auth surface (#265).
//
// The AC: "no unauthenticated state-changing invitation action remains
// reachable: every action derives its actor from verifySession(); helpers not
// meant to be endpoints move out of the 'use server' module — verify: grep + a
// forged POST with a foreign respondingUser changes nothing".
//
// Three halves, and this file covers all three.
//
// 1. STRUCTURAL — in a `"use server"` module every export is a POSTable
//    endpoint, so what is EXPORTED there is the security property. `service.ts`
//    cannot be imported into a bare node:test process (it would drag
//    `next/headers` in through `verifySession`), so its shape is asserted from
//    its source — the same technique `src/app/(dashboard)/settings/actions.test.ts`
//    uses. This is the "grep" the AC asks for, executable.
//
// 2. FORGERY — a forged POST cannot supply an actor because no action takes
//    one, and the create path derives the INVITING ORG from the session too, so
//    ids smuggled onto the payload are absent from the row that gets written.
//    The compile-time half is the `@ts-expect-error`s below: a bare user object
//    is not an `InvitationActor`, and `pnpm typecheck` enforces that.
//
// 3. AUTHORITY — the check that stood between an anonymous request and a
//    stranger's association, now unit-tested per invitation type.
//
// What is NOT here: the compare-and-set on `status = 'pending'` in accept and
// decline needs a database (the G3 harness, `scripts/g3-oversight-model.ts`,
// runs the real accept path end to end).
// ============================================================================

const SRC = path.join(process.cwd(), "src");
const INVITATIONS_DIR = path.join(SRC, "lib/invitations");
const SERVICE_PATH = path.join(INVITATIONS_DIR, "service.ts");
const CORE_PATH = path.join(INVITATIONS_DIR, "core.ts");

/**
 * A module with its comments removed. The absence assertions below are about
 * CODE: both modules explain the rule by naming the shapes it forbids
 * (`respondingUser`, `db.`), so documenting the fix would otherwise break the
 * test that enforces it.
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const SERVICE_CODE = codeOf(SERVICE_PATH);
const CORE_CODE = codeOf(CORE_PATH);

// ----------------------------------------------------------------------------
// 1. Structural — the endpoint surface
// ----------------------------------------------------------------------------

test("every exported invitation action mints its actor from the session", () => {
  // Not "most of them". An action added later that resolved its user any other
  // way would be the one loose write path, and that is exactly the shape of bug
  // this counts.
  const exported = SERVICE_CODE.match(/export async function /g) ?? [];
  const minted =
    SERVICE_CODE.match(
      /invitationActorFromSession\(await verifySession\(\)\)/g
    ) ?? [];

  assert.ok(exported.length > 0, "no exported actions found — check the path");
  assert.equal(minted.length, exported.length);
});

test("no invitation action accepts an actor, anywhere", () => {
  // The forged-POST assertion, structurally: a user id in this module could
  // only have come from the client. `respondingUser` and `revokingUserId` were
  // the two parameters that made an anonymous POST able to act as somebody
  // else; their absence is the fix.
  for (const forbidden of [
    /respondingUser/,
    /revokingUserId/,
    /inviterUserId/,
    /userId/,
    /user_id/,
    /formData/,
    /searchParams/,
    /\bparams\b/,
  ]) {
    assert.doesNotMatch(SERVICE_CODE, forbidden, String(forbidden));
  }
});

test("the invitation actions do not reach the database directly", () => {
  // Every write goes through `./core`, which is where the authority checks and
  // the actor brand are. A raw `db.update(organizationInvitations)` here would
  // bypass both while still type-checking.
  assert.doesNotMatch(SERVICE_CODE, /from "@\/db"(?!;\s*$)/);
  assert.doesNotMatch(SERVICE_CODE, /\bdb\./);
  assert.match(SERVICE_CODE, /from "\.\/core"/);
});

test("nothing but the four lifecycle mutations is an endpoint", () => {
  // The eleven exports are the finding. Reads, the association primitives and
  // the row builders are not endpoints and must not reappear here: a read
  // exported from a `"use server"` module is an unauthenticated data leak, and
  // `disassociateChurchFromSendingChurch(churchId)` was a state change any
  // anonymous POST could aim at any church.
  const exported = [
    ...SERVICE_CODE.matchAll(/export async function (\w+)/g),
  ].map((match) => match[1]);

  assert.deepEqual(exported.sort(), [
    "acceptInvitation",
    "createInvitation",
    "declineInvitation",
    "revokeInvitation",
  ]);
});

test("the logic layer is not a 'use server' module", () => {
  // `./core` holds every read, the association writes, and the actor-explicit
  // mutations. The absence of the directive is what makes them unreachable from
  // a browser — with it, all of them would be endpoints again.
  assert.doesNotMatch(CORE_CODE, /"use server"/);
  assert.doesNotMatch(CORE_CODE, /'use server'/);
  assert.match(SERVICE_CODE, /^"use server";/);
});

test("no other 'use server' module re-exports the invitation logic layer", () => {
  // The loophole this closes: `export { disassociateChurchFromNetwork } from
  // "@/lib/invitations/core"` inside any action file would restore the endpoint
  // this ticket removed, somewhere nobody would think to look.
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (full === SERVICE_PATH) continue;

      const source = readFileSync(full, "utf8");
      if (!/^["']use server["'];/m.test(source)) continue;
      if (/invitations\/core/.test(source)) {
        offenders.push(path.relative(process.cwd(), full));
      }
    }
  };

  walk(SRC);

  assert.deepEqual(offenders, []);
});

// ----------------------------------------------------------------------------
// 2. The actor — minted from a session, and from nothing else
// ----------------------------------------------------------------------------

const PLANT = "11111111-1111-4111-8111-111111111111";
const OTHER_PLANT = "aaaaaaaa-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const OTHER_SENDING_CHURCH = "bbbbbbbb-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const PLANTER_ID = "44444444-4444-4444-8444-444444444444";
const FOREIGN_ID = "55555555-5555-4555-8555-555555555555";

function actor(overrides: {
  id?: string;
  role: InvitationActor["role"];
  churchId?: string | null;
  sendingChurchId?: string | null;
  sendingNetworkId?: string | null;
}): InvitationActor {
  return invitationActorFromSession({
    user: {
      id: overrides.id ?? PLANTER_ID,
      role: overrides.role,
      churchId: overrides.churchId ?? null,
      sendingChurchId: overrides.sendingChurchId ?? null,
      sendingNetworkId: overrides.sendingNetworkId ?? null,
    },
  });
}

const PLANTER = actor({ role: "planter", churchId: PLANT });
const FOREIGN_PLANTER = actor({
  id: FOREIGN_ID,
  role: "planter",
  churchId: OTHER_PLANT,
});
const TEAM_MEMBER = actor({ role: "team_member", churchId: PLANT });
const SC_ADMIN = actor({
  role: "sending_church_admin",
  sendingChurchId: SENDING_CHURCH,
});
const NETWORK_ADMIN = actor({
  role: "network_admin",
  sendingNetworkId: NETWORK,
});

test("an actor carries the session's identity and nothing else", () => {
  // Derived, not passed through: a whole user row goes in and only the five
  // fields authority is decided on come out, so a password hash can never ride
  // along into a check or a log line.
  const minted = invitationActorFromSession({
    user: {
      id: PLANTER_ID,
      role: "planter",
      churchId: PLANT,
      sendingChurchId: null,
      sendingNetworkId: null,
      // @ts-expect-error extra fields on a real `User` must not survive the mint
      passwordHash: "argon2id$secret",
      email: "planter@example.test",
    },
  });

  assert.deepEqual(Object.keys(minted).sort(), [
    "churchId",
    "id",
    "role",
    "sendingChurchId",
    "sendingNetworkId",
  ]);
  assert.equal(minted.id, PLANTER_ID);
});

test("a user object off the wire is not an actor", () => {
  // The compile-time half of the AC. `respondingUser` used to be an argument,
  // so a forged POST could name anyone; now the only way to obtain an
  // `InvitationActor` is to mint one from a session, and an unused
  // `@ts-expect-error` is itself an error, so this cannot rot.
  const forged = {
    id: FOREIGN_ID,
    role: "planter" as const,
    churchId: PLANT,
    sendingChurchId: null,
    sendingNetworkId: null,
  };

  const call = () =>
    verifyInvitationAuthority(
      {
        type: "church_to_network",
        targetChurchId: PLANT,
        targetSendingChurchId: null,
      },
      // @ts-expect-error a plain object is not proof of a session
      forged
    );

  assert.equal(typeof call, "function");
});

// ----------------------------------------------------------------------------
// 3. Authority — per invitation type
// ----------------------------------------------------------------------------

const CHURCH_INVITATION = {
  type: "church_to_sending_church" as const,
  targetChurchId: PLANT,
  targetSendingChurchId: null,
};

const NETWORK_INVITATION = {
  type: "church_to_network" as const,
  targetChurchId: PLANT,
  targetSendingChurchId: null,
};

const SENDING_CHURCH_INVITATION = {
  type: "sending_church_to_network" as const,
  targetChurchId: null,
  targetSendingChurchId: SENDING_CHURCH,
};

test("the target plant's own planter may respond", () => {
  verifyInvitationAuthority(CHURCH_INVITATION, PLANTER);
  verifyInvitationAuthority(NETWORK_INVITATION, PLANTER);
});

test("a planter of a different plant may not respond", () => {
  // The forged-actor case with a real session behind it: being *a* planter is
  // not being *this* plant's planter.
  for (const invitation of [CHURCH_INVITATION, NETWORK_INVITATION]) {
    assert.throws(
      () => verifyInvitationAuthority(invitation, FOREIGN_PLANTER),
      (error: unknown) =>
        error instanceof InvitationError &&
        error.message === NOT_AUTHORIZED_MESSAGE
    );
  }
});

test("a team member of the target plant may not bind it to an org", () => {
  // Tightened in #265: "belongs to the church" used to be enough, so any team
  // member could enrol the plant under oversight.
  assert.throws(
    () => verifyInvitationAuthority(CHURCH_INVITATION, TEAM_MEMBER),
    InvitationError
  );
});

test("a churchless actor may not respond for a church", () => {
  assert.throws(
    () =>
      verifyInvitationAuthority(CHURCH_INVITATION, actor({ role: "planter" })),
    InvitationError
  );
});

test("only the target sending church's admin may join a network", () => {
  verifyInvitationAuthority(SENDING_CHURCH_INVITATION, SC_ADMIN);

  for (const wrong of [
    PLANTER,
    NETWORK_ADMIN,
    actor({
      role: "sending_church_admin",
      sendingChurchId: OTHER_SENDING_CHURCH,
    }),
    actor({ role: "planter", sendingChurchId: SENDING_CHURCH }),
  ]) {
    assert.throws(
      () => verifyInvitationAuthority(SENDING_CHURCH_INVITATION, wrong),
      InvitationError
    );
  }
});

// ----------------------------------------------------------------------------
// 4. Create — the inviting org comes from the session
// ----------------------------------------------------------------------------

test("a sending church admin invites plants into their OWN sending church", () => {
  const resolved = resolveInvitationRequest(SC_ADMIN, {
    targetChurchId: PLANT,
  });

  assert.ok(resolved.ok);
  assert.deepEqual(resolved.values, {
    type: "church_to_sending_church",
    inviterUserId: PLANTER_ID,
    targetChurchId: PLANT,
    targetSendingChurchId: null,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: null,
    expiresInDays: INVITATION_EXPIRY_DAYS,
  });
});

test("org ids smuggled onto the payload are discarded, not written", () => {
  // The write-path half of "a forged POST changes nothing". The inviting org
  // decides who ends up associated with whom — and who receives the one
  // oversight notification that bypasses consent — so it is derived from the
  // session and a client value for it is dropped on the floor.
  const resolved = resolveInvitationRequest(SC_ADMIN, {
    targetChurchId: PLANT,
    // @ts-expect-error the point of the test: a client cannot name the inviter
    sendingChurchId: OTHER_SENDING_CHURCH,
    sendingNetworkId: NETWORK,
    inviterUserId: FOREIGN_ID,
    type: "sending_church_to_network",
  });

  assert.ok(resolved.ok);
  assert.equal(resolved.values.sendingChurchId, SENDING_CHURCH);
  assert.equal(resolved.values.sendingNetworkId, null);
  assert.equal(resolved.values.inviterUserId, PLANTER_ID);
  assert.equal(resolved.values.type, "church_to_sending_church");
  assert.ok(!JSON.stringify(resolved.values).includes(OTHER_SENDING_CHURCH));
  assert.ok(!JSON.stringify(resolved.values).includes(FOREIGN_ID));
});

test("a network admin invites into their OWN network, either kind of target", () => {
  const plant = resolveInvitationRequest(NETWORK_ADMIN, {
    targetChurchId: PLANT,
  });
  assert.ok(plant.ok);
  assert.equal(plant.values.type, "church_to_network");
  assert.equal(plant.values.sendingNetworkId, NETWORK);

  const sendingChurch = resolveInvitationRequest(NETWORK_ADMIN, {
    targetSendingChurchId: SENDING_CHURCH,
  });
  assert.ok(sendingChurch.ok);
  assert.equal(sendingChurch.values.type, "sending_church_to_network");
  assert.equal(sendingChurch.values.sendingNetworkId, NETWORK);
  assert.equal(sendingChurch.values.targetChurchId, null);
});

test("a sending church cannot invite another sending church", () => {
  const resolved = resolveInvitationRequest(SC_ADMIN, {
    targetSendingChurchId: OTHER_SENDING_CHURCH,
  });

  assert.ok(!resolved.ok);
});

test("nobody without an oversight role may invite", () => {
  for (const role of ["planter", "coach", "team_member"] as const) {
    const resolved = resolveInvitationRequest(
      actor({ role, churchId: PLANT }),
      { targetChurchId: OTHER_PLANT }
    );
    assert.ok(!resolved.ok, role);
  }
});

test("an oversight admin with no org of their own may not invite", () => {
  assert.ok(
    !resolveInvitationRequest(actor({ role: "sending_church_admin" }), {
      targetChurchId: PLANT,
    }).ok
  );
  assert.ok(
    !resolveInvitationRequest(actor({ role: "network_admin" }), {
      targetChurchId: PLANT,
    }).ok
  );
});

test("the target must be exactly one well-formed id", () => {
  const cases = [
    {},
    { targetChurchId: PLANT, targetSendingChurchId: SENDING_CHURCH },
    { targetChurchId: "not-a-uuid" },
    { targetChurchId: "' or 1=1 --" },
    { targetSendingChurchId: "42" },
  ];

  for (const request of cases) {
    assert.ok(
      !resolveInvitationRequest(NETWORK_ADMIN, request).ok,
      JSON.stringify(request)
    );
  }
});

test("the expiry window is bounded", () => {
  for (const expiresInDays of [0, -1, 1.5, MAX_EXPIRY_DAYS + 1, 36500]) {
    assert.ok(
      !resolveInvitationRequest(NETWORK_ADMIN, {
        targetChurchId: PLANT,
        expiresInDays,
      }).ok,
      String(expiresInDays)
    );
  }

  const ok = resolveInvitationRequest(NETWORK_ADMIN, {
    targetChurchId: PLANT,
    expiresInDays: MAX_EXPIRY_DAYS,
  });
  assert.ok(ok.ok);
  assert.equal(ok.values.expiresInDays, MAX_EXPIRY_DAYS);
});

// ----------------------------------------------------------------------------
// 5. The statements — the user recorded is the session's user
// ----------------------------------------------------------------------------

test("a response records the session's user, and only a pending row", () => {
  // The forged-`respondingUser` case read off the SQL. `responded_by` is bound
  // to the actor's id — the value that used to arrive as an argument — and the
  // WHERE clause is a compare-and-set on `pending`, so a second response
  // matches no row (no second association, no second milestone notification).
  const invitationId = "77777777-7777-4777-8777-777777777777";

  for (const status of ["accepted", "declined"] as const) {
    const { sql, params } = respondToInvitationQuery(
      PLANTER,
      invitationId,
      status
    ).toSQL();

    assert.ok(params.includes(PLANTER_ID), status);
    assert.ok(params.includes(status));
    assert.ok(params.includes("pending"));
    assert.ok(!params.includes(FOREIGN_ID));
    assert.match(sql, /responded_by/);
    assert.match(sql, /"status" = \$\d+/);
  }
});

test("the revoke statement is scoped to the session's own user", () => {
  // The authority check lives in the UPDATE, so this is where it has to be
  // read: the bound parameters carry the actor's id and the invitation id, and
  // a foreign id appears nowhere. Also `status = 'pending'`, so a revoke can
  // never resurrect an answered invitation.
  const invitationId = "66666666-6666-4666-8666-666666666666";
  const { sql, params } = revokeInvitationQuery(
    actor({ role: "network_admin", sendingNetworkId: NETWORK }),
    invitationId
  ).toSQL();

  assert.ok(params.includes(PLANTER_ID));
  assert.ok(params.includes(invitationId));
  assert.ok(params.includes("pending"));
  assert.ok(!params.includes(FOREIGN_ID));
  assert.match(sql, /inviter_user_id/);
});

// ----------------------------------------------------------------------------
// 6. Ids are ids
// ----------------------------------------------------------------------------

test("a malformed invitation id is not a lookup", async () => {
  // `getInvitation` is reachable with no session at all — the register beta gate
  // checks an invitation id before an account exists — so it refuses anything
  // that is not a uuid before it reaches the database.
  assert.equal(await getInvitation("not-a-uuid"), null);
  assert.equal(await getInvitation(""), null);
  assert.equal(await getInvitation("' or 1=1 --"), null);
});

test("isUuid accepts a uuid and nothing else", () => {
  assert.ok(isUuid(PLANT));
  for (const value of [
    "",
    "abc",
    `${PLANT} `,
    `${PLANT}x`,
    42,
    null,
    undefined,
    {},
  ]) {
    assert.ok(!isUuid(value), String(value));
  }
});
