// ============================================================================
// What an email failure is allowed to say in a log — OV-003b (#293).
//
// Logging `err` outright prints whatever the thrower attached, and a transport
// error attaches the REQUEST: `fetch` failures, SDK validation errors and
// provider 4xx bodies all routinely quote the payload they refused. The
// invitation email's payload holds `/register?invitation=<id>` in three places
// (the button, the pasteable fallback, the plain-text part), and that id is the
// register bearer token AND the private-beta bypass
// (`hasValidInvitationBypass`). So the object never goes to `console`.
//
// `err.message` is not sufficient either, which is the non-obvious half. The
// message is provider-authored text and is just as free to embed the request —
// `client.test.ts` pins exactly that case, because the first version of this
// hardening logged the message and still printed the token. So the message is
// scrubbed of the two shapes that can carry a credential, then truncated:
//
//   * any absolute URL — the link IS the credential;
//   * any bare UUID — every id in this product is one, and the invitation id in
//     particular is a bearer token.
//
// URLs go first: a redacted URL has already taken the uuid inside it with it,
// and running the uuid pass first would leave a recognisable `…/register?…`
// shape behind.
//
// This is a log-hygiene helper, NOT a security boundary — it makes an accident
// survivable, it does not make it safe to log a secret on purpose. The rule
// stays "never pass a credential to `console`"; this is the net under it.
// ============================================================================

const ABSOLUTE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>\\]+/gi;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * How much of a message survives. A transport error that quotes a whole HTML
 * body is thousands of characters of noise even once it is scrubbed, and a log
 * line nobody reads is the same as no log line.
 */
const MAX_LENGTH = 300;

/**
 * A one-line, credential-free description of a thrown or returned error.
 *
 * Always returns a string, and never one derived from anything but the error's
 * own message — no `cause`, no `stack`, no enumerable extras, because those are
 * the fields an SDK hangs the request off.
 */
export function redactForLog(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown error";

  const scrubbed = raw.replace(ABSOLUTE_URL, "[url]").replace(UUID, "[id]");

  return scrubbed.length > MAX_LENGTH
    ? `${scrubbed.slice(0, MAX_LENGTH)}… [truncated]`
    : scrubbed;
}
