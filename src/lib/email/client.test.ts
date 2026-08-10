// The client constructs a Resend instance at module scope, so the key has to
// exist before the import runs. `node --test` gives each file its own process,
// so writing it here cannot leak into another suite. The value is never used —
// every test below replaces the transport.
process.env.RESEND_API_KEY = "re_test_key_not_a_real_credential";

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_EMAIL_FROM,
  EMAIL_FROM,
  EMAIL_REPLY_TO,
  resend,
  sendEmail,
} from "./client";

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
  replyTo?: string;
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

test("the sending identity is the domain we actually own", async () => {
  // RULED 2026-07-31 (#245): the product's domain is `everyfield.app`. This
  // default used to name `everyfield.com`, which we do not send from — a `from`
  // on an unverified domain fails DKIM/SPF alignment, so the mail bounces or
  // lands in spam and nothing in the app can tell the two apart.
  //
  // Asserted on the DEFAULT, not on the resolved value: any machine running the
  // suite may set `EMAIL_FROM`, and asserting the resolved one would be a test
  // of that machine's `.env.local`.
  assert.match(DEFAULT_EMAIL_FROM, /@everyfield\.app>$/);
  assert.doesNotMatch(DEFAULT_EMAIL_FROM, /everyfield\.(dev|com)/);

  // Whatever the environment sets, a reply has somewhere to land and it is
  // never a `noreply@` — people reply to transactional mail, and an invited
  // planter asking "is this really from you?" is the expected case.
  assert.ok(EMAIL_FROM.length > 0);
  assert.ok(EMAIL_REPLY_TO.length > 0);
  assert.doesNotMatch(EMAIL_REPLY_TO, /noreply|no-reply/i);
});

test("reply-to reaches the provider when one is given, and is absent when not", async (t) => {
  const calls = recordSends(t);

  await sendEmail({
    to: "planter@example.test",
    subject: "s",
    html: "<p>x</p>",
    replyTo: EMAIL_REPLY_TO,
  });
  assert.equal(calls[0].replyTo, EMAIL_REPLY_TO);

  // Omitted rather than sent as `undefined`: a provider that validates its
  // payload shape rejects the key with no value, and the client's own default
  // (reply to `from`) is the behaviour we want when nobody asked.
  await sendEmail({
    to: "planter@example.test",
    subject: "s",
    html: "<p>x</p>",
  });
  assert.ok(!("replyTo" in calls[1]), JSON.stringify(Object.keys(calls[1])));
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

test("a failing send never logs the message it was carrying", async (t) => {
  // #293's rule 4, enforced one layer lower than `@/lib/invitations/email`.
  // That module refuses to log the invitation id or the URL built from it — but
  // it delegates the actual send to here, and a thrown transport error is free
  // to quote the request that produced it. `console.error("…", err)` then prints
  // the whole request, HTML body included, and the invitation email's body holds
  // `/register?invitation=<id>` — which is the register bearer token and the
  // beta-gate bypass. So the logs carry the message text and nothing else.
  const logged: unknown[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(...args);
  });

  const SECRET_URL =
    "https://app.everyfield.test/register?invitation=77777777-7777-4777-8777-777777777777";

  // A throwing transport, whose error quotes the payload the way a real
  // fetch/validation failure does.
  t.mock.method(resend.emails, "send", async (payload: SendPayload) => {
    throw new Error(`request failed: ${JSON.stringify(payload)}`);
  });

  const thrown = await sendEmail({
    to: "planter@example.test",
    subject: "Grace Church invited you to EveryField",
    html: `<a href="${SECRET_URL}">Accept</a>`,
    text: SECRET_URL,
  });
  assert.equal(thrown.success, false);

  // A provider refusal, same rule.
  t.mock.method(resend.emails, "send", async () => ({
    data: null,
    error: { message: "Invalid `to` field", name: "validation_error" },
  }));
  await sendEmail({
    to: "planter@example.test",
    subject: "Grace Church invited you to EveryField",
    html: `<a href="${SECRET_URL}">Accept</a>`,
  });

  const transcript = logged
    .map((entry) =>
      typeof entry === "string" ? entry : JSON.stringify(entry, null, 0)
    )
    .join("\n");

  // The credential is gone in both spellings: the id itself, and the URL that
  // carries it. That is the property — the rest of a quoted payload is noise,
  // and `redactForLog` caps it by truncating.
  assert.doesNotMatch(transcript, /77777777-7777-4777-8777-777777777777/);
  assert.doesNotMatch(transcript, /https?:\/\//);
  assert.doesNotMatch(transcript, /\/register\?invitation=/);
  assert.match(transcript, /\[url\]/, "the redaction marker should be visible");

  // …and the log is still useful: the provider's reason survives.
  assert.match(transcript, /Invalid `to` field/);
});

test("a runaway error message is truncated rather than flooding the drain", async (t) => {
  const logged: unknown[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(...args);
  });

  t.mock.method(resend.emails, "send", async () => {
    throw new Error("x".repeat(5000));
  });

  await sendEmail({
    to: "planter@example.test",
    subject: "s",
    html: "<p>x</p>",
  });

  const line = JSON.stringify(logged);
  assert.ok(line.length < 600, `log line was ${line.length} characters`);
  assert.match(line, /truncated/);
});
