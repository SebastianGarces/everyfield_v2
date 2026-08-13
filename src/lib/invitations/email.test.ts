// `@/lib/email/client` builds a Resend instance at module scope, so the key has
// to exist before the import below runs. `node --test` gives each file its own
// process, so neither of these can leak into another suite — and the base URL
// is pinned here so an assertion about a link is an assertion about this file's
// fixture, not about whoever's `.env.local` happens to be loaded.
process.env.RESEND_API_KEY = "re_test_key_not_a_real_credential";
process.env.NEXT_PUBLIC_APP_URL = "https://app.everyfield.test";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type {
  OrganizationInvitationStatus,
  OrganizationInvitationType,
} from "@/db/schema/organization-invitation";
import { formatDate } from "@/lib/datetime";

import {
  buildInvitationEmail,
  invitationOrgKinds,
  invitationRegisterUrl,
  sendInvitationEmail,
  type InvitationEmailFacts,
  type InvitationEmailMessage,
} from "./email";
// From the LEAF, deliberately — this module does not re-export the spelling,
// and a test that imported it from `./email` would be the one consumer keeping
// that second door plausible (`register-path.test.ts` §2).
import { invitationRegisterPath } from "./register-path";

// ============================================================================
// OV-003b (#293) — creating an invitation SENDS it.
//
// The unit under test is the send path, driven through `InvitationEmailDeps`
// rather than a database or a live provider: what the ACs are about is the
// PAYLOAD, the guards around it and what happens when the provider says no,
// and all three are decidable without either.
//
// The five ACs and where each is executed:
//
//   1. "the invitee receives an email: who invited them, what accepting means,
//      the invite-link CTA, and the address binding said plainly"
//        → "the message names the org, the link and the address it is bound to"
//   2. "plain-text part included; from/reply-to follow the sender identity"
//        → the same test, plus `../email/client.test.ts` for the `from`
//   3. "send failure does not fail the create — forced-failure test"
//        → "a refused provider is reported, never thrown" and
//          "a transport that throws is reported, never thrown"
//   4. "revoked invitations send nothing further; re-inviting after revoke
//      sends a fresh email with the new token"
//        → "a revoked invitation is never emailed" and "re-inviting after a
//          revoke carries the NEW token"
//   5. "no preference gate; not enqueued through the notifications machinery"
//        → "the invitation email is transactional, not a notification"
//   6. "no secrets/tokens logged"
//        → "no failure path logs the token or the link"
// ============================================================================

const INVITATION_ID = "77777777-7777-4777-8777-777777777777";
const REPLACEMENT_ID = "88888888-8888-4888-8888-888888888888";
const INVITEE = "new-planter@example.test";
const ORG = "Redemption Hill";
const BASE = "https://app.everyfield.test";
const EXPIRES = new Date("2026-09-03T23:30:00.000Z");

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

/**
 * Rendered HTML with its whitespace collapsed. React Email pretty-prints, so a
 * sentence can arrive wrapped across lines with indentation in the middle of
 * it; an assertion about COPY has to be about the words, not about where the
 * renderer chose to break them.
 */
const flat = (part: string) => part.replace(/\s+/g, " ");

/**
 * `./email.ts` with its comments removed. Two assertions below are about what
 * the module DOES — that it reaches no notification machinery, and that it logs
 * no token — and the file explains both rules by naming the things it forbids.
 * Scanning the raw source would fail on the documentation of the rule it
 * enforces, which is the classic way a guardrail gets deleted for being wrong.
 */
const SEND_CODE = readFileSync(path.join(__dirname, "email.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/.*$/gm, "$1");

/** A transport that records what it was handed. */
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

// ----------------------------------------------------------------------------
// 1. The link
// ----------------------------------------------------------------------------

test("the invite link is the token-bound register URL", () => {
  // The shape #23 / PR #289 established: `/register?invitation=<id>`, which is
  // what `describeInvitationForRegistration` and `hasValidInvitationBypass`
  // read. Absolute, because a relative href in an inbox resolves against the
  // mail client and reaches nothing.
  assert.equal(
    invitationRegisterPath(INVITATION_ID),
    `/register?invitation=${INVITATION_ID}`
  );
  assert.equal(
    invitationRegisterUrl(INVITATION_ID, BASE),
    `${BASE}/register?invitation=${INVITATION_ID}`
  );

  // With no override it reads the app's own base, never a relative path.
  assert.ok(invitationRegisterUrl(INVITATION_ID).startsWith("https://"));

  // The id is escaped on the way into the query, so a value that is not a uuid
  // cannot close the parameter and append another one.
  assert.ok(
    !invitationRegisterPath("a&admin=1").includes("&admin=1"),
    "an id is interpolated into the query unescaped"
  );
});

// ----------------------------------------------------------------------------
// 2. What lands in the inbox
// ----------------------------------------------------------------------------

test("the message names the org, the link and the address it is bound to", async () => {
  const transport = recorder();
  const outcome = await sendInvitationEmail(facts(), {
    send: transport.send,
    baseUrl: BASE,
  });

  assert.deepEqual(outcome, { sent: true });
  assert.equal(transport.sent.length, 1);

  const message = transport.sent[0];
  const link = `${BASE}/register?invitation=${INVITATION_ID}`;

  assert.equal(message.to, INVITEE);
  // Subject leads with the inviting org: in a crowded inbox the first word is
  // the only one a reader is guaranteed to see, and "who is this from" is the
  // question an unexpected invitation has to answer first.
  assert.match(message.subject, new RegExp(`^${ORG}\\b`));

  for (const raw of [message.html, message.text]) {
    const part = flat(raw);
    assert.ok(part.includes(ORG), "the inviting org is not named");
    assert.ok(raw.includes(link), "the invite link is missing");
    assert.ok(part.includes(INVITEE), "the bound address is not stated");
    // "What accepting means" — the invitee is consenting to an association, and
    // the copy has to say what it exposes.
    assert.match(part, /accepting means/i);
    // The credential-channel sentence, in words rather than in a warning icon.
    assert.match(part, /only works for that address/i);
    assert.ok(
      part.includes(formatDate(EXPIRES)),
      "the expiry is missing or was formatted in the sending process's zone"
    );
  }

  // A text/plain alternative is not optional on transactional mail: it is what a
  // text-only client, a screen reader and a spam filter each read.
  assert.ok(message.text.trim().length > 0);
  assert.ok(!message.text.includes("<a "), "the plain part carries markup");

  // Reply-to is a real, monitored, same-domain mailbox rather than a `noreply@`
  // — people do reply to an invitation asking "is this really you?".
  assert.ok(message.replyTo.length > 0);
  assert.doesNotMatch(message.replyTo, /noreply|no-reply/i);

  // Keyed on the INVITATION, so a retried create dedupes and a re-invitation
  // does not (see the revoke test below).
  assert.ok(message.idempotencyKey.includes(INVITATION_ID));
});

test("the invitation email is transactional, not a notification", async () => {
  // AC: "no preference gate applies (the invitee may not even have an account);
  // do not enqueue through the notifications category machinery."
  //
  // Asserted two ways. The MESSAGE carries no unsubscribe apparatus — there is
  // no account, so there is no category to turn off and a link offering one
  // would 404 or, worse, opt out a stranger. And the MODULE reaches none of the
  // category machinery: `enqueue`, the dispatcher and the preference reads are
  // all absent from its imports.
  const transport = recorder();
  await sendInvitationEmail(facts(), { send: transport.send, baseUrl: BASE });

  const message = transport.sent[0];
  assert.ok(!("headers" in message), "an invitation carries no list headers");
  for (const part of [message.html, message.text]) {
    assert.doesNotMatch(part, /unsubscribe/i);
    assert.doesNotMatch(part, /notification preference/i);
  }

  for (const machinery of [
    /\benqueue\b/,
    /notifications\/enqueue/,
    /notifications\/dispatch/,
    /notifications\/preferences/,
    /NOTIFICATION_CATEGORIES/,
  ]) {
    assert.doesNotMatch(SEND_CODE, machinery, String(machinery));
  }
});

test("the copy claims exactly what an association exposes, and no more", async () => {
  // memory/invariants.md → Hierarchical Access Control: the oversight portfolio
  // listing is UNGATED (name, stage, launch countdown, health), and the six
  // `share_*` toggles default false and gate everything else. Consent copy that
  // promised "they see nothing until you share" would be false on the first
  // half; copy that implied full visibility would be false on the second.
  const built = await buildInvitationEmail(facts(), BASE);
  assert.ok(built.ok);

  const html = flat(built.message.html);
  assert.match(html, /its name, its stage, its launch countdown/i);
  assert.match(html, /stays off until you choose to share it/i);
});

// ----------------------------------------------------------------------------
// 3. Failure never reaches the invitation
// ----------------------------------------------------------------------------

test("a refused provider is reported, never thrown", async () => {
  // The forced-failure AC. The row is already committed by the time this runs,
  // so a throw here would either abort a successful create or — worse — be
  // caught upstream and reported as "something went wrong" over an invitation
  // that does exist.
  const outcome = await sendInvitationEmail(facts(), {
    send: async () => ({ success: false, error: "Invalid `to` field" }),
    baseUrl: BASE,
  });

  assert.deepEqual(outcome, { sent: false, reason: "provider_refused" });
});

test("a transport that throws is reported, never thrown", async () => {
  const outcome = await sendInvitationEmail(facts(), {
    send: async () => {
      throw new Error("ECONNRESET");
    },
    baseUrl: BASE,
  });

  assert.deepEqual(outcome, { sent: false, reason: "transport_threw" });
});

test("an invitation with nothing honest to say is not sent", async () => {
  // Each of these would produce an email that misinforms the reader, and an
  // invitation email that misnames its sender is indistinguishable from a
  // phishing attempt — the invitee's only check is that the name matches what
  // they were told to expect.
  const cases: Array<[Partial<InvitationEmailFacts>, string]> = [
    [{ invitingOrgName: null }, "no_inviting_org"],
    [{ invitingOrgName: "   " }, "no_inviting_org"],
    [{ inviteeEmail: null }, "no_address"],
    [{ inviteeEmail: "  " }, "no_address"],
    [
      { type: "CHURCH_TO_NETWORK" as unknown as OrganizationInvitationType },
      "unknown_type",
    ],
  ];

  for (const [override, reason] of cases) {
    const transport = recorder();
    const outcome = await sendInvitationEmail(facts(override), {
      send: transport.send,
      baseUrl: BASE,
    });

    assert.deepEqual(
      outcome,
      { sent: false, reason },
      JSON.stringify(override)
    );
    assert.equal(transport.sent.length, 0, "a refused invitation still sent");
  }
});

test("an unrecognised type resolves to no org kinds at all", () => {
  assert.deepEqual(invitationOrgKinds("church_to_sending_church"), {
    inviting: "sending church",
    invitee: "church plant",
  });
  assert.deepEqual(invitationOrgKinds("church_to_network"), {
    inviting: "network",
    invitee: "church plant",
  });
  assert.deepEqual(invitationOrgKinds("sending_church_to_network"), {
    inviting: "network",
    invitee: "sending church",
  });

  for (const type of [
    "CHURCH_TO_NETWORK",
    "church_to_sending_church ",
    "",
  ] as unknown as OrganizationInvitationType[]) {
    assert.equal(invitationOrgKinds(type), null, type);
  }
});

// ----------------------------------------------------------------------------
// 4. Revoke, and re-invite
// ----------------------------------------------------------------------------

test("a revoked invitation is never emailed", async () => {
  // "Revoked invitations send nothing further." The guard is on STATUS and it
  // lives in the send path, not at a call site, so it holds for a retry written
  // later as much as for today's single caller. An answered or expired row is
  // the same fact and gets the same silence.
  for (const status of [
    "revoked",
    "accepted",
    "declined",
    "expired",
  ] as OrganizationInvitationStatus[]) {
    const transport = recorder();
    const outcome = await sendInvitationEmail(facts({ status }), {
      send: transport.send,
      baseUrl: BASE,
    });

    assert.deepEqual(outcome, { sent: false, reason: "not_pending" }, status);
    assert.equal(transport.sent.length, 0, status);
  }
});

test("re-inviting after a revoke carries the NEW token", async () => {
  // The whole sequence the AC describes, as one run: an invitation is revoked,
  // the org invites the same address again, and what leaves is a fresh message
  // pointing at the new row.
  //
  // The dedupe key is the half that could have broken this silently. Keyed on
  // `to + subject` — same address, same inviting org, therefore the same
  // string — Resend would have treated the replacement as a duplicate of the
  // dead one and dropped it, and nothing in the app would have noticed.
  const transport = recorder();

  const revoked = await sendInvitationEmail(facts({ status: "revoked" }), {
    send: transport.send,
    baseUrl: BASE,
  });
  assert.deepEqual(revoked, { sent: false, reason: "not_pending" });

  const reissued = await sendInvitationEmail(
    facts({ invitationId: REPLACEMENT_ID }),
    { send: transport.send, baseUrl: BASE }
  );
  assert.deepEqual(reissued, { sent: true });

  assert.equal(transport.sent.length, 1, "the revoked invitation was emailed");

  const message = transport.sent[0];
  assert.ok(message.html.includes(REPLACEMENT_ID), "the new token is missing");
  assert.ok(
    !message.html.includes(INVITATION_ID),
    "the dead token is still in the message"
  );
  assert.ok(message.idempotencyKey.includes(REPLACEMENT_ID));
  assert.ok(!message.idempotencyKey.includes(INVITATION_ID));
});

// ----------------------------------------------------------------------------
// 5. The token stays out of the logs
// ----------------------------------------------------------------------------

test("no failure path logs the token or the link", () => {
  // The invitation id IS the credential: it is the register bearer token and
  // the private-beta bypass (`hasValidInvitationBypass`). A log drain is not
  // where it belongs, and neither is the URL built from it.
  //
  // Source-shaped because the property is about what the code CAN log, not
  // about what today's inputs happen to produce — and the tempting fix for a
  // debugging session is exactly the line this forbids.
  // Everything from each `console.*(` to the end of its statement. Over-
  // approximate on purpose: a call that swallows the next few lines produces a
  // false failure somebody reads, while a stricter matcher that stops early
  // produces a silent pass over the argument that leaked.
  const logged = [...SEND_CODE.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].map(
    (match) => match[1]
  );

  assert.ok(logged.length > 0, "no console calls found — check the pattern");

  for (const call of logged) {
    for (const forbidden of [
      /invitationId/,
      /inviteeEmail/,
      /inviteUrl/,
      // The facts record carries the id and the address, so it may only ever be
      // read for `type` — which names a KIND of invitation and identifies
      // nothing. Spreading it, or logging one of its other fields, fails here.
      /\bfacts\b(?!\.type\b)/,
      // The rendered payload holds the link in three places (the button, the
      // pasteable fallback and the plain-text part), so it never goes near a
      // log either — `error.message`, a provider string, is a different thing
      // and is allowed.
      /\bbuilt\b/,
      /\bmessage\.(to|subject|html|text|replyTo|idempotencyKey)\b/,
      /registerUrl/,
    ]) {
      assert.doesNotMatch(call, forbidden, `${forbidden} in: ${call}`);
    }
  }
});
