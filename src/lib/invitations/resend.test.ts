// `./core` → `./email` → `@/lib/email/client` builds a Resend instance at module
// scope, so the key has to exist before the imports below run. `node --test`
// gives each file its own process. The base URL is pinned for the same reason
// the other suites pin it: a link assertion must be about this fixture and not
// about whoever's `.env.local` is loaded.
process.env.RESEND_API_KEY = "re_test_key_not_a_real_credential";
process.env.NEXT_PUBLIC_APP_URL = "https://app.everyfield.test";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type {
  OrganizationInvitation,
  OrganizationInvitationStatus,
} from "@/db/schema/organization-invitation";

import {
  INVITATION_EXPIRED_MESSAGE,
  INVITATION_NOT_OURS_MESSAGE,
  InvitationError,
  orgInvitationQuery,
  resendInvitationEmailAs,
  resendRefusalMessage,
  type InvitationActor,
} from "./core";
import {
  RESEND_DEDUPE_WINDOW_MS,
  invitationEmailIdempotencyKey,
  sendInvitationEmail,
  type InvitationEmailFacts,
  type InvitationEmailMessage,
} from "./email";

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
//
// The database is not needed for any of it: the row read, the org-name read, the
// transport and the auto-expire write are all seams on `resendInvitationEmailAs`,
// each defaulting to the real thing (§4 pins the defaults).
// ============================================================================

const INVITATION_ID = "77777777-7777-4777-8777-777777777777";
const REPLACEMENT_ID = "88888888-8888-4888-8888-888888888888";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const INVITEE = "new-planter@example.test";
const ORG = "Redemption Hill";
const BASE = "https://app.everyfield.test";
const NOW = new Date("2026-08-10T14:30:00.000Z");
const EXPIRES = new Date("2026-09-03T23:30:00.000Z");

function actor(overrides: Partial<InvitationActor> = {}): InvitationActor {
  return {
    id: ADMIN_ID,
    role: "sending_church_admin",
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

/** Source minus comments — these files explain their rulings at length. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * `resendInvitationEmailAs`'s body, comments stripped. Bounded at the next
 * declaration so an assertion about what this function does cannot silently
 * become an assertion about the rest of the file.
 */
function resendBody(): string {
  const stripped = code(CORE_CODE);
  const start = stripped.indexOf(
    "export async function resendInvitationEmailAs"
  );
  const end = stripped.indexOf("export async function lookupInvitingOrgName");

  assert.ok(start >= 0 && end > start, "resendInvitationEmailAs moved");
  return stripped.slice(start, end);
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
  // back as a message the admin reads, next to the Copy link button it names.
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
        error.message ===
          "We could not send that email — copy the link and send it yourself"
    );
  }
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

test("every refusal reason has words, and none of them is a code", () => {
  // Exhaustive by construction — `resendRefusalMessage` switches on the union
  // with a `never` default, so a new reason is a compile error rather than a
  // silent fall-through. This checks the OTHER half: what comes out is a
  // sentence, never the reason code itself.
  const reasons = [
    "not_pending",
    "no_address",
    "no_inviting_org",
    "unknown_type",
    "provider_refused",
    "transport_threw",
    "preparation_threw",
  ] as const;

  for (const reason of reasons) {
    const message = resendRefusalMessage(reason);
    assert.ok(message.length > 0, reason);
    assert.ok(!message.includes(reason), message);
    assert.ok(!message.includes("_"), message);
  }
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
    actor({ role: "sending_church_admin", sendingChurchId: SENDING_CHURCH }),
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
      role: "network_admin",
      sendingChurchId: null,
      sendingNetworkId: NETWORK,
    }),
    INVITATION_ID
  ).toSQL();
  assert.match(network.sql, /"sending_network_id" = \$\d/);
  assert.ok(network.params.includes(NETWORK));
});

test("a role that cannot invite, and an admin with no org, match nothing", () => {
  // `invitingOrgOf` answers `false` for both, so the predicate matches no row
  // rather than degrading into "every invitation in the product".
  for (const nobody of [
    actor({ role: "planter", sendingChurchId: null }),
    actor({ role: "team_member", sendingChurchId: null }),
    actor({ role: "coach", sendingChurchId: null }),
    actor({ role: "sending_church_admin", sendingChurchId: null }),
    actor({ role: "network_admin", sendingChurchId: null }),
  ]) {
    const { sql } = orgInvitationQuery(nobody, INVITATION_ID).toSQL();
    assert.match(sql, /false/, nobody.role);
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
  assert.match(code(CORE_CODE), /orgInvitationQuery\(actor, invitationId\)/);
  assert.match(
    code(SERVICE_CODE),
    /resendInvitationEmailAs\(actor, invitationId\)/
  );
  // The actor is minted from the session, never taken as an argument.
  assert.match(
    code(SERVICE_CODE),
    /export async function resendInvitationEmail\(\s*invitationId: string\s*\)/
  );
});

// ----------------------------------------------------------------------------
// 5. Nothing persisted, nothing logged
// ----------------------------------------------------------------------------

test("the resend persists nothing about delivery", () => {
  // The ruling chose C over B: no `email_sent` column, no migration, no badge.
  // `sent` from a provider is acceptance, not a delivery receipt, so a stored
  // flag would assert something the product never observes.
  for (const forbidden of [/email_sent/, /emailSentAt/, /deliveredAt/]) {
    assert.doesNotMatch(code(CORE_CODE), forbidden, String(forbidden));
    assert.doesNotMatch(code(LIST_CODE), forbidden, String(forbidden));
    assert.doesNotMatch(code(ACTIONS_CODE), forbidden, String(forbidden));
  }

  // The one write the resend path may make is the auto-expire, and it is the
  // existing compare-and-set rather than a new statement.
  assert.doesNotMatch(resendBody(), /db\.update|db\.insert|db\.batch/);
});

test("no resend path logs the token, the address or the link", () => {
  // The invitation id IS the register bearer token. Source-shaped for the same
  // reason `email.test.ts` is: the property is about what the code CAN log.
  const body = code(CORE_CODE).slice(
    code(CORE_CODE).indexOf("// Resend"),
    code(CORE_CODE).indexOf("// Respond")
  );

  for (const call of [...body.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].map(
    (match) => match[1]
  )) {
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
  assert.doesNotMatch(code(LIST_CODE), /canResend/);
});

test("the Resend control is a button with cursor-pointer and an accessible name", () => {
  const button = LIST_CODE.slice(
    LIST_CODE.indexOf("function ResendEmailButton"),
    LIST_CODE.indexOf("const initialRevokeState")
  );

  assert.ok(button.length > 0, "ResendEmailButton is missing");
  assert.match(button, /className="cursor-pointer"/);
  assert.match(button, /type="submit"/);
  // The visible label repeats on every pending row, so the address is what
  // makes each one distinguishable to a screen reader.
  assert.match(button, /<span className="sr-only"> to \{email\}<\/span>/);
  // A failure is announced, not swallowed into the label.
  assert.match(button, /role="alert"/);
  assert.match(button, /role="status"/);
  // The button reports its own in-flight state rather than leaving the admin
  // wondering whether the click landed.
  assert.match(button, /disabled=\{pending\}/);
  assert.match(button, /Sending…/);
});

test("the action refuses a malformed id before anything is sent", () => {
  const action = ACTIONS_CODE.slice(
    ACTIONS_CODE.indexOf("export async function resendInvitationEmailAction"),
    ACTIONS_CODE.indexOf("export async function revokeInvitationAction")
  );

  assert.ok(action.length > 0, "resendInvitationEmailAction is missing");
  assert.match(action, /resendSchema\.safeParse/);
  assert.match(action, /if \(!parsed\.success\)/);
  // No actor argument: the service mints one from `verifySession()`.
  assert.doesNotMatch(action, /userId|actor/);
});
