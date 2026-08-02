// The client constructs a Resend instance at module scope, so the key has to
// exist before the import runs. `node --test` gives each file its own process,
// so writing it here cannot leak into another suite. The value is never used —
// every test below replaces the transport.
process.env.RESEND_API_KEY = "re_test_key_not_a_real_credential";

import assert from "node:assert/strict";
import { test } from "node:test";

import { EMAIL_FROM, resend, sendEmail } from "./client";

// ============================================================================
// What actually reaches the provider (N-007, RFC 8058 ruling 2026-08-01).
//
// `composeBatchEmail` builds the RFC 8058 header pair and `dispatch` hands it
// down, but neither of those proves the pair survives the last hop. This suite
// asserts the PAYLOAD — the object handed to `resend.emails.send` — because
// that is the only place the claim "outgoing notification emails carry
// List-Unsubscribe and List-Unsubscribe-Post" is finally true or false.
//
// The failure this guards against is quiet and expensive: a send path that
// drops the headers still delivers mail, and the only symptom is readers
// pressing "spam" because their client offers no unsubscribe control.
// ============================================================================

interface SendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}

/** Replace the transport and record what it was handed. */
function recordSends(t: {
  mock: { method: typeof import("node:test").mock.method };
}): SendPayload[] {
  const calls: SendPayload[] = [];
  t.mock.method(resend.emails, "send", async (payload: SendPayload) => {
    calls.push(payload);
    return { data: { id: "provider-message-id" }, error: null };
  });
  return calls;
}

const UNSUBSCRIBE_LINK =
  "https://app.everyfield.test/api/notifications/unsubscribe?token=sealed-token";

test("the RFC 8058 header pair reaches the provider payload intact", async (t) => {
  const calls = recordSends(t);

  const result = await sendEmail({
    to: "planter@example.test",
    subject: "Tasks — 3 updates",
    html: "<p>three things happened</p>",
    text: "three things happened",
    headers: {
      "List-Unsubscribe": `<${UNSUBSCRIBE_LINK}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.id, "provider-message-id");
  assert.equal(calls.length, 1);

  const payload = calls[0];
  // Angle-bracketed, as RFC 2369 requires — a bare URL is ignored by clients.
  assert.equal(payload.headers?.["List-Unsubscribe"], `<${UNSUBSCRIBE_LINK}>`);
  // The second header is the whole point of the ruling: without it a client
  // GETs the link, and the GET now only renders a page.
  assert.equal(
    payload.headers?.["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click"
  );
});

test("the idempotency key travels alongside the list headers, not instead of them", async (t) => {
  // The regression this pins: the header map used to be built fresh for the
  // idempotency key, so spreading the caller's headers in the wrong order —
  // or not at all — silently dropped the opt-out control.
  const calls = recordSends(t);

  await sendEmail({
    to: "planter@example.test",
    subject: "Tasks — 3 updates",
    html: "<p>x</p>",
    idempotencyKey: "notif-batch-1",
    headers: {
      "List-Unsubscribe": `<${UNSUBSCRIBE_LINK}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  const headers = calls[0].headers ?? {};
  assert.deepEqual(Object.keys(headers).sort(), [
    "Idempotency-Key",
    "List-Unsubscribe",
    "List-Unsubscribe-Post",
  ]);
  assert.equal(headers["Idempotency-Key"], "notif-batch-1");
});

test("a caller cannot overwrite the idempotency key through the header map", async (t) => {
  // Provider-side dedupe is the dispatcher's braces against a double send. A
  // caller-supplied header must not be able to unpick it.
  const calls = recordSends(t);

  await sendEmail({
    to: "planter@example.test",
    subject: "s",
    html: "<p>x</p>",
    idempotencyKey: "the-real-key",
    headers: { "Idempotency-Key": "an-attackers-key" },
  });

  assert.equal(calls[0].headers?.["Idempotency-Key"], "the-real-key");
});

test("an email with no extra headers still sends, carrying only what it has", async (t) => {
  // Non-notification mail (invites, RSVPs) passes no header map at all.
  const calls = recordSends(t);

  await sendEmail({
    to: "planter@example.test",
    subject: "s",
    html: "<p>x</p>",
  });

  assert.deepEqual(calls[0].headers, {});
  assert.equal(calls[0].from, EMAIL_FROM);
  assert.deepEqual(calls[0].to, ["planter@example.test"]);
});

test("a provider refusal is reported, not thrown, so a delivery row can record it", async (t) => {
  t.mock.method(resend.emails, "send", async () => ({
    data: null,
    error: { message: "Invalid `to` field", name: "validation_error" },
  }));

  const result = await sendEmail({
    to: "not-an-address",
    subject: "s",
    html: "<p>x</p>",
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "Invalid `to` field");
});
