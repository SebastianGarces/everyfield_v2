import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { OrganizationInvitationType } from "@/db/schema/organization-invitation";

import {
  INVITATION_EXPIRY_DAYS,
  InvitationError,
  MAX_EXPIRY_DAYS,
  NOT_AUTHORIZED_MESSAGE,
  associationStatement,
  expireInvitationQuery,
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
//    A source-shaped assertion is only as good as its pattern, and the first
//    version of this one was not good enough: every export check matched
//    `export async function`, so appending `export const detachPlantFromNetwork
//    = async (…) => …` and `export { disassociateChurchFromSendingChurch } from
//    "./core"` to `service.ts` — two real unauthenticated endpoints, verbatim
//    the vulnerability #265 closed — left the suite green. §1 is now
//    export-FORM-agnostic, forbids re-exports outright, and resolves module
//    specifiers instead of grepping for a path substring. Each of those two
//    lines now fails two tests independently; that was checked by writing them
//    and watching it go red, because a guardrail nobody has seen fail has not
//    been tested.
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
// The compare-and-set is covered from both sides: §5 reads it off the generated
// SQL (the claim's `status = 'pending'`, the association's
// `EXISTS ... status = 'accepted'`, the expiry's `status = 'pending'`), and the
// G3 harness (`scripts/g3-oversight-model.ts` §3d) races a real accept against a
// real revoke on a real database and asserts a lost accept writes nothing. The
// SQL assertions are what make the harness's result attributable to the guard.
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

/**
 * Every VALUE exported from the action layer, in whatever form it was written.
 *
 * Form-agnostic on purpose. An earlier version of this test matched
 * `export async function` only, which is one of at least four ways to publish an
 * endpoint — `export const x = async () => …` is the canonical Next.js server
 * action and is used throughout this repo — so the guardrail passed with two
 * real unauthenticated mutations appended to `service.ts`. `type` is excluded
 * because a type export is erased and is not an endpoint; re-exports are not
 * listed here at all, and are forbidden outright below, because a re-export
 * publishes an endpoint whose body no assertion in this file can see.
 */
const EXPORTED = [
  ...SERVICE_CODE.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm
  ),
].map((match) => match[1]);

// ----------------------------------------------------------------------------
// Module graph helpers. The two walks below are about which files can REACH
// `./core`, so they have to resolve specifiers rather than grep for a substring:
// `from "./core"` and `from "@/lib/invitations/core"` are the same module, and
// only the second one contains the string "invitations/core".
// ----------------------------------------------------------------------------

const TS_FILES: string[] = (function collect(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collect(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
})(SRC);

/** `export * from "x"` / `export { a } from "x"` — a published endpoint. */
const REEXPORT_FROM =
  /^export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/gm;

/** Any module specifier at all, type-only imports included. */
const ANY_FROM = /\bfrom\s*["']([^"']+)["']/g;

/** Specifiers whose module is actually emitted: value imports and `import()`. */
function valueSpecifiers(code: string): string[] {
  const statement =
    /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/gm;
  const sideEffect = /^\s*import\s*["']([^"']+)["']/gm;
  const dynamic = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  return [statement, sideEffect, dynamic].flatMap((pattern) =>
    [...code.matchAll(pattern)].map(([, specifier]) => specifier)
  );
}

/** The file a specifier names, or `null` for a bare package. */
function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (base === null) return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function resolvesToCore(from: string, specifier: string): boolean {
  return resolveModule(from, specifier) === CORE_PATH;
}

const isUseServerModule = (full: string) =>
  /^["']use server["'];/m.test(readFileSync(full, "utf8"));

// ----------------------------------------------------------------------------
// 1. Structural — the endpoint surface
// ----------------------------------------------------------------------------

test("every exported invitation action mints its actor from the session", () => {
  // Not "most of them". An action added later that resolved its user any other
  // way would be the one loose write path, and that is exactly the shape of bug
  // this counts. Counted against `EXPORTED`, so an arrow-function action is
  // counted too.
  const minted =
    SERVICE_CODE.match(
      /invitationActorFromSession\(await verifySession\(\)\)/g
    ) ?? [];

  assert.ok(EXPORTED.length > 0, "no exported actions found — check the path");
  assert.equal(minted.length, EXPORTED.length, EXPORTED.join(", "));
});

test("the action layer re-exports nothing", () => {
  // A re-export is the one endpoint shape the assertions above are blind to by
  // construction: `export { disassociateChurchFromNetwork } from "./core"` adds
  // a POSTable, unauthenticated, state-changing endpoint whose body lives in a
  // file this test deliberately treats as non-public. So no `export {` and no
  // `export *` here, from anywhere, ever — if the action layer needs something
  // from `./core` it imports it and wraps it in an action that mints an actor.
  assert.doesNotMatch(SERVICE_CODE, /^export\s*[*{]/m);
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
  assert.deepEqual([...EXPORTED].sort(), [
    "acceptInvitation",
    "createInvitation",
    "declineInvitation",
    "revokeInvitation",
  ]);
});

test("the logic layer is not a 'use server' module", () => {
  // `./core` holds every read, the association writes, and the actor-explicit
  // mutations. The absence of the directive is what makes them unreachable from
  // a browser — with it, all of them would be endpoints again. What that absence
  // GIVES UP is the client-bundle guarantee, replaced two tests down.
  assert.doesNotMatch(CORE_CODE, /"use server"/);
  assert.doesNotMatch(CORE_CODE, /'use server'/);
  assert.match(SERVICE_CODE, /^"use server";/);
});

test("no 'use server' module publishes the invitation logic layer", () => {
  // Two loopholes, and this covers both. (a) Any OTHER action file that so much
  // as touches `@/lib/invitations/core` — importing a primitive there is one
  // keystroke from exporting it. (b) `service.ts` itself, which is allowed to
  // import `./core` and is the whole reason it exists, but must never re-export
  // from it: `export { disassociateChurchFromNetwork } from "./core"` would
  // restore the endpoint this ticket removed, in the file whose shape everybody
  // believes is pinned. The earlier version of this test skipped `service.ts`
  // outright, so exactly that line passed.
  const offenders: string[] = [];

  for (const full of TS_FILES) {
    if (!isUseServerModule(full)) continue;
    const rel = path.relative(process.cwd(), full);
    const code = codeOf(full);

    // (b) Re-exports — checked in every action module, `service.ts` included.
    for (const [, specifier] of code.matchAll(REEXPORT_FROM)) {
      if (resolvesToCore(full, specifier)) {
        offenders.push(`${rel} re-exports from ${specifier}`);
      }
    }

    if (full === SERVICE_PATH) continue;

    // (a) Any other reference at all, import or re-export.
    if (
      /invitations\/core/.test(code) ||
      [...code.matchAll(ANY_FROM)].some(([, specifier]) =>
        resolvesToCore(full, specifier)
      )
    ) {
      offenders.push(rel);
    }
  }

  assert.deepEqual(offenders, []);
});

test("no client component can pull the logic layer into the browser", () => {
  // The rail that `"use server"` used to provide for free. `./core` imports
  // `@/db` and `@neondatabase/serverless`; before the split, the directive made
  // it structurally impossible to emit into a client bundle. It has no directive
  // now — that absence is the endpoint fix — so the guarantee has to be
  // re-established here.
  //
  // `import "server-only"` is the usual rail (`src/lib/auth/admin.ts:1`) and is
  // NOT usable on `./core`: the package's default entry is a bare `throw`
  // (`next/dist/compiled/server-only/index.js`) and resolves to the empty file
  // only under the `react-server` condition, so importing it would make every
  // test in this file — which imports `./core` directly, in a bare node process
  // — fail at load. This walk is the replacement: it is transitive, it runs on
  // every commit, and it fails in `pnpm test` rather than at runtime in a
  // browser.
  const clientEntries = TS_FILES.filter((full) =>
    /^["']use client["'];/m.test(readFileSync(full, "utf8"))
  );

  assert.ok(clientEntries.length > 0, "no client components found — check SRC");

  const seen = new Set<string>();
  const queue = [...clientEntries];
  const parents = new Map<string, string>();

  while (queue.length > 0) {
    const full = queue.pop()!;
    if (seen.has(full)) continue;
    seen.add(full);

    // A `"use server"` module is a boundary, not an import: the client gets a
    // reference and the body stays on the server. So client → `service.ts` →
    // `./core` is not a bundle path, and traversing it would make this test
    // fail the moment the invitation UI lands.
    if (isUseServerModule(full)) continue;

    for (const specifier of valueSpecifiers(codeOf(full))) {
      const resolved = resolveModule(full, specifier);
      if (resolved === null || seen.has(resolved)) continue;
      parents.set(resolved, full);
      queue.push(resolved);
    }
  }

  const chain = (file: string): string => {
    const hops = [path.relative(process.cwd(), file)];
    for (let at = parents.get(file); at; at = parents.get(at)) {
      hops.push(path.relative(process.cwd(), at));
    }
    return hops.reverse().join(" → ");
  };

  assert.ok(!seen.has(CORE_PATH), seen.has(CORE_PATH) ? chain(CORE_PATH) : "");
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
const INVITATION_ID = "77777777-7777-4777-8777-777777777777";

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
// 3b. Authority fails CLOSED on a type nobody wrote a rule for
// ----------------------------------------------------------------------------

/**
 * Types the database can hold but the switch does not know. `type` is a bare
 * `varchar(40)` with a TypeScript-only `$type<>` cast and `insertInvitation`
 * validates nothing, so this is not a hypothetical shape — it is any row a
 * future writer, a migration or a fixture puts there.
 */
const UNKNOWN_TYPES = [
  "CHURCH_TO_NETWORK",
  "church_to_sending_church ",
  "anything_else",
  "",
] as unknown as OrganizationInvitationType[];

test("an unrecognised invitation type grants nobody authority", () => {
  // The failure this pins: a switch with no `default:` RETURNS NORMALLY, and
  // returning normally is how this function says "authorized". A team member of
  // an unrelated church was granted authority over a foreign church's
  // invitation for every one of these.
  const stranger = actor({ role: "team_member", churchId: OTHER_PLANT });

  for (const type of UNKNOWN_TYPES) {
    assert.throws(
      () =>
        verifyInvitationAuthority(
          {
            type,
            targetChurchId: PLANT,
            targetSendingChurchId: SENDING_CHURCH,
          },
          stranger
        ),
      (error: unknown) =>
        error instanceof InvitationError &&
        error.message === NOT_AUTHORIZED_MESSAGE,
      type
    );
  }
});

test("an unrecognised invitation type has no association to write either", () => {
  // Belt and braces on the same premise: the old switch fell through silently,
  // so an unknown type wrote no association but was still marked `accepted` and
  // still announced a milestone. Now it cannot get that far.
  for (const type of UNKNOWN_TYPES) {
    assert.throws(
      () =>
        associationStatement(
          {
            type,
            targetChurchId: PLANT,
            targetSendingChurchId: SENDING_CHURCH,
            sendingChurchId: SENDING_CHURCH,
            sendingNetworkId: NETWORK,
          },
          INVITATION_ID
        ),
      InvitationError,
      type
    );
  }
});

test("an invitation whose ids contradict its type writes nothing", () => {
  // Thrown while BUILDING the statement, so it happens before the claim runs —
  // an inconsistent row can never be marked accepted and left unassociated.
  const cases = [
    { type: "church_to_sending_church" as const, sendingChurchId: null },
    { type: "church_to_network" as const, sendingNetworkId: null },
    {
      type: "sending_church_to_network" as const,
      targetSendingChurchId: null,
      sendingNetworkId: NETWORK,
    },
  ];

  for (const override of cases) {
    assert.throws(
      () =>
        associationStatement(
          {
            targetChurchId: PLANT,
            targetSendingChurchId: SENDING_CHURCH,
            sendingChurchId: SENDING_CHURCH,
            sendingNetworkId: NETWORK,
            ...override,
          },
          INVITATION_ID
        ),
      InvitationError,
      override.type
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
  const invitationId = INVITATION_ID;

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

test("the association cannot be written unless the claim was won", () => {
  // The half-applied accept, read off the SQL. `acceptInvitationAs` batches the
  // claim (statement 1, `status = 'pending' → 'accepted'`) with this statement,
  // whose WHERE requires the invitation to ALREADY read `accepted` — a value
  // only that claim can have written, visible here because both run in one Neon
  // batched transaction. So an accept that loses to a revoke or a decline
  // matches no row and the plant is not bound to anything.
  //
  // An empty `returning()` is not a driver error and does not roll a batch back,
  // which is why this predicate — and not `db.batch` alone — is the guard.
  const cases = [
    {
      invitation: {
        type: "church_to_sending_church" as const,
        targetChurchId: PLANT,
        targetSendingChurchId: null,
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: null,
      },
      table: /update "churches"/,
      column: /"sending_church_id" = \$\d+/,
      bound: SENDING_CHURCH,
    },
    {
      invitation: {
        type: "church_to_network" as const,
        targetChurchId: PLANT,
        targetSendingChurchId: null,
        sendingChurchId: null,
        sendingNetworkId: NETWORK,
      },
      table: /update "churches"/,
      column: /"sending_network_id" = \$\d+/,
      bound: NETWORK,
    },
    {
      invitation: {
        type: "sending_church_to_network" as const,
        targetChurchId: null,
        targetSendingChurchId: SENDING_CHURCH,
        sendingChurchId: null,
        sendingNetworkId: NETWORK,
      },
      table: /update "sending_churches"/,
      column: /"sending_network_id" = \$\d+/,
      bound: NETWORK,
    },
  ];

  for (const { invitation, table, column, bound } of cases) {
    const { sql, params } = associationStatement(
      invitation,
      INVITATION_ID
    ).toSQL();

    assert.match(sql, table, invitation.type);
    assert.match(sql, column, invitation.type);
    assert.match(
      sql,
      /exists \(select .* from "organization_invitations"/,
      invitation.type
    );
    assert.ok(params.includes(INVITATION_ID), invitation.type);
    assert.ok(params.includes("accepted"), invitation.type);
    assert.ok(params.includes(bound), invitation.type);
    // Not `pending`: inside the batch the claim has already flipped the row, so
    // a `pending` predicate here would never match and no association would
    // EVER be written.
    assert.ok(!params.includes("pending"), invitation.type);
  }
});

test("the auto-expire write is a compare-and-set too", () => {
  // The sibling status write the first CAS skipped: `WHERE id = ?` alone let two
  // requests straddling the expiry instant (a double-clicked Accept is enough)
  // stamp `expired` over a committed `accepted` — leaving `responded_by` set,
  // the association live and the status contradicting both.
  const now = new Date("2026-08-03T00:00:00.000Z");
  const { sql, params } = expireInvitationQuery(INVITATION_ID, now).toSQL();

  assert.match(sql, /update "organization_invitations"/);
  assert.match(sql, /"status" = \$\d+/);
  assert.match(sql, /"expires_at" < \$\d+/);
  assert.ok(params.includes(INVITATION_ID));
  assert.ok(params.includes("pending"));
  assert.ok(params.includes("expired"));
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
