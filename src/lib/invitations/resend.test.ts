// `./core` → `./email` → `@/lib/email/client` builds a Resend instance at module
// scope, so the key has to exist before the imports below run. `node --test`
// gives each file its own process. The base URL is pinned for the same reason
// the other suites pin it: a link assertion must be about this fixture and not
// about whoever's `.env.local` is loaded.
process.env.RESEND_API_KEY = "re_test_key_not_a_real_credential";
process.env.NEXT_PUBLIC_APP_URL = "https://app.everyfield.test";

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type {
  OrganizationInvitation,
  OrganizationInvitationStatus,
} from "@/db/schema/organization-invitation";

import {
  InvitationError,
  orgInvitationQuery,
  type InvitationActor,
} from "./core";
import {
  invitationEmailIdempotencyKey,
  sendInvitationEmail,
  type InvitationEmailFacts,
  type InvitationEmailMessage,
  type InvitationEmailRefusal,
} from "./email";
import {
  INVITATION_EXPIRED_MESSAGE,
  INVITATION_NOT_OURS_MESSAGE,
  INVITATION_SEND_FAILED_MESSAGE,
  resendInvitationEmailAs,
  resendRefusalMessage,
} from "./resend";
// The window comes from the LEAF, never from `./email` — which imported it and
// re-exported it until the 2026-08-13 sweep (#411), making this suite the one
// "existing importer" that justified a second door into the Resend SDK. See
// `register-path.test.ts` §2.
import {
  RESEND_DEDUPE_WINDOW_MS,
  resendCooldownLabel,
  resendCooldownRemainingMs,
  resendCooldownSecondsLeft,
  resendDedupeWindowAt,
} from "./resend-window";
import {
  assertInOrder,
  sourceReader,
  stripComments,
} from "@/lib/testing/source-span";

// ============================================================================
// "Resend email" on a pending invitation — RULED 2026-08-10 (Sebastian, on
// PR #392 / #293).
//
// The ruling picked option C of four: a failed (or missed) send becomes
// RECOVERABLE at any time, and nothing is persisted — no `email_sent` column, no
// migration, no delivery badge. So the properties worth pinning are the ones
// that decide whether the recovery actually recovers anything:
//
//   1. THE PROVIDER MUST NOT SWALLOW IT. The create already presented
//      `org-invitation-<id>` to Resend as an `Idempotency-Key` for this exact
//      invitation. A resend that presented the same key would report success
//      while the provider dropped the message — the failure mode the button
//      exists to repair, now with a green tick over it. §1.
//   2. THE PENDING GUARD IS STILL THE ONE DECISION. The resend path adds no
//      status check of its own; it turns `sendInvitationEmail`'s `not_pending`
//      refusal into words. Deleting that guard therefore breaks THIS file too,
//      which is the property that makes "one decision" true rather than stated.
//      §2 and §3.
//   3. AUTHORITY IS THE ORG, not the inviting admin, and it lives in the WHERE
//      clause — the same predicate the list and the revoke share. §4.
//   4. NOTHING IS LOGGED that a log drain should not hold, and nothing is
//      persisted. §5.
//   5. THE PRODUCT NEVER CLAIMS A SEND THE PROVIDER WILL DROP. Round 2 of the
//      ruling (2026-08-10) kept the window — it is the double-click guard and
//      the two-admins guard — and closed the hole round 1 left: the button was
//      live INSIDE the window, so a second press said "Email sent" over a
//      message the provider collapsed onto the first. The button now refuses
//      for the remainder of the bucket its key was built from, and counts it
//      down. That only holds if ONE piece of arithmetic feeds both, which is
//      what §7 pins. §7 and §8.
//
// The database is not needed for any of it: the row read, the org-name read, the
// transport and the auto-expire write are all seams on `resendInvitationEmailAs`,
// each defaulting to the real thing (§4 pins the defaults).
// ============================================================================

const INVITATION_ID = "77777777-7777-4777-8777-777777777777";
const REPLACEMENT_ID = "88888888-8888-4888-8888-888888888888";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const PLANT = "99999999-9999-4999-8999-999999999999";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const INVITEE = "new-planter@example.test";
const ORG = "Redemption Hill";
const BASE = "https://app.everyfield.test";
const NOW = new Date("2026-08-10T14:30:00.000Z");
const EXPIRES = new Date("2026-09-03T23:30:00.000Z");

function actor(overrides: Partial<InvitationActor> = {}): InvitationActor {
  return {
    id: ADMIN_ID,
    seat: "owner",
    churchId: null,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: null,
    ...overrides,
  } as InvitationActor;
}

const SC_ADMIN = actor();

function invitation(
  overrides: Partial<OrganizationInvitation> = {}
): OrganizationInvitation {
  return {
    id: INVITATION_ID,
    type: "church_to_sending_church",
    status: "pending",
    inviteeEmail: INVITEE,
    inviterUserId: ADMIN_ID,
    respondedBy: null,
    targetChurchId: null,
    targetSendingChurchId: null,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: null,
    expiresAt: EXPIRES,
    respondedAt: null,
    createdAt: new Date("2026-08-04T12:00:00.000Z"),
    ...overrides,
  } as OrganizationInvitation;
}

function facts(
  overrides: Partial<InvitationEmailFacts> = {}
): InvitationEmailFacts {
  return {
    invitationId: INVITATION_ID,
    inviteeEmail: INVITEE,
    status: "pending",
    type: "church_to_sending_church",
    invitingOrgName: ORG,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function recorder(
  result: { success: boolean; error?: string } = { success: true }
) {
  const sent: InvitationEmailMessage[] = [];
  return {
    sent,
    send: async (message: InvitationEmailMessage) => {
      sent.push(message);
      return result;
    },
  };
}

/** The seams a resend needs, minus whichever the test is actually about. */
function deps(overrides: Record<string, unknown> = {}) {
  return {
    loadInvitation: async () => invitation(),
    lookupOrgName: async () => ORG,
    expire: async () => {},
    now: NOW,
    ...overrides,
  };
}

const CORE_CODE = readFileSync(
  path.join(process.cwd(), "src", "lib", "invitations", "core.ts"),
  "utf8"
);
/**
 * The resend path's own module (extracted from `core.ts` on 2026-08-12, PR #392
 * warning (c)). Every source-shaped assertion about the RESEND reads this file;
 * `CORE_CODE` is still read where the property is about the shared layer —
 * `orgInvitationQuery` and "nothing anywhere persists delivery".
 */
const RESEND_CODE = readFileSync(
  path.join(process.cwd(), "src", "lib", "invitations", "resend.ts"),
  "utf8"
);
const SERVICE_CODE = readFileSync(
  path.join(process.cwd(), "src", "lib", "invitations", "service.ts"),
  "utf8"
);
const LIST_CODE = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "components",
    "oversight",
    "invitations-list.tsx"
  ),
  "utf8"
);
const ACTIONS_CODE = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "app",
    "(dashboard)",
    "oversight",
    "invitations",
    "actions.ts"
  ),
  "utf8"
);

/**
 * THE READERS, and the only way this file cuts a declaration out of a source
 * file. `span` / `after` throw when an anchor has moved (`@/lib/testing/source-span`).
 *
 * That is not decoration. The action-cluster test below was anchored on
 * `function CopyInviteLinkButton` — a component #304 ruling 4 item 5 DELETED —
 * so `indexOf` returned -1, the slice became the whole rest of
 * `invitations-list.tsx` (12,899 chars for a 1,300-char component), and the
 * `assert.ok(row.length > 0, "InvitationRow is missing")` line written to catch
 * exactly that could never fire, because -1 always yields a long slice. Anchor
 * on declarations only, and let a moved one throw.
 */
const LIST = sourceReader(LIST_CODE, "invitations-list.tsx");
const ACTIONS = sourceReader(ACTIONS_CODE, "oversight/invitations/actions.ts");
const ACTIONS_STRIPPED = sourceReader(
  stripComments(ACTIONS_CODE),
  "oversight/invitations/actions.ts (comments stripped)"
);

/**
 * `resendInvitationEmailAs`'s body, comments stripped. Bounded at the next
 * declaration so an assertion about what this function does cannot silently
 * become an assertion about the rest of the file.
 */
function resendBody(): string {
  // It is the last declaration in its own module now, so the bound is the end
  // of the file rather than the next function's name.
  return sourceReader(
    stripComments(RESEND_CODE),
    "resend.ts (comments stripped)"
  ).after("export async function resendInvitationEmailAs");
}

// ----------------------------------------------------------------------------
// 1. The key: a deliberate resend is not deduped away
// ----------------------------------------------------------------------------

test("the create key is unchanged, so a retried create still cannot double-send", () => {
  // The regression half. #293 shipped `org-invitation-<id>` and two other
  // suites assert it verbatim; the resend must not have redefined the automatic
  // send's key on its way past.
  assert.equal(
    invitationEmailIdempotencyKey(INVITATION_ID),
    `org-invitation-${INVITATION_ID}`
  );
  assert.equal(
    invitationEmailIdempotencyKey(INVITATION_ID, { kind: "create" }),
    `org-invitation-${INVITATION_ID}`
  );
});

test("a deliberate resend presents a DIFFERENT key from the create", () => {
  // THE assertion of this file. The create has already presented its key to the
  // provider for this invitation — that is what makes a retried create harmless
  // — so a resend reusing it is a message the provider is entitled to drop as a
  // duplicate while the action reports success. The admin would then have
  // "fixed" a failed send by producing nothing at all.
  const create = invitationEmailIdempotencyKey(INVITATION_ID);
  const resend = invitationEmailIdempotencyKey(INVITATION_ID, {
    kind: "resend",
    at: NOW,
  });

  assert.notEqual(resend, create);
  // …and it is still INVITATION-scoped: the id is in the key, so no other
  // invitation, and no other address, can collide with it.
  assert.ok(resend.includes(INVITATION_ID));
  assert.ok(!resend.includes(REPLACEMENT_ID));
  assert.ok(resend.startsWith(create));
});

test("two resends in one window share a key; two windows apart do not", () => {
  // The rate-limit question the ruling left open, answered where it can be
  // answered without persisting anything: a double-clicked button (or two
  // admins on one page) presents ONE key inside the window, so the invitee gets
  // one email. A genuinely later attempt — the admin fixed a misconfigured
  // sender — is a new key and reaches them.
  const first = invitationEmailIdempotencyKey(INVITATION_ID, {
    kind: "resend",
    at: NOW,
  });
  const doubleClick = invitationEmailIdempotencyKey(INVITATION_ID, {
    kind: "resend",
    at: new Date(NOW.getTime() + 900),
  });
  const later = invitationEmailIdempotencyKey(INVITATION_ID, {
    kind: "resend",
    at: new Date(NOW.getTime() + 2 * RESEND_DEDUPE_WINDOW_MS),
  });

  assert.equal(doubleClick, first);
  assert.notEqual(later, first);
});

test("a re-invitation after a revoke still collides with nothing", () => {
  // The #293 AC, re-checked against the new key shape: the replacement row has a
  // new id, so every key it can present — create or resend — differs from every
  // key the dead row presented.
  const dead = [
    invitationEmailIdempotencyKey(INVITATION_ID),
    invitationEmailIdempotencyKey(INVITATION_ID, { kind: "resend", at: NOW }),
  ];
  const fresh = [
    invitationEmailIdempotencyKey(REPLACEMENT_ID),
    invitationEmailIdempotencyKey(REPLACEMENT_ID, { kind: "resend", at: NOW }),
  ];

  for (const key of fresh) {
    assert.ok(!dead.includes(key), key);
    assert.ok(key.includes(REPLACEMENT_ID));
    assert.ok(!key.includes(INVITATION_ID));
  }
});

test("the occasion reaches the message the transport is handed", async () => {
  // The key rules above are worth nothing if the send path does not carry the
  // occasion through to the payload, so this drives the real
  // `sendInvitationEmail` and reads the header value off what the transport got.
  const transport = recorder();

  await sendInvitationEmail(facts(), { send: transport.send, baseUrl: BASE });
  await sendInvitationEmail(facts(), {
    send: transport.send,
    baseUrl: BASE,
    occasion: { kind: "resend", at: NOW },
  });

  assert.equal(transport.sent.length, 2);
  assert.equal(
    transport.sent[0].idempotencyKey,
    `org-invitation-${INVITATION_ID}`
  );
  assert.notEqual(
    transport.sent[1].idempotencyKey,
    transport.sent[0].idempotencyKey
  );
  // The message itself is the same message — the occasion changes the dedupe
  // key and nothing the invitee reads.
  assert.equal(transport.sent[1].to, transport.sent[0].to);
  assert.equal(transport.sent[1].subject, transport.sent[0].subject);
  assert.equal(transport.sent[1].html, transport.sent[0].html);
});

// ----------------------------------------------------------------------------
// 2. The happy path
// ----------------------------------------------------------------------------

test("a pending invitation is emailed again, with the same token-bound link", async () => {
  const transport = recorder();

  const result = await resendInvitationEmailAs(
    SC_ADMIN,
    INVITATION_ID,
    deps({ send: transport.send })
  );

  assert.equal(result.emailSent, true);
  assert.equal(result.invitation.id, INVITATION_ID);
  assert.equal(transport.sent.length, 1);

  const message = transport.sent[0];
  assert.equal(message.to, INVITEE);
  assert.match(message.subject, new RegExp(ORG));
  // The SAME invitation, so the SAME link — a resend never mints a new token.
  assert.match(message.html, new RegExp(`${BASE}/register\\?invitation=`));
  assert.ok(message.html.includes(INVITATION_ID));
  assert.equal(
    message.idempotencyKey,
    invitationEmailIdempotencyKey(INVITATION_ID, { kind: "resend", at: NOW })
  );
});

// ----------------------------------------------------------------------------
// 3. Refusals — the guard, and the words
// ----------------------------------------------------------------------------

test("a non-pending invitation is refused and nothing is sent", async () => {
  // AC: "non-pending rows refuse (existing guard proven still active)". The
  // resend path checks no status itself — the refusal below is
  // `sendInvitationEmail`'s own guard, reached through the real send path, with
  // the transport counting what left the building.
  const answered: OrganizationInvitationStatus[] = [
    "revoked",
    "accepted",
    "declined",
    "expired",
  ];

  for (const status of answered) {
    const transport = recorder();

    await assert.rejects(
      () =>
        resendInvitationEmailAs(
          SC_ADMIN,
          INVITATION_ID,
          deps({
            loadInvitation: async () => invitation({ status }),
            send: transport.send,
          })
        ),
      (error: unknown) =>
        error instanceof InvitationError &&
        error.message ===
          "That invitation is no longer pending — nothing was sent",
      status
    );

    assert.equal(transport.sent.length, 0, status);
  }
});

test("a pending invitation whose window has closed is expired, not emailed", async () => {
  // `sendInvitationEmail` guards the STATUS, not the window, so without this the
  // invitee would be told to click a link `bindOpenInvitationTarget` is
  // guaranteed to reject. The refusal writes the expiry through the existing
  // compare-and-set, so the list stops calling the row pending.
  const transport = recorder();
  const expired: Array<[string, Date]> = [];

  await assert.rejects(
    () =>
      resendInvitationEmailAs(
        SC_ADMIN,
        INVITATION_ID,
        deps({
          loadInvitation: async () =>
            invitation({ expiresAt: new Date(NOW.getTime() - 1000) }),
          expire: async (id: string, at: Date) => {
            expired.push([id, at]);
          },
          send: transport.send,
        })
      ),
    (error: unknown) =>
      error instanceof InvitationError &&
      error.message === INVITATION_EXPIRED_MESSAGE
  );

  assert.equal(transport.sent.length, 0);
  assert.deepEqual(expired, [[INVITATION_ID, NOW]]);
});

test("a refused provider is a failed ACTION, not a quiet false", async () => {
  // The deliberate difference from the create. A create protects a durable row,
  // so its email is best-effort and a failure is reported next to a success. A
  // resend has nothing to protect — the send IS the action — so a refusal comes
  // back as a message the admin reads, beside the Resend email button it tells
  // them to press again. It used to name a Copy link button instead; #304
  // ruling 4 item 5 deleted that control from every admin surface, so the
  // sentence was pointing at nothing (reconciled 2026-08-12, #293 × #304).
  for (const send of [
    async () => ({ success: false, error: "Invalid `to` field" }),
    async () => {
      throw new Error("ECONNRESET");
    },
  ]) {
    await assert.rejects(
      () => resendInvitationEmailAs(SC_ADMIN, INVITATION_ID, deps({ send })),
      (error: unknown) =>
        error instanceof InvitationError &&
        error.message === INVITATION_SEND_FAILED_MESSAGE
    );
  }

  // The words themselves, so the constant cannot quietly become anything.
  assert.equal(
    INVITATION_SEND_FAILED_MESSAGE,
    "We could not send that email — nothing reached them, so try again in a moment"
  );
});

test("a throwing org-name lookup is refused, not leaked", async () => {
  const transport = recorder();

  await assert.rejects(
    () =>
      resendInvitationEmailAs(
        SC_ADMIN,
        INVITATION_ID,
        deps({
          lookupOrgName: async () => {
            throw new Error("connection terminated");
          },
          send: transport.send,
        })
      ),
    (error: unknown) => error instanceof InvitationError
  );

  assert.equal(transport.sent.length, 0);
});

/**
 * Every `InvitationEmailRefusal`, and the list cannot fall behind the union.
 *
 * A `Record<InvitationEmailRefusal, true>` is a COMPILE error the moment a
 * reason is added, so the two tests below are exhaustive by construction rather
 * than by somebody remembering to extend an array — which is exactly how the
 * link sentence survived item 5 in one of the five collapsed branches while
 * every other surface had it removed.
 */
const ALL_REFUSALS = Object.keys({
  not_pending: true,
  no_address: true,
  no_inviting_org: true,
  unknown_type: true,
  provider_refused: true,
  transport_threw: true,
  preparation_threw: true,
} satisfies Record<InvitationEmailRefusal, true>) as InvitationEmailRefusal[];

test("every refusal reason has words, and none of them is a code", () => {
  // Exhaustive by construction — `resendRefusalMessage` switches on the union
  // with a `never` default, so a new reason is a compile error rather than a
  // silent fall-through. This checks the OTHER half: what comes out is a
  // sentence, never the reason code itself.
  assert.equal(ALL_REFUSALS.length, 7);

  for (const reason of ALL_REFUSALS) {
    const message = resendRefusalMessage(reason);
    assert.ok(message.length > 0, reason);
    assert.ok(!message.includes(reason), message);
    assert.ok(!message.includes("_"), message);
  }
});

test("no refusal message offers a link, or tells the admin to forward one", () => {
  // #304 ruling 4 item 5, on the LAST surface that still broke it (reconciled
  // 2026-08-12, #293 × #304). No `/register?invitation=` control survives on
  // any admin surface — not on the create notice, not on the create form, not
  // on a pending row — so a refusal that says "copy the link and send it
  // yourself" is an instruction pointing at a button that was deleted. This is
  // the same guard `create-notice.test.ts` §5 gives the three create notices,
  // and it runs over the WHOLE union rather than the one branch that was wrong.
  for (const reason of ALL_REFUSALS) {
    assert.doesNotMatch(
      resendRefusalMessage(reason),
      /\/register|invitation=|copy the link|this link/i,
      reason
    );
  }

  // …and the constant itself names the recovery that does exist, so "no link"
  // cannot be satisfied by a sentence that leaves the admin with nothing.
  assert.match(INVITATION_SEND_FAILED_MESSAGE, /try again/i);
});

// ----------------------------------------------------------------------------
// 4. Authority — the org, in the WHERE clause
// ----------------------------------------------------------------------------

test("the resend read is scoped by the SAME org predicate as the list and the revoke", () => {
  // A screen that shows an admin a pending invitation and then refuses their
  // Resend is exactly what two definitions of "ours" produce. All three are
  // built from `invitingOrgOf(actor)`, and the parameters below come from the
  // session — there is no argument a request could put another org's id into.
  const scoped = orgInvitationQuery(
    actor({
      seat: "owner",
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: null,
    }),
    INVITATION_ID
  ).toSQL();

  assert.match(scoped.sql, /"sending_church_id" = \$\d/);
  assert.ok(scoped.params.includes(SENDING_CHURCH));
  assert.ok(scoped.params.includes(INVITATION_ID));
  // Never the inviting admin: any admin of the org may resend, exactly as any
  // may revoke (ruled 2026-08-04).
  assert.ok(!scoped.params.includes(ADMIN_ID));

  const network = orgInvitationQuery(
    actor({
      seat: "owner",
      sendingChurchId: null,
      sendingNetworkId: NETWORK,
    }),
    INVITATION_ID
  ).toSQL();
  assert.match(network.sql, /"sending_network_id" = \$\d/);
  assert.ok(network.params.includes(NETWORK));
});

test("a tenancy that cannot invite, and an account with no org, match nothing", () => {
  // `invitingOrgOf` answers `false` for every one of them, so the predicate
  // matches no row rather than degrading into "every invitation in the
  // product". The last row is the one the role used to settle: with two
  // oversight FKs and no role to break the tie, `oversightOrgOf` names NO org
  // and the query reaches nothing — fail-closed, not a precedence order.
  const NOBODY: [string, Partial<InvitationActor>][] = [
    ["the plant's Owner", { seat: "owner", churchId: PLANT }],
    ["a plant Member", { seat: "member", churchId: PLANT }],
    ["a coach, who names no tenancy at all", { seat: null }],
    ["an Owner whose org is not set", { seat: "owner" }],
    [
      "an account naming BOTH oversight orgs",
      {
        seat: "owner",
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: NETWORK,
      },
    ],
  ];

  for (const [who, fields] of NOBODY) {
    const nobody = actor({
      churchId: null,
      sendingChurchId: null,
      sendingNetworkId: null,
      ...fields,
    });
    const { sql } = orgInvitationQuery(nobody, INVITATION_ID).toSQL();
    assert.match(sql, /false/, who);
  }
});

test("a missing invitation and somebody else's read alike", async () => {
  // An invitation id is also an unauthenticated beta-gate bearer token, so
  // "no such row" and "not yours" must be one message — telling them apart
  // turns any authenticated admin into a reader of which uuids exist.
  const transport = recorder();

  for (const invitationId of [
    INVITATION_ID, // ours to ask about, but the scoped read finds nothing
    "not-a-uuid",
  ]) {
    await assert.rejects(
      () =>
        resendInvitationEmailAs(
          SC_ADMIN,
          invitationId,
          deps({ loadInvitation: async () => undefined, send: transport.send })
        ),
      (error: unknown) =>
        error instanceof InvitationError &&
        error.message === INVITATION_NOT_OURS_MESSAGE,
      invitationId
    );
  }

  assert.equal(transport.sent.length, 0);
});

test("the seams default to the real, org-scoped read", () => {
  // The seams exist for this file. What must not happen is production taking a
  // different path from the one tested above, or the org scope becoming
  // something a caller supplies: `service.ts` calls the two-argument form, so
  // the defaults are what run.
  const body = resendBody();

  assert.match(body, /deps\.loadInvitation \?\? loadOrgInvitation/);
  assert.match(body, /deps\.expire \?\? expireInvitation/);
  assert.match(
    stripComments(RESEND_CODE),
    /orgInvitationQuery\(actor, invitationId\)/
  );
  assert.match(
    stripComments(SERVICE_CODE),
    /resendInvitationEmailAs\(actor, invitationId\)/
  );
  // …and the query itself stays in the shared layer, so "ours" has exactly one
  // definition for the list, the revoke and this path (PR #392 warning (c)).
  assert.match(
    stripComments(CORE_CODE),
    /export function orgInvitationQuery\(/
  );
  assert.doesNotMatch(
    stripComments(RESEND_CODE),
    /export function orgInvitationQuery\(/
  );
  assert.match(stripComments(RESEND_CODE), /from "\.\/core"/);
  // One direction only — a cycle would make the extraction cosmetic.
  assert.doesNotMatch(stripComments(CORE_CODE), /from "\.\/resend"/);
  // The actor is minted from the session, never taken as an argument.
  assert.match(
    stripComments(SERVICE_CODE),
    /export async function resendInvitationEmail\(\s*invitationId: string\s*\)/
  );
});

test("the send's seams are forwarded key by key, never as a spread", () => {
  // Swept 2026-08-13 (#411). `ResendInvitationDeps` extends `EmailInviteeDeps`
  // with three seams of its own — `loadInvitation`, `expire`, `now` — and this
  // call forwarded all six with `{ ...deps, occasion }`. Nothing was wrong at
  // runtime, because `emailInviteeOutcome` reads only what it declares; the
  // trap is the day `EmailInviteeDeps` gains a key this module already uses
  // under the same name, at which point a seam meant for the expiry guard
  // starts steering the send with no diff at either end.
  //
  // Same rule the domain already ships on the create path:
  // `resolveInvitationForResolvedTarget` was rebuilt key by key by #304 ruling
  // 4 fix 1 for exactly this reason. A spread is not a filter.
  const body = resendBody();

  assert.doesNotMatch(
    body,
    /emailInviteeOutcome\(\s*invitation,\s*\{\s*\.\.\.deps/,
    "the resend spreads its whole deps bag into the send path — name the keys"
  );
  // …and the two keys it is entitled to forward really are forwarded, so the
  // assertion above cannot be satisfied by dropping the seams altogether.
  // Whitespace-tolerant on purpose: a Prettier re-wrap must not turn a rule
  // about which keys travel into a rule about where the line breaks.
  assert.match(body, /lookupOrgName:\s*deps\.lookupOrgName/);
  assert.match(body, /send:\s*deps\.send/);
  assert.match(body, /occasion:\s*\{\s*kind:\s*"resend",\s*at:\s*now\s*\}/);
});

// ----------------------------------------------------------------------------
// 5. Nothing persisted, nothing logged
// ----------------------------------------------------------------------------

test("the resend persists nothing about delivery", () => {
  // The ruling chose C over B: no `email_sent` column, no migration, no badge.
  // `sent` from a provider is acceptance, not a delivery receipt, so a stored
  // flag would assert something the product never observes.
  for (const forbidden of [/email_sent/, /emailSentAt/, /deliveredAt/]) {
    assert.doesNotMatch(stripComments(CORE_CODE), forbidden, String(forbidden));
    assert.doesNotMatch(
      stripComments(RESEND_CODE),
      forbidden,
      String(forbidden)
    );
    assert.doesNotMatch(stripComments(LIST_CODE), forbidden, String(forbidden));
    assert.doesNotMatch(
      stripComments(ACTIONS_CODE),
      forbidden,
      String(forbidden)
    );
  }

  // The one write the resend path may make is the auto-expire, and it is the
  // existing compare-and-set rather than a new statement.
  assert.doesNotMatch(resendBody(), /db\.update|db\.insert|db\.batch/);
});

test("no resend path logs the token, the address or the link", () => {
  // The invitation id IS the register bearer token. Source-shaped for the same
  // reason `email.test.ts` is: the property is about what the code CAN log.
  //
  // THIS TEST USED TO SCAN NOTHING, and the extraction is what exposed it. The
  // body was sliced out of `core.ts` between `indexOf("// Resend")` and
  // `indexOf("// Respond")` — on source that `stripComments()` had ALREADY STRIPPED THE
  // COMMENTS FROM. Both needles were comments, so both `indexOf`s returned -1,
  // `slice(-1, -1)` returned `""`, the `matchAll` found zero calls and the loop
  // never ran. A bound that names a comment cannot survive a comment stripper;
  // the bound is now the module itself, which has nothing to keep in sync.
  const calls = [
    ...stripComments(RESEND_CODE).matchAll(/console\.\w+\(([\s\S]*?)\);/g),
  ]
    .map((match) => match[1])
    // A plain quoted string is a CONSTANT — `console.error("invitation resend
    // has no message …")` names the event and can leak nothing. What must not
    // appear is a runtime value, so the literals are blanked and everything
    // else is scanned. Template literals are deliberately NOT blanked: `${...}`
    // interpolates, which is exactly the leak this test is looking for.
    .map((call) => call.replace(/"[^"\\]*"|'[^'\\]*'/g, '""'));

  assert.ok(calls.length > 0, "the console scan found no calls to check");

  for (const call of calls) {
    for (const forbidden of [
      /invitationId/,
      /inviteeEmail/,
      /\binvitation\b(?!\.type\b)/,
      /\bmessage\b/,
    ]) {
      assert.doesNotMatch(call, forbidden, `${forbidden} in: ${call}`);
    }
  }
});

// ----------------------------------------------------------------------------
// 6. The surface
// ----------------------------------------------------------------------------

test("the Resend button is rendered for pending rows and nothing else", () => {
  assert.match(
    LIST_CODE,
    /row\.status === "pending" && \(\s*<ResendEmailButton/
  );
  // Offered to every admin who can see the row — the same rule as Revoke, and
  // the authority check stays in the read's WHERE clause.
  assert.doesNotMatch(stripComments(LIST_CODE), /canResend/);
});

test("the Resend control is a button with cursor-pointer and an accessible name", () => {
  const button = LIST.span(
    "function ResendEmailButton",
    "const initialRevokeState"
  );

  // Whatever else the className carries (`tabular-nums`, so a shrinking
  // countdown does not jog the row), the repo's cursor rule is not negotiable.
  assert.match(button, /className="[^"]*\bcursor-pointer\b[^"]*"/);
  assert.match(button, /type="submit"/);
  // The visible label repeats on every pending row, so the address is what
  // makes each one distinguishable to a screen reader.
  assert.match(button, /<span className="sr-only"> to \{email\}<\/span>/);
  // A failure is announced, not swallowed into the label.
  assert.match(button, /role="alert"/);
  assert.match(button, /role="status"/);
  // The button reports its own in-flight state rather than leaving the admin
  // wondering whether the click landed — and, since round 2, stays unavailable
  // for the rest of the dedupe window (§8 pins that half).
  assert.match(button, /disabled=\{pending \|\| cooling\}/);
  assert.match(button, /Sending…/);
});

test("the row's action cluster wraps, so a third control cannot push a second one off a phone", () => {
  // The regression this pins, measured at 390x844 with a real pending row: the
  // cluster was `flex items-center gap-2` with no wrap, adding "Resend email"
  // made it 362px wide inside a 292px row, and the PRE-EXISTING Revoke button
  // landed at right=411 against a 390px viewport. The page's own scrollWidth
  // stayed 390 — the overflow is CLIPPED, not scrolled — so the button was not
  // awkward, it was unreachable. With the longest refusal rendered the cluster
  // measured 437px and Resend went off-screen too (right=406), taking away both
  // controls the failure message tells the admin to use.
  //
  // Asserted on the source because the property is a class, and because a
  // fourth control is exactly the kind of change that would re-break it: an
  // author who deletes `flex-wrap` here fails this test rather than shipping an
  // invisible button.
  //
  // The end anchor was `function CopyInviteLinkButton` until this round — a
  // component #304 ruling 4 item 5 deleted, which is the very deletion this
  // pass reconciles. With it gone the slice ran to the end of the file and
  // swallowed `useResendCooldown`, `ResendEmailButton` and `RevokeButton`; the
  // assertions below still landed on the right `<div>` only because the first
  // `<Badge` in that 12,899-char slice happened to be `InvitationRow`'s own. A
  // second badge anywhere above it would have retargeted them silently.
  const row = LIST.span("function InvitationRow", "const initialResendState");

  // The badge anchor goes through the reader too — the window we want is the
  // 400 characters BEFORE it, and a bare `indexOf("<Badge") - 400` on a deleted
  // badge is `slice(-401, -1)`, which is the row's LAST 400 characters and a
  // different `<div>` entirely.
  const cluster = sourceReader(row, "InvitationRow")
    .span("function InvitationRow", "<Badge")
    .slice(-400);
  const clusterClass = /<div className="([^"]*)">\s*$/.exec(cluster)?.[1] ?? "";

  assert.ok(
    clusterClass.includes("flex-wrap"),
    `the control cluster must wrap; its className was "${clusterClass}"`
  );
  // Wrapped rows read right-aligned under the row's own `justify-between`,
  // rather than the controls drifting left as they fall onto a second line.
  assert.ok(
    clusterClass.includes("justify-end"),
    `wrapped controls stay right-aligned; its className was "${clusterClass}"`
  );
});

test("a refusal survives long enough to be read — the refresh is on the success path only", () => {
  // Every refusal this action returns is one that MOVES the row out of the
  // pending list: revoked out of band (`not_pending`), or a closed window,
  // which is auto-expired before it is refused. The pending and answered lists
  // are different parents, so a refreshed tree unmounts the row — and the
  // refusal lives in that row's `useActionState`. Refreshing before the branch
  // therefore destroyed the message before it could paint, which made
  // `resendRefusalMessage("not_pending")` and `INVITATION_EXPIRED_MESSAGE`
  // dead on screen: the admin saw nothing at all.
  const body = stripComments(
    ACTIONS.span(
      "export async function resendInvitationEmailAction",
      "export async function revokeInvitationAction"
    )
  );

  assertInOrder(
    body,
    "oversight/invitations/actions.ts → resendInvitationEmailAction",
    ["if (!result.success)", "refresh()"],
    "refresh() must come AFTER the refusal returns, or the message never renders"
  );
  // Exactly one, so a re-added call on the failure path fails here too.
  assert.equal(body.match(/refresh\(\)/g)?.length, 1);
});

test("the action refuses a malformed id before anything is sent", () => {
  // Comments stripped, like every other source-shaped check in this file: the
  // last assertion forbids the WORD "actor" in the body, and this action's
  // header comment has to be free to explain that the service mints its own.
  const action = ACTIONS_STRIPPED.span(
    "export async function resendInvitationEmailAction",
    "export async function revokeInvitationAction"
  );

  // SESSION FIRST, THEN THE PARSE (ruled 2026-08-10, round 6 of #304) — the
  // repo-wide ordering `server-action-surface.test.ts` walks. An anonymous POST
  // is refused before its FormData is examined, so a malformed body and a
  // well-formed one answer a sessionless caller identically.
  assertInOrder(
    action,
    "oversight/invitations/actions.ts → resendInvitationEmailAction (comments stripped)",
    ["verifySession()", "resendSchema.safeParse"],
    "the session mint must precede the parse"
  );

  assert.match(action, /resendSchema\.safeParse/);
  assert.match(action, /if \(!parsed\.success\)/);
  // No actor argument: the service mints one from `verifySession()`.
  assert.doesNotMatch(action, /userId|actor/);
});

// ----------------------------------------------------------------------------
// 7. The window, and the countdown over it — RULED 2026-08-10 round 2
// ----------------------------------------------------------------------------
//
// One bucket, two consumers: the provider's `Idempotency-Key` suffix and the
// span the button refuses for. Everything below is about them agreeing, because
// disagreement in either direction is a lie the product tells. Early, and the
// admin presses a live button whose send the provider drops while the screen
// says "Email sent". Late, and a genuinely new send is refused by our own UI.
// ----------------------------------------------------------------------------

test("the window a send reports is the bucket its key was built from", () => {
  const at = new Date(NOW.getTime() + 12_345);
  const window = resendDedupeWindowAt(at);

  assert.equal(
    invitationEmailIdempotencyKey(INVITATION_ID, { kind: "resend", at }),
    `org-invitation-${INVITATION_ID}-resend-${window.index}`
  );
});

test("remainingMs is the rest of that bucket — never zero, never more than the window", () => {
  const opened =
    Math.floor(NOW.getTime() / RESEND_DEDUPE_WINDOW_MS) *
    RESEND_DEDUPE_WINDOW_MS;

  for (const offset of [0, 1, 30_000, RESEND_DEDUPE_WINDOW_MS - 1]) {
    const at = new Date(opened + offset);
    const window = resendDedupeWindowAt(at);

    assert.equal(
      window.remainingMs,
      RESEND_DEDUPE_WINDOW_MS - offset,
      `${offset}`
    );
    // Never zero: a send landing exactly on a boundary owns the whole window it
    // opens, rather than a countdown that is over before it renders.
    assert.ok(window.remainingMs > 0, `${offset}`);
    assert.ok(window.remainingMs <= RESEND_DEDUPE_WINDOW_MS, `${offset}`);

    // THE deadline property: `remainingMs` later is the first instant of the
    // NEXT bucket, and a millisecond earlier is still this one. That is what
    // makes "the button re-enables exactly when the provider accepts a new key"
    // a fact rather than a hope.
    assert.equal(
      resendDedupeWindowAt(new Date(at.getTime() + window.remainingMs)).index,
      window.index + 1,
      `${offset}`
    );
    assert.equal(
      resendDedupeWindowAt(new Date(at.getTime() + window.remainingMs - 1))
        .index,
      window.index,
      `${offset}`
    );
  }
});

test("the countdown rounds up, so it never reads 0s while the button still refuses", () => {
  // A DURATION, which is the whole argument list: nothing on the client compares
  // an instant, so nothing on the client can be wrong about what time it is on
  // the server.
  assert.equal(resendCooldownSecondsLeft(RESEND_DEDUPE_WINDOW_MS), 60);
  // A fraction of a second left is still a second on the label — the button is
  // disabled for it, and a label reading "0s" over a refusing control is the
  // same class of lie in miniature.
  assert.equal(resendCooldownSecondsLeft(59_001), 60);
  assert.equal(resendCooldownSecondsLeft(1), 1);
  // And it reaches zero exactly when the window is spent, which is what
  // re-enables the button; a late tick past it does not resurrect the countdown.
  assert.equal(resendCooldownSecondsLeft(0), 0);
  assert.equal(resendCooldownSecondsLeft(-5_000), 0);

  assert.equal(resendCooldownLabel(42), "Resend in 42s");
});

test("a count belongs to ONE window — the four boundaries of the button's refusal", () => {
  const window = { window: 400, remainingMs: 45_000 };

  // 1. Nothing has been sent, or a send reported no window: no cooldown at all.
  //    A guessed duration here would be a claim about the provider.
  assert.equal(resendCooldownRemainingMs(undefined, { window: 400, ms: 9 }), 0);

  // 2. A window this surface has not started counting yet is used at FULL
  //    length, straight from the server's number. That is what disables the
  //    button in the same commit that reports the send, with no frame in
  //    between where a second press would land.
  assert.equal(
    resendCooldownRemainingMs(window, { window: undefined, ms: 0 }),
    45_000
  );
  // …and the same holds for a count left over from the PREVIOUS window, which
  // is the case that would otherwise bite: a resend a minute after the last one
  // would start its countdown already spent, and the button would re-enable
  // while the provider was still collapsing onto the message it just accepted.
  assert.equal(
    resendCooldownRemainingMs(window, { window: 399, ms: 44_000 }),
    45_000
  );

  // 3. Part way through: the server's duration minus what this surface has
  //    measured on its own clock. No instant is compared, so a workstation clock
  //    minutes out of step still waits the right LENGTH.
  assert.equal(
    resendCooldownRemainingMs(window, { window: 400, ms: 5_000 }),
    40_000
  );

  // 4. Spent, and past spent. Never negative — a late tick after the interval's
  //    last run must not resurrect the countdown as a huge number.
  assert.equal(
    resendCooldownRemainingMs(window, { window: 400, ms: 45_000 }),
    0
  );
  assert.equal(
    resendCooldownRemainingMs(window, { window: 400, ms: 90_000 }),
    0
  );
});

test("a successful resend reports the window it was keyed in", async () => {
  const transport = recorder();

  const result = await resendInvitationEmailAs(
    SC_ADMIN,
    INVITATION_ID,
    deps({ send: transport.send })
  );

  assert.equal(result.emailSent, true);
  assert.deepEqual(result.dedupeWindow, resendDedupeWindowAt(NOW));
  assert.equal(
    transport.sent[0].idempotencyKey,
    `org-invitation-${INVITATION_ID}-resend-${result.dedupeWindow.index}`
  );
});

test("the countdown ends exactly when the provider will accept a new key", async () => {
  // AC, executed end to end: a press inside the window is still deduped (so the
  // button must still be refusing), and a press once it has elapsed is a NEW
  // idempotency bucket that reaches the invitee for real.
  const transport = recorder();

  const first = await resendInvitationEmailAs(
    SC_ADMIN,
    INVITATION_ID,
    deps({ send: transport.send })
  );
  const { remainingMs } = first.dedupeWindow;

  for (const now of [
    new Date(NOW.getTime() + remainingMs - 1), // the last instant inside
    new Date(NOW.getTime() + remainingMs), // the first instant outside
  ]) {
    await resendInvitationEmailAs(
      SC_ADMIN,
      INVITATION_ID,
      deps({ send: transport.send, now })
    );
  }

  const [opened, insideWindow, afterWindow] = transport.sent.map(
    (message) => message.idempotencyKey
  );

  assert.equal(insideWindow, opened, "still inside the window, still deduped");
  assert.notEqual(afterWindow, opened, "the window elapsed — a real send");
});

// "resend-window.ts imports nothing" USED TO LIVE HERE and now lives in
// `register-path.test.ts` §2, off the `DOMAIN_LEAVES` table that also asserts
// nothing else re-exports the leaf (swept 2026-08-13, #411). The split was the
// bug: this file held rule 1 for this leaf, that file held rule 2 for the other
// one, and so `email.ts` re-exported THIS leaf's three symbols for four months
// with both suites green. One table, both properties, every leaf.

// ----------------------------------------------------------------------------
// 8. The surface refuses for the window, and says how long
// ----------------------------------------------------------------------------

/**
 * `ResendEmailButton` and its cooldown hook, comments stripped and bounded at
 * the next declaration. Stripped because both explain this ruling at length, and
 * an assertion about what the component RENDERS must not be satisfiable by a
 * sentence about what it used to render.
 */
function resendButtonSource(): string {
  return stripComments(
    LIST.span("type ResendCooldown", "const initialRevokeState")
  );
}

test("the action hands the surface the server's window and invents nothing", () => {
  const action = stripComments(
    ACTIONS.span(
      "export async function resendInvitationEmailAction",
      "export async function revokeInvitationAction"
    )
  );

  assert.match(action, /window: result\.resendWindow\.index/);
  assert.match(action, /remainingMs: result\.resendWindow\.remainingMs/);
  // No fallback duration. A made-up wait is a claim about the provider too, so
  // a missing window means no cooldown rather than a guessed one.
  assert.doesNotMatch(action, /RESEND_DEDUPE_WINDOW_MS|60_000|60000/);
});

test("the button is disabled for the cooldown and counts it down in its own label", () => {
  const button = resendButtonSource();

  assert.match(button, /const cooling = secondsLeft > 0/);
  assert.match(button, /disabled=\{pending \|\| cooling\}/);
  assert.match(button, /resendCooldownLabel\(secondsLeft\)/);
  // Native `disabled`, and never both attributes on one element: the send truly
  // cannot happen, so the platform's own unavailable state is the honest one and
  // it is the guard no submission path can get around.
  assert.doesNotMatch(button, /aria-disabled/);
});

test("the countdown is never announced — the live region says 'Email sent' once", () => {
  // A `role="status"` whose text changed every second would announce a number
  // to a screen reader on every tick, which is the row unusable. So the claim
  // and the countdown are different elements: the region holds a fixed sentence,
  // and the ticking value lives in the button's label, which is not live.
  const button = resendButtonSource();
  // Both ends through the reader, and the close tag is resolved RELATIVE to the
  // live region — the component closes an earlier `<span>` before it. The close
  // used to be a bare `indexOf`, so a region rewritten to close some other way
  // would have made this the whole rest of the component. There is no
  // `assert.ok(region.length > 0)` floor any more because there cannot be one
  // worth writing: `span` throws first, and a floor that can never fire is the
  // defect this domain keeps finding.
  const fromStatus = sourceReader(button, "ResendEmailButton").after(
    'role="status"'
  );
  const region = sourceReader(
    fromStatus,
    'ResendEmailButton\'s role="status" region'
  ).span('role="status"', "</span>");

  assert.doesNotMatch(region, /secondsLeft|cooling|cooldown/);
  assert.match(region, /Email sent/);
  // The sentence is written ONCE, so the claim cannot drift into a second place
  // — a copy in the button's own label would be announced on every tick. This is
  // a source-shape assertion about where the string lives, and NOTHING MORE: it
  // says nothing about how many times the region renders at runtime. The test
  // below is what speaks to that.
  assert.equal(button.match(/Email sent/g)?.length, 1);
});

test("a keyboard send keeps its place — focus moves to the outcome, not to <body>", () => {
  // PR #392 warning (b), measured on the preview and fixed 2026-08-12. Round 2
  // made the button natively `disabled` the instant a send succeeds, and a
  // disabled element cannot hold focus — so pressing Enter dropped
  // `document.activeElement` to `<body>` and threw a keyboard user to the top
  // of the page. The remedy keeps the native `disabled` (it is the only guard
  // no submission path gets around) and hands focus to the sentence that says
  // what happened, which is inside the row and one Tab from Revoke.
  const button = resendButtonSource();

  // The seam: a ref on the status span, and an effect that focuses it.
  assert.match(button, /ref=\{sentNotice\}/);
  assert.match(button, /sentNotice\.current\?\.focus\(\)/);

  // Keyed on the SEND, so it fires once per completed send: not on mount
  // (`state.sent` starts false) and not on every tick of the countdown, which
  // changes neither dependency. A tick that re-stole focus would be worse than
  // the bug.
  assert.match(button, /const sent = Boolean\(state\.sent\) && !pending/);
  assert.match(
    button,
    /useEffect\(\(\) => \{\s*if \(sent\)[\s\S]*?\}, \[sent\]\)/
  );

  // Focusable programmatically, never a Tab stop, and the ring is not
  // suppressed — a sighted keyboard user has to be able to SEE where they were
  // put.
  assert.match(button, /tabIndex=\{-1\}/);
  assert.doesNotMatch(button, /outline-none|focus:outline-0/);

  // The button itself keeps the honest native state; the fix must not have
  // quietly traded it for the aria fake to keep focus where it was.
  assert.doesNotMatch(button, /aria-disabled/);
  assert.match(button, /disabled=\{pending \|\| cooling\}/);
});

test("NAMED LIMITATION: a session that never saw the send still gets a live button inside the window", async () => {
  // Executed, not asserted about — this is the case the cooldown CANNOT reach,
  // and it is pinned so that nobody reads §8's disabled-button assertions as a
  // guarantee the product does not make.
  //
  // ⚖ RULED 2026-08-12 (Sebastian, option (a) on PR #392): ACCEPTED AS IS. AC3
  // reads "no second 'Email sent' claim can appear inside one window", with no
  // session qualifier — and that letter loses to the round-1 no-persistence
  // ruling it was written under. Satisfying it across sessions needs a durable
  // last-send record, therefore a column and a migration, which round 1 refused
  // outright. The cooldown stays per client session, the "Email sent" copy
  // stays as written, and this test is the record. It is a residual, not a
  // defect awaiting a fix: retiring it takes a NEW ruling that reverses the
  // no-persistence constraint, not a patch.
  //
  // The cooldown lives in `useActionState`, which is per client session by the
  // ruling's own no-persistence constraint. Admin A resends; admin A reloads (or
  // admin B has the page open in another browser); the fresh mount has no
  // cooldown, so the button is live. Both calls below stand for that second
  // press inside the same bucket.
  const transport = recorder();

  const first = await resendInvitationEmailAs(
    SC_ADMIN,
    INVITATION_ID,
    deps({ send: transport.send })
  );
  const second = await resendInvitationEmailAs(
    SC_ADMIN,
    INVITATION_ID,
    deps({ send: transport.send, now: new Date(NOW.getTime() + 15_000) })
  );

  // One bucket, so ONE message: the provider collapses the second request onto
  // the first, and the invitee's inbox — the thing the window exists to protect
  // — is correct either way.
  assert.equal(
    transport.sent[1].idempotencyKey,
    transport.sent[0].idempotencyKey
  );

  // …and the second call still reports a send, because the server has nothing to
  // condition the claim on: nothing is persisted about delivery, and an
  // idempotent replay returns the ORIGINAL response, so the transport cannot
  // report "this one was collapsed" either. THIS is the residual defect, stated
  // in the PR body as a limitation rather than left for a reader to discover.
  assert.equal(first.emailSent, true);
  assert.equal(second.emailSent, true);

  // What the second call DOES carry is the same window the first did, so the
  // moment that fresh session receives an answer its button refuses for the
  // remainder — the claim is wrong once per session, never twice.
  assert.equal(second.dedupeWindow.index, first.dedupeWindow.index);
  assert.ok(second.dedupeWindow.remainingMs < first.dedupeWindow.remainingMs);
});

// ----------------------------------------------------------------------------
// 9. Nothing from the ruling ROUND survives it
// ----------------------------------------------------------------------------
//
// The four directions this ruling was decided from shipped as a throwaway bench
// behind `@/components/prototype-switcher`, mounted on the real
// `/oversight/invitations` page so Sebastian could operate them on a preview.
// Round 2 was ruled and the bench stayed — 421 disposable lines and a
// `dangerouslySetInnerHTML` localStorage script that would have rendered a fake
// invitee above a real admin's real pending list.
//
// The guard that existed for exactly this (`preference-matrix.test.ts` → "no
// prototype scaffolding survives the ruling") is scoped to ONE component, which
// is why it caught nothing here. This one is REPO-WIDE: the switcher is a
// development instrument, so the set of modules importing it is empty between
// rulings, whatever feature the next bench belongs to.
// ----------------------------------------------------------------------------

/** Every `.ts`/`.tsx` under `src/`, so the scan cannot be outrun by a new folder. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test("no prototype scaffolding survives the ruling — repo-wide", () => {
  const src = path.join(process.cwd(), "src");
  const switcher = path.join(src, "components", "prototype-switcher.tsx");

  const importers = sourceFiles(src).filter((file) => {
    // The switcher itself, and any test asserting about it, name it on purpose.
    if (file === switcher || /\.test\.tsx?$/.test(file)) return false;
    return /from "@\/components\/prototype-switcher"/.test(
      readFileSync(file, "utf8")
    );
  });

  assert.deepEqual(
    importers.map((file) => path.relative(process.cwd(), file)),
    [],
    "a prototype bench is mounted in shipping UI — delete it with the ruling"
  );

  // …and the bench modules themselves, which are the thing being mounted. A
  // switcher deleted from the page while its 400 lines of variants stay in the
  // tree is half a cleanup.
  assert.deepEqual(
    sourceFiles(src)
      .filter((file) => /-prototypes?\.tsx?$/.test(path.basename(file)))
      .map((file) => path.relative(process.cwd(), file)),
    [],
    "a throwaway prototype module is still in the tree"
  );
});

test("the client counts the server's number down — it never re-derives the window", () => {
  const list = stripComments(LIST_CODE);

  // What it counts down is the DURATION the server measured, and what it counts
  // with is elapsed time it measured itself. Neither is an instant: comparing a
  // server instant against a workstation clock is the bug this shape cannot have.
  assert.match(list, /cooldown\?\.remainingMs/);
  assert.match(list, /Date\.now\(\) - startedAtMs/);
  // And no second copy of the bucket arithmetic — the label and the provider key
  // must not be able to disagree about when the window ends.
  assert.doesNotMatch(list, /RESEND_DEDUPE_WINDOW_MS|60_000|60000/);
  assert.match(list, /from "@\/lib\/invitations\/resend-window"/);
  // …and it reaches the leaf, never the module that builds the key: that one
  // imports `@/lib/email/client`, so this import would ship the Resend SDK to
  // the browser. `resend` joins the list because it imports `core`, which
  // imports `@/db` — the trailing quote is what keeps `resend-window`, the leaf
  // this component legitimately needs, out of the pattern.
  assert.doesNotMatch(
    list,
    /from "@\/lib\/invitations\/(email|core|service|resend)"/
  );
});
