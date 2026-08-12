// `./core` → `./email` → `@/lib/email/client` builds a Resend instance at module
// scope, so the key has to exist before the imports below run. `node --test`
// gives each file its own process. The base URL is pinned for the same reason
// `email.test.ts` pins it: a link assertion must be about this fixture, not
// about whoever's `.env.local` is loaded.
process.env.RESEND_API_KEY = "re_test_key_not_a_real_credential";
process.env.NEXT_PUBLIC_APP_URL = "https://app.everyfield.test";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { OrganizationInvitation } from "@/db/schema/organization-invitation";

import { emailInvitee } from "./core";
import type { InvitationEmailMessage } from "./email";
import { sourceReader } from "./source-span";

// ============================================================================
// The WIRING — OV-003b (#293), the link `email.test.ts` cannot see.
//
// `email.test.ts` proves everything about `sendInvitationEmail`: the payload,
// the copy, the pending guard, the idempotency key, the log hygiene, and that a
// refused or throwing transport comes back as `{ sent: false }`. All of it is
// true whether or not anything ever calls it.
//
// `emailInvitee` is what calls it, and it is the only step in the chain
// `createInvitationAction → createInvitation → createInvitationAs →
// emailInvitee → sendInvitationEmail` that has no other cover: it reads the
// database for the inviting org's name, so it used to be reachable only with a
// connection. It now takes that read and the transport as seams, both defaulting
// to the real thing, and this file drives them.
//
// Two properties, and they are the two the send path cannot state about itself:
//
//   1. The transport is actually invoked, with the payload built from the row —
//      the token-bound register URL included.
//   2. A THROWING org-name lookup yields `emailSent: false` and not a rejected
//      create. `sendInvitationEmail` swallows its own failures; it cannot
//      swallow one that happens before it is called, and the create is already
//      committed by then.
// ============================================================================

const INVITATION_ID = "77777777-7777-4777-8777-777777777777";
const INVITEE = "new-planter@example.test";
const ORG = "Redemption Hill";
const BASE = "https://app.everyfield.test";

function invitation(
  overrides: Partial<OrganizationInvitation> = {}
): OrganizationInvitation {
  return {
    id: INVITATION_ID,
    type: "church_to_sending_church",
    status: "pending",
    inviteeEmail: INVITEE,
    invitedByUserId: "44444444-4444-4444-8444-444444444444",
    respondedByUserId: null,
    targetChurchId: null,
    targetSendingChurchId: null,
    sendingChurchId: "22222222-2222-4222-8222-222222222222",
    sendingNetworkId: null,
    expiresAt: new Date("2026-09-03T23:30:00.000Z"),
    respondedAt: null,
    createdAt: new Date("2026-08-04T12:00:00.000Z"),
    ...overrides,
  } as OrganizationInvitation;
}

function recorder(
  result: { success: boolean; error?: string } = {
    success: true,
  }
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
// 1. Something actually sends
// ----------------------------------------------------------------------------

test("emailInvitee invokes the transport with the payload built from the row", async () => {
  const transport = recorder();

  const sent = await emailInvitee(invitation(), {
    lookupOrgName: async () => ORG,
    send: transport.send,
  });

  assert.equal(sent, true);
  assert.equal(transport.sent.length, 1, "the transport was never called");

  const message = transport.sent[0];
  assert.equal(message.to, INVITEE);
  assert.match(message.subject, new RegExp(ORG));
  // The token-bound register URL from #289, in the body and the plain-text part.
  assert.match(message.html, new RegExp(`${BASE}/register\\?invitation=`));
  assert.match(message.text, new RegExp(INVITATION_ID));
  // Keyed on the invitation, which is what makes a re-invitation after a revoke
  // deliverable rather than deduped away (see `email.test.ts`).
  assert.equal(message.idempotencyKey, `org-invitation-${INVITATION_ID}`);
});

test("a refused provider comes back as false, not as a throw", async () => {
  const transport = recorder({ success: false, error: "Invalid `to` field" });

  const sent = await emailInvitee(invitation(), {
    lookupOrgName: async () => ORG,
    send: transport.send,
  });

  assert.equal(sent, false);
});

// ----------------------------------------------------------------------------
// 2. The lookup is a database read, and a database read can throw
// ----------------------------------------------------------------------------

test("a throwing org-name lookup yields false rather than failing the create", async () => {
  // The AC's durability clause, at the layer that owns the risk. The invitation
  // row is committed before this runs (`createInvitationAs` sends LAST), so a
  // throw escaping here would surface to the admin as "something went wrong"
  // over an invitation that exists — and their retry would then hit the
  // duplicate-pending refusal, with no way forward.
  const transport = recorder();

  const sent = await emailInvitee(invitation(), {
    lookupOrgName: async () => {
      throw new Error("connection terminated unexpectedly");
    },
    send: transport.send,
  });

  assert.equal(sent, false);
  assert.equal(transport.sent.length, 0, "nothing should have been sent");
});

test("an org with no name sends nothing rather than an unsigned invitation", async () => {
  // An email that misnames its sender is indistinguishable from a phishing
  // attempt; the invitee's only check is that the org matches what they were
  // told to expect. `sendInvitationEmail` refuses it — this proves the refusal
  // survives the wiring rather than being papered over with a placeholder.
  const transport = recorder();

  const sent = await emailInvitee(invitation(), {
    lookupOrgName: async () => null,
    send: transport.send,
  });

  assert.equal(sent, false);
  assert.equal(transport.sent.length, 0);
});

test("a revoked invitation sends nothing, even through this path", async () => {
  const transport = recorder();

  const sent = await emailInvitee(invitation({ status: "revoked" }), {
    lookupOrgName: async () => ORG,
    send: transport.send,
  });

  assert.equal(sent, false);
  assert.equal(transport.sent.length, 0);
});

// ----------------------------------------------------------------------------
// 3. The create still reaches it, and still reaches it LAST
// ----------------------------------------------------------------------------

test("createInvitationAs sends after the row is committed, and reports the outcome", () => {
  // Source-shaped: `createInvitationAs` needs a database. The ORDER is the
  // property — an invitation that exists but was not emailed is repaired by
  // Resend email on its row; an email sent for a row that failed to insert is a
  // link to nothing.
  //
  // Through the reader, so a moved anchor throws instead of quietly widening
  // this to the whole module (`./source-span`).
  const body = sourceReader(
    readFileSync(path.join(__dirname, "core.ts"), "utf8"),
    "core.ts"
  ).span(
    "export async function createInvitationAs",
    "export async function emailInvitee"
  );

  assert.ok(
    body.indexOf("await insertInvitation") < body.indexOf("emailInvitee("),
    "the row must be committed before anything is sent"
  );
  assert.match(body, /emailSent: await emailInvitee\(invitation\)/);
});
