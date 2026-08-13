import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ACCOUNT_NOT_INVITABLE_MESSAGE,
  invitationActorFromSession,
  resolveInvitationForResolvedTarget,
  type InvitationActor,
  type InviteeTarget,
} from "./core";
import { assertInOrder, sourceReader } from "@/lib/testing/source-span";

// ============================================================================
// #304 ruling 4, fixes 1–3 (HR4 security block, 2026-08-09) — a caller cannot
// name the organization it is enrolling.
//
// ----------------------------------------------------------------------------
// THE HOLE, stated once so the tests below read as its negation
// ----------------------------------------------------------------------------
//
// `createInvitation` is an export of a `"use server"` module, which makes it an
// HTTP endpoint. Its parameter is an OBJECT — `InvitationRequest` — and that
// type declares `targetChurchId` and `targetSendingChurchId`, because those are
// the keys the SERVER writes on after resolving the typed address. TypeScript
// erases, so nothing at runtime stopped a forged POST from arriving with them
// already filled in.
//
// `resolveInvitationForResolvedTarget` then composed `{ ...request, ...target }`
// — and an object spread is not a filter. For an address nobody has registered
// `target` is `{}`, so it contributes NO keys, and the caller's `targetChurchId`
// survived the merge untouched and became the invitation's target. The invited
// plant's planter saw a real invitation from the attacker's org and, on Accept,
// the plant was enrolled. Same shape one level down: a resolved CHURCH target
// left a forged `targetSendingChurchId` in place, and the invitation `type`
// follows whichever target is set (`resolveInvitationRequest`), so the forged
// key even chose the kind of association.
//
// The fix is structural rather than a filter list: the request handed to
// `resolveInvitationRequest` is CONSTRUCTED, key by key, from the
// server-resolved target and the two fields a client is allowed to say. A key
// added to `InvitationRequest` later is not forwarded unless somebody writes it
// in. `createInvitationAs` strips the same keys at its own call site, so the
// hole is closed twice on the live path.
//
// These tests are BEHAVIOURAL — `resolveInvitationForResolvedTarget` is pure, so
// the property is executable without a database — plus two source assertions for
// the things that are structural rather than observable (the strict schema, the
// call-site strip).
// ============================================================================

const ROOT = path.join(process.cwd(), "src", "lib", "invitations");
const CORE = readFileSync(path.join(ROOT, "core.ts"), "utf8");
const SERVICE = readFileSync(path.join(ROOT, "service.ts"), "utf8");

/**
 * The readers, and the ONLY way this file cuts a declaration out of either
 * module. `span` / `after` throw naming the missing needle (`@/lib/testing/source-span`) —
 * a bare `indexOf` pair returns -1 for a moved anchor, and a `doesNotMatch`
 * about one function then quietly becomes a claim about the whole file, or
 * about the empty string. Both have happened in this domain.
 */
const CORE_SOURCE = sourceReader(CORE, "core.ts");
const SERVICE_SOURCE = sourceReader(SERVICE, "service.ts");

/** Ids that exist only in the attacker's request. Nothing resolves to them. */
const FORGED_CHURCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FORGED_SENDING_CHURCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** The org the actor actually administers, from their session. */
const OWN_SENDING_CHURCH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWN_NETWORK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** What the SERVER resolved the typed address to, in the honest cases. */
const RESOLVED_CHURCH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RESOLVED_SENDING_CHURCH = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const ACCOUNTLESS = "nobody@example.com";

function sendingChurchAdmin(): InvitationActor {
  return invitationActorFromSession({
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      role: "sending_church_admin",
      churchId: null,
      sendingChurchId: OWN_SENDING_CHURCH,
      sendingNetworkId: null,
    },
  });
}

function networkAdmin(): InvitationActor {
  return invitationActorFromSession({
    user: {
      id: "22222222-2222-4222-8222-222222222222",
      role: "network_admin",
      churchId: null,
      sendingChurchId: null,
      sendingNetworkId: OWN_NETWORK,
    },
  });
}

/**
 * Every request a forger could send, over the two target keys — including the
 * pair, which `resolveInvitationRequest` refuses outright when it is allowed to
 * see it.
 */
const FORGERIES = [
  { targetChurchId: FORGED_CHURCH },
  { targetSendingChurchId: FORGED_SENDING_CHURCH },
  {
    targetChurchId: FORGED_CHURCH,
    targetSendingChurchId: FORGED_SENDING_CHURCH,
  },
] as const;

// ----------------------------------------------------------------------------
// 1. Fix 3 — the property the ruling names, executed
// ----------------------------------------------------------------------------

test("a forged target with an accountless email resolves to null targets", () => {
  // THE HEADLINE CASE. `target` is `{}` — the address has no account — so the
  // spread that used to build this request contributed nothing and the forged
  // key went straight through to the row.
  const noAccount: InviteeTarget = {};

  for (const actor of [sendingChurchAdmin(), networkAdmin()]) {
    for (const forgery of FORGERIES) {
      const result = resolveInvitationForResolvedTarget(
        actor,
        { inviteeEmail: ACCOUNTLESS, inviteAs: "church", ...forgery },
        noAccount
      );

      assert.equal(result.ok, true, JSON.stringify(forgery));
      assert.ok(result.ok);
      assert.equal(result.values.targetChurchId, null);
      assert.equal(result.values.targetSendingChurchId, null);

      // …and the invitation it WOULD have written is an ordinary open one, of
      // the kind the actor is entitled to issue — the forged key does not get
      // to pick the `type` either.
      assert.equal(
        result.values.type,
        actor.role === "sending_church_admin"
          ? "church_to_sending_church"
          : "church_to_network"
      );
    }
  }
});

test("a forged SENDING CHURCH key does not survive a resolved church target", () => {
  // The second shape of the same bug: `target` is non-empty, so the spread DID
  // contribute — but only the one key it had, leaving the other forged one in
  // place. `resolveInvitationRequest` reads `targetSendingChurchId` FIRST when
  // deciding the kind, so this forgery flipped a plant invitation into a
  // sending-church one aimed at an org the caller never resolved.
  const result = resolveInvitationForResolvedTarget(
    networkAdmin(),
    {
      inviteeEmail: "planter@example.com",
      inviteAs: "church",
      targetSendingChurchId: FORGED_SENDING_CHURCH,
    },
    { targetChurchId: RESOLVED_CHURCH }
  );

  assert.ok(result.ok);
  assert.equal(result.values.targetChurchId, RESOLVED_CHURCH);
  assert.equal(result.values.targetSendingChurchId, null);
  assert.equal(result.values.type, "church_to_network");
});

test("a forged CHURCH key does not survive a resolved sending-church target", () => {
  const result = resolveInvitationForResolvedTarget(
    networkAdmin(),
    {
      inviteeEmail: "admin@example.com",
      inviteAs: "sending_church",
      targetChurchId: FORGED_CHURCH,
    },
    { targetSendingChurchId: RESOLVED_SENDING_CHURCH }
  );

  assert.ok(result.ok);
  assert.equal(result.values.targetSendingChurchId, RESOLVED_SENDING_CHURCH);
  assert.equal(result.values.targetChurchId, null);
  assert.equal(result.values.type, "sending_church_to_network");
});

test("the org an invitation binds to is still the actor's own, never the request's", () => {
  // The other half of the same guarantee, and the one #265 established: the
  // INVITING org comes from the session. A forgery that also named an org it
  // does not administer changes neither column.
  const result = resolveInvitationForResolvedTarget(
    sendingChurchAdmin(),
    {
      inviteeEmail: ACCOUNTLESS,
      inviteAs: "church",
      targetChurchId: FORGED_CHURCH,
    },
    {}
  );

  assert.ok(result.ok);
  assert.equal(result.values.sendingChurchId, OWN_SENDING_CHURCH);
  assert.equal(result.values.sendingNetworkId, null);
});

test("a refusal on a RESOLVED target is still the one message", () => {
  // Ruling 2's collapse must survive fix 1: the rebuilt request is what
  // `resolveInvitationRequest` refuses, and the refusal is still replaced.
  // A sending church admin cannot invite a sending church, and the address
  // resolving to one is a fact about a stranger.
  const result = resolveInvitationForResolvedTarget(
    sendingChurchAdmin(),
    { inviteeEmail: "admin@example.com", inviteAs: "church" },
    { targetSendingChurchId: RESOLVED_SENDING_CHURCH }
  );

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.error, ACCOUNT_NOT_INVITABLE_MESSAGE);
});

// ----------------------------------------------------------------------------
// 2. Fix 1 — the construction, not a filter
// ----------------------------------------------------------------------------

test("the resolved request is built key by key, never spread from the caller's", () => {
  const fn = CORE_SOURCE.span(
    "export function resolveInvitationForResolvedTarget",
    "export async function insertInvitation"
  );

  // A spread is what the hole was. Any of them here means a key that nobody
  // listed can reach `resolveInvitationRequest` again.
  assert.doesNotMatch(fn, /\.\.\.request/);
  assert.doesNotMatch(fn, /\.\.\.target/);

  // The two target keys come from `target` and nothing else.
  assert.match(fn, /targetChurchId: target\.targetChurchId/);
  assert.match(fn, /targetSendingChurchId: target\.targetSendingChurchId/);
});

test("createInvitationAs strips the caller's target keys at the call site", () => {
  // Defence in depth: `resolveInvitationForResolvedTarget` is exported, so the
  // live path must not depend on a future caller reading its comment.
  // Bounded at the next declaration: unbounded, "no spread reaches this call
  // site" ran to the end of a 3,000-line module and would have kept passing with
  // the call moved into another function entirely.
  const create = CORE_SOURCE.span(
    "export async function createInvitationAs",
    "export async function emailInvitee"
  );
  const call = sourceReader(create, "createInvitationAs").after(
    "resolveInvitationForResolvedTarget"
  );

  assert.doesNotMatch(call.slice(0, 300), /\.\.\.request/);
  assert.match(call, /\{ inviteeEmail, inviteAs \}/);

  // The authority pass — which runs before any lookup — is built the same way.
  assert.match(
    create,
    /resolveInvitationRequest\(actor, \{\s*inviteeEmail,\s*inviteAs,\s*\}\)/
  );
});

// ----------------------------------------------------------------------------
// 3. Fix 2 — the strict runtime schema on the endpoint
// ----------------------------------------------------------------------------

test("createInvitation parses a strict schema before the logic layer", () => {
  // The rule: every `"use server"` export whose parameter is an OBJECT parses a
  // strict schema first. A typed parameter constrains a forged body not at all,
  // and `strictObject` makes an unknown key a refusal rather than a silently
  // stripped extra — so a probe fails loudly instead of half-working.
  assert.match(SERVICE, /z\.strictObject\(\{/);
  assert.match(SERVICE, /invitationRequestSchema\.safeParse\(request\)/);

  // …and the parsed value, not the raw request, is what travels on.
  assert.match(SERVICE, /createInvitationAs\(actor, parsed\.data\)/);
  assert.doesNotMatch(SERVICE, /createInvitationAs\(actor, request\)/);

  // The schema names exactly the two fields a client may say. Neither target
  // key appears anywhere in the action layer's CODE — the comments explain the
  // hole at length, which is why they are stripped rather than asserted on.
  assert.doesNotMatch(
    SERVICE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"),
    /targetChurchId|targetSendingChurchId/
  );

  // Session FIRST. `service.test.ts` executes the forged, sessionless call and
  // requires a throw from the first statement; a parse ahead of it would answer
  // an unauthenticated caller with a validation message instead.
  const fn = SERVICE_SOURCE.span(
    "export async function createInvitation(",
    "export async function resendInvitationEmail("
  );
  assertInOrder(
    fn,
    "invitations/service.ts → createInvitation",
    ["verifySession", "safeParse"],
    "the session check must precede the parse"
  );
});

test("the other invitation actions take a bare id, so the rule has no gap", () => {
  // The rule is about object parameters. These three take a string, and their
  // id checks live in the logic layer where a forged call meets them too — so
  // there is nothing here for a strict schema to add.
  for (const name of [
    "acceptInvitation",
    "declineInvitation",
    "revokeInvitation",
  ]) {
    const signature = new RegExp(
      `export async function ${name}\\(\\s*invitationId: string\\s*\\)`
    );
    assert.match(SERVICE, signature, name);
  }
});
