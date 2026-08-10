import { Resend } from "resend";

import { redactForLog } from "./redact";

// Initialize Resend client
// RESEND_API_KEY must be set in environment variables
const resend = new Resend(process.env.RESEND_API_KEY);

export { resend };

// ---------------------------------------------------------------------------
// Sender identity
// ---------------------------------------------------------------------------

/**
 * The product's sending domain is `everyfield.app` (ruled 2026-07-31, #245).
 * Not `everyfield.dev`, which was only ever dev/eval tooling, and not
 * `everyfield.com`, which this default used to name and which we do not own —
 * a `from` on an unverified domain fails DKIM/SPF alignment, so the mail either
 * bounces or lands in spam, and nothing in the app can tell the difference.
 *
 * Exported separately from `EMAIL_FROM` so a test can assert the DEFAULT: any
 * environment that runs the suite may set `EMAIL_FROM`, which would make an
 * assertion on the resolved value a test of that machine's `.env.local`.
 */
export const DEFAULT_EMAIL_FROM = "EveryField <notifications@everyfield.app>";

// Default sender configuration
export const EMAIL_FROM = process.env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM;

/**
 * Where a reply goes. Defaults to the sending identity itself rather than to a
 * `noreply@` — people DO reply to transactional mail (an invited planter asking
 * "is this really you?" is the expected case), and a reply that bounces is a
 * worse answer than one that reaches the same monitored mailbox the message
 * came from. Never an address on a domain we do not send from: that is the
 * alignment failure above, one field over.
 */
export const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? EMAIL_FROM;

/**
 * Send a single email via Resend
 * Includes error handling and logging
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  idempotencyKey,
  headers: extraHeaders,
}: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /**
   * Where a reply lands. Omitted → the client replies to `from`, which is the
   * same mailbox; pass `EMAIL_REPLY_TO` to say so explicitly.
   */
  replyTo?: string;
  /**
   * Provider-side dedupe. Goes to the REQUEST, never into `headers` below —
   * see the call site for why those are two different things.
   */
  idempotencyKey?: string;
  /**
   * Extra RFC headers. `List-Unsubscribe` is the one that matters today: mail
   * clients render their own opt-out control from it, and a reader who cannot
   * find one presses "spam" instead.
   */
  headers?: Record<string, string>;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    // Two DIFFERENT places, and the difference is the whole of whether dedupe
    // happens. `payload.headers` is the message's own RFC header block — the
    // provider copies it onto the mail and hands it to the invitee's client,
    // which is exactly right for `List-Unsubscribe` and useless for anything
    // else. Idempotency is an HTTP header on the REQUEST, and resend@6 builds
    // it from the second argument only (`headers.set("Idempotency-Key",
    // options.idempotencyKey)` in the SDK).
    //
    // This used to write the key into the map below. It type-checked, it
    // delivered mail, and it deduped NOTHING: two sends presenting one key
    // returned two different message ids, so a double-clicked button sent
    // twice while `RESEND_DEDUPE_WINDOW_MS` looked like it was doing work
    // (memory/invariants.md → "a double-clicked button sends once", which is
    // this line and no other).
    //
    // A caller's own `Idempotency-Key` is dropped rather than mailed: it can no
    // longer reach the request, so passing one is a mistake, and forwarding it
    // to the invitee's mail client would be a confusing way to say so.
    const { "Idempotency-Key": _ignored, ...headers } = extraHeaders ?? {};

    const { data, error } = await resend.emails.send(
      {
        from: EMAIL_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
        headers,
      },
      // Omitted entirely when there is no key — an `{ idempotencyKey:
      // undefined }` would still be an options object, and the SDK's `if`
      // is the only thing between that and a malformed header.
      ...(idempotencyKey ? ([{ idempotencyKey }] as const) : [])
    );

    if (error) {
      // Name and REDACTED message, for the same reason as the catch below: the
      // provider's error is free to quote the request it refused.
      console.error("[EMAIL] Send failed:", {
        name: error.name,
        message: redactForLog(error.message),
      });
      return { success: false, error: error.message };
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[EMAIL] Sent:", { to, subject, id: data?.id });
    }

    return { success: true, id: data?.id };
  } catch (err) {
    // Never the error object, and never its raw message either. A thrown
    // transport error quotes the request it failed on; the request holds the
    // HTML body; the invitation email's body holds `/register?invitation=<id>`,
    // which is the register bearer token (`@/lib/invitations/email`, rule 4).
    // `redactForLog` strips URLs and ids and truncates the rest — see
    // `./redact.ts` for why the message alone was not enough.
    console.error("[EMAIL] Exception:", { message: redactForLog(err) });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
