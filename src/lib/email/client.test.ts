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

/**
 * The SECOND argument, and it is a different thing from `SendPayload.headers`.
 * `headers` is the message's own RFC header block, copied onto the mail; this
 * is the HTTP request, which is the only place the provider looks for dedupe.
 */
interface SendOptions {
  idempotencyKey?: string;
}

/** Replace the transport and record BOTH arguments it was handed. */
function recordSends(t: {
  mock: { method: typeof import("node:test").mock.method };
}): { payloads: SendPayload[]; options: (SendOptions | undefined)[] } {
  const payloads: SendPayload[] = [];
  const options: (SendOptions | undefined)[] = [];
  t.mock.method(
    resend.emails,
    "send",
    async (payload: SendPayload, opts?: SendOptions) => {
      payloads.push(payload);
      options.push(opts);
      return { data: { id: "provider-message-id" }, error: null };
    }
  );
  return { payloads, options };
}

const UNSUBSCRIBE_LINK =
  "https://app.everyfield.test/api/notifications/unsubscribe?token=sealed-token";

test("the RFC 8058 header pair reaches the provider payload intact", async (t) => {
  const { payloads: calls } = recordSends(t);

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

test("the idempotency key is HONOURED, not mailed — it goes to the request, the list headers to the message", async (t) => {
  // The bug this pins, found on the #293 resend and true of every send in the
  // product: the key was written into `payload.headers`, which resend@6 treats
  // as custom RFC headers ON THE MESSAGE. It type-checked, it delivered mail,
  // and it deduped nothing — two sends presenting one key came back with two
  // different message ids. Request idempotency is the SECOND argument, and the
  // SDK builds the HTTP header from that and only that.
  //
  // Both halves are asserted together because the earlier regression here was
  // the mirror image: a header map rebuilt for the key dropped the opt-out
  // control. Neither may be fixed by breaking the other.
  const { payloads, options } = recordSends(t);

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

  assert.equal(options[0]?.idempotencyKey, "notif-batch-1");

  const headers = payloads[0].headers ?? {};
  assert.deepEqual(Object.keys(headers).sort(), [
    "List-Unsubscribe",
    "List-Unsubscribe-Post",
  ]);
  // Not on the message. A mailed `Idempotency-Key` is a header the invitee's
  // client renders nothing for and the provider acts on not at all.
  assert.ok(!("Idempotency-Key" in headers));
});

test("a caller cannot reach the request's idempotency key through the header map", async (t) => {
  // Provider-side dedupe is the braces against a double send. A caller-supplied
  // header must not be able to unpick it — and now it structurally cannot,
  // because the map it writes into is no longer where the key is read from.
  const { payloads, options } = recordSends(t);

  await sendEmail({
    to: "planter@example.test",
    subject: "s",
    html: "<p>x</p>",
    idempotencyKey: "the-real-key",
    headers: { "Idempotency-Key": "an-attackers-key" },
  });

  assert.equal(options[0]?.idempotencyKey, "the-real-key");
  // Dropped rather than forwarded: it can no longer do anything, so mailing it
  // to the reader would be a confusing way to say so.
  assert.ok(!("Idempotency-Key" in (payloads[0].headers ?? {})));
});

test("one key presented twice is one request-level key, and a new key is a new one", async (t) => {
  // The property `RESEND_DEDUPE_WINDOW_MS` depends on (`@/lib/invitations/email`
  // → `invitationEmailIdempotencyKey`): a double-pressed button presents the
  // SAME key, which the provider collapses, while a deliberate resend a window
  // later presents a different one and genuinely reaches the invitee.
  //
  // Asserted at the boundary this module owns — WHAT IS SENT. Whether the
  // provider then collapses the pair is the provider's contract, and it can
  // only honour a key it is actually given, which is the half that was broken.
  const { options } = recordSends(t);

  const send = (key: string) =>
    sendEmail({
      to: "planter@example.test",
      subject: "s",
      html: "<p>x</p>",
      idempotencyKey: key,
    });

  await send("org-invitation-abc-resend-1");
  await send("org-invitation-abc-resend-1");
  await send("org-invitation-abc-resend-2");

  assert.equal(options[0]?.idempotencyKey, options[1]?.idempotencyKey);
  assert.notEqual(options[1]?.idempotencyKey, options[2]?.idempotencyKey);
});

test("an email with no extra headers still sends, carrying only what it has", async (t) => {
  // Non-notification mail (invites, RSVPs) passes no header map at all.
  const { payloads: calls, options } = recordSends(t);

  await sendEmail({
    to: "planter@example.test",
    subject: "s",
    html: "<p>x</p>",
  });

  assert.deepEqual(calls[0].headers, {});
  assert.equal(calls[0].from, EMAIL_FROM);
  assert.deepEqual(calls[0].to, ["planter@example.test"]);
  // No key, no options object — `{ idempotencyKey: undefined }` is not the same
  // request as one with no second argument at all.
  assert.equal(options[0], undefined);
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
  const { payloads: calls } = recordSends(t);

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
