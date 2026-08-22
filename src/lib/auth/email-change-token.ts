// ============================================================================
// THE ADDRESS-CHANGE CREDENTIAL, AND THE ADDRESS ITSELF — CS-002 (#616).
//
// AN IMPORT-FREE LEAF (bar `node:crypto`), for the reason `@/lib/auth/roles`
// and `@/lib/auth/unauthorized` are: three modules that must not import each
// other need these five answers. `email-change.ts` writes the rows,
// `email-change-email.ts` builds the messages and imports nothing of the write
// path, and `/verify-email` renders the page — put the token helpers in either
// of the first two and the other one has to import it, which is the cycle.
//
// Nothing here touches a database, a transport or a request, so every rule
// below is executable in a unit test with no fixtures at all.
// ============================================================================

import { createHash, randomBytes } from "node:crypto";

/**
 * How long a confirmation link works for.
 *
 * SHORTER THAN AN INVITATION'S 30 DAYS, and the difference is what the link
 * does. An invitation creates an account for somebody who has not started yet,
 * so a slow reader costs nothing; this one MOVES the front door of an account
 * that already exists, and a live credential to that sitting in an inbox for a
 * month is a month of exposure bought for a convenience nobody asked for. A day
 * is long enough to cross a night and a working morning.
 */
export const EMAIL_CHANGE_EXPIRY_HOURS = 24;

/**
 * 32 bytes of CSPRNG, base64url — 256 bits, the same credential strength a seat
 * invitation carries, and `base64url` for the same reason: it survives a query
 * string with no escaping and shows no `%` in an inbox.
 */
export function newEmailChangeToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What the database stores. sha256 hex, 64 characters — the column's whole
 * width, so a value that is not a digest does not fit.
 *
 * NO SALT AND NO KDF, deliberately: this is 256 random bits, not a low-entropy
 * secret a human chose, so there is no dictionary to run and a per-row salt
 * would only stop the lookup being a point read on a unique index.
 */
export function hashEmailChangeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * WHERE A CONFIRMATION LINK LANDS — the one spelling of the path, so the email
 * and the page cannot disagree about the parameter's name.
 *
 * `/verify-email` sits under `(dashboard)`, which is what gives a signed-out
 * reader the bounce through `/login` with a return path for free
 * (`memory/invariants.md` → Authentication: `loginPathFor` / `safeRedirectPath`
 * have exactly two writers and this is not a third).
 */
export function emailChangeVerifyPath(token: string): string {
  return `/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * `users.email` is stored lowercased and trimmed — every writer does it, and
 * `login` lowercases before it looks one up. An address change that stored a
 * mixed-case value would be an account nobody could sign in to.
 */
export function normalizeAccountEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Is this a shape we will mail? Deliberately no stricter than the rest of the
 * product — one `@`, something either side of it, a dot in the domain, no
 * whitespace, inside the column's width. The real check is whether the link
 * arrives, and a stricter pattern only ever refuses somebody's real address.
 */
export function isMailableAddress(value: string): boolean {
  return value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
