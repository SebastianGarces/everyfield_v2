import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import {
  isNotificationCategory,
  type NotificationCategory,
} from "../categories";

// ============================================================================
// The unsubscribe capability (N-007).
//
// An email footer's unsubscribe link is the only UNAUTHENTICATED mutation in
// this feature: whoever holds the link can turn off one category's email for
// one user, with no session and no password. Everything in this file exists to
// make that capability exactly as wide as that sentence and no wider.
//
// ----------------------------------------------------------------------------
// Why the token is SEALED and not merely signed
// ----------------------------------------------------------------------------
//
// The obvious construction is a signed envelope — base64 of
// `{user, category}` plus an HMAC. It is tamper-evident, which is the property
// that matters most, but the payload is still readable: anyone who sees the
// URL (a forwarded email, a referrer header, a proxy log, a screenshot) reads
// the recipient's user id straight out of the query string. A user id is a
// join key across every table in this product, so publishing one in a link
// that is designed to be clicked is a leak we would rather not take.
//
// So the token is SEALED with AES-256-GCM instead. GCM is authenticated
// encryption: it gives the same tamper-evidence an HMAC would (the auth tag
// fails closed on a single flipped bit) AND makes the payload opaque, so the
// token is an unguessable bearer capability rather than an encoded identity.
// "Never a user id in a query string" then holds literally, not by convention.
//
// ----------------------------------------------------------------------------
// Single-purpose, structurally
// ----------------------------------------------------------------------------
//
// The additional authenticated data (AAD) names the purpose AND the channel:
// `everyfield.notifications.unsubscribe.email.v1`. AAD is covered by the auth
// tag, so a token minted for any other purpose — or by any future version of
// this file — cannot be opened here, and this token cannot be replayed
// anywhere else. The channel is NOT carried in the payload precisely because
// it is fixed by the AAD: there is no field an attacker could aim at `in_app`,
// and no code path in which this token disables anything but email.
//
// The key is derived from the secret and the AAD together, so the same secret
// used for a different purpose produces a different key. One compromised
// capability cannot be re-cut into another.
//
// ----------------------------------------------------------------------------
// Expiry
// ----------------------------------------------------------------------------
//
// Emails sit in inboxes for a long time and an unsubscribe link that has
// stopped working is a compliance problem, not a security win — so the TTL is
// generous (180 days) rather than short. What bounds the damage is the width
// of the capability, not its lifetime: the worst a stolen token can do is
// silence one category of email for one user, which that user can undo from
// the confirmation page in one click.
// ============================================================================

/**
 * Version byte, first in every token. Checked before anything else so a token
 * from a future format is REJECTED rather than fed to a decipher that would
 * fail for a less legible reason.
 */
const TOKEN_VERSION = 1;

/**
 * Purpose + channel, bound into the ciphertext by GCM's AAD and into the key by
 * the derivation below. Changing this string invalidates every token in flight,
 * which is exactly what a purpose change should do.
 */
export const UNSUBSCRIBE_TOKEN_AAD =
  "everyfield.notifications.unsubscribe.email.v1";

/** How long a minted link keeps working. See the header on why it is long. */
export const UNSUBSCRIBE_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Shortest secret we will mint with. Not a cryptographic bound (the key is a
 * SHA-256 of it either way) — it is a guard against a placeholder value like
 * `"changeme"` silently becoming production's capability key.
 */
const MIN_SECRET_LENGTH = 16;

const IV_BYTES = 12;
const TAG_BYTES = 16;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when the app is asked to mint or open a token with no secret set. */
export class MissingUnsubscribeSecretError extends Error {
  constructor() {
    super(
      "UNSUBSCRIBE_TOKEN_SECRET (or CRON_SECRET) is unset or too short — notification emails cannot carry a working unsubscribe link without it"
    );
    this.name = "MissingUnsubscribeSecretError";
  }
}

/**
 * The configured secret.
 *
 * Fails CLOSED when neither variable is set. The alternative — falling back to
 * a derived or empty key — would mean an environment that forgot the variable
 * still mints links, and those links are forgeable by anyone who can read this
 * file. A loud failure costs one retry of one email; a quiet fallback costs the
 * guarantee.
 *
 * `CRON_SECRET` is an accepted fallback, and the reason is the key derivation
 * below rather than convenience: the key is `SHA-256(purpose : secret)`, so the
 * same bytes used for a different purpose produce an unrelated key and a
 * compromised unsubscribe token tells you nothing about the cron bearer token
 * (or the reverse). It means an environment that can already run the dispatcher
 * can also mint the links that dispatcher needs, instead of sending mail with a
 * dead opt-out. `UNSUBSCRIBE_TOKEN_SECRET` is still preferred: rotating the
 * opt-out capability should not require rotating the scheduler's credential.
 *
 * The throw is for the MINT path only. `verifyUnsubscribeToken` catches it and
 * refuses the token instead, because its callers are public pages that must not
 * turn a deployment fault into a 500 in front of a stranger.
 */
export function unsubscribeTokenSecret(): string {
  const secret =
    process.env.UNSUBSCRIBE_TOKEN_SECRET ?? process.env.CRON_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new MissingUnsubscribeSecretError();
  }
  return secret;
}

/** Domain-separated key: the same secret under another purpose is another key. */
function keyFor(secret: string): Buffer {
  return createHash("sha256")
    .update(`${UNSUBSCRIBE_TOKEN_AAD}:${secret}`)
    .digest();
}

/**
 * The sealed payload. Deliberately three short keys: a token travels in a URL
 * that has to survive being wrapped by a mail client, and there is nothing
 * else this capability needs to know.
 */
interface SealedPayload {
  /** Recipient user id. */
  u: string;
  /** Category whose email channel this token may change. */
  c: string;
  /** Expiry, epoch SECONDS (not ms — shorter, and second precision is plenty). */
  x: number;
}

export interface MintUnsubscribeTokenInput {
  userId: string;
  category: NotificationCategory;
  /** Clock, injectable so expiry is assertable. */
  now?: Date;
  ttlMs?: number;
  /** Secret override. Tests pass one; production reads the environment. */
  secret?: string;
}

/**
 * Mint the token for one (user, category) pair.
 *
 * A fresh random IV per call means two links for the same pair are different
 * strings, so a token is never a stable identifier for a user either — you
 * cannot correlate two emails by comparing their unsubscribe links.
 */
export function mintUnsubscribeToken(input: MintUnsubscribeTokenInput): string {
  const secret = input.secret ?? unsubscribeTokenSecret();
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? UNSUBSCRIBE_TOKEN_TTL_MS;

  const payload: SealedPayload = {
    u: input.userId,
    c: input.category,
    x: Math.floor((now.getTime() + ttlMs) / 1000),
  };

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  cipher.setAAD(Buffer.from(UNSUBSCRIBE_TOKEN_AAD, "utf8"));

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([
    Buffer.from([TOKEN_VERSION]),
    iv,
    tag,
    ciphertext,
  ]).toString("base64url");
}

/**
 * Why a token was refused.
 *
 * These are for LOGS, not for users. Every rejection renders the same page —
 * telling a stranger the difference between "this was never a token" and "this
 * was a real token that expired" is a small oracle about whether an address is
 * one of ours, and the user-visible remedy ("sign in and change it there") is
 * identical in every case.
 */
export type UnsubscribeTokenRejection =
  /** Not our shape at all: bad base64, wrong length, wrong version byte. */
  | "malformed"
  /** Right shape, failed authentication — edited, forged, or another key. */
  | "tampered"
  /** Authentic, but past its expiry. */
  | "expired";

export type UnsubscribeTokenVerification =
  | {
      valid: true;
      userId: string;
      category: NotificationCategory;
      expiresAt: Date;
    }
  | { valid: false; reason: UnsubscribeTokenRejection };

export interface VerifyUnsubscribeTokenOptions {
  now?: Date;
  secret?: string;
}

/**
 * Open a token, or refuse it.
 *
 * NOTHING here throws — not for a bad token, and not for a bad DEPLOYMENT.
 * A route that has to distinguish "this threw" from "this returned false" gets
 * that wrong eventually, and this is the one surface where getting it wrong
 * means mutating on an unverified input.
 *
 * That includes the missing-secret case, which is the asymmetry between this
 * function and `mintUnsubscribeToken`. Minting FAILS CLOSED: an email must not
 * go out carrying a dead opt-out link, and `deliverEmailGroup` already contains
 * that throw as a transient delivery error that will be retried once the
 * environment is fixed. Verifying DEGRADES: its callers are a public Server
 * Component (`/unsubscribe`) and a public route handler, both reached with no
 * session from a link in an inbox, and an unconfigured environment there must
 * render the same refusal card every other bad token renders — not a 500 on a
 * page a stranger was invited to click. A missing secret cannot open any token,
 * so "malformed" is also the honest answer: nothing was verified.
 *
 * The category is re-validated against the code registry after decryption. A
 * token minted by a deploy that knew a category this one does not must not
 * write a row nothing can ever resolve again (see `defaultChannelEnabled` —
 * an unknown category resolves to "off" forever).
 */
export function verifyUnsubscribeToken(
  token: string,
  options: VerifyUnsubscribeTokenOptions = {}
): UnsubscribeTokenVerification {
  let secret: string;
  try {
    secret = options.secret ?? unsubscribeTokenSecret();
  } catch {
    return { valid: false, reason: "malformed" };
  }
  const now = options.now ?? new Date();

  if (typeof token !== "string" || token.length === 0) {
    return { valid: false, reason: "malformed" };
  }

  let raw: Buffer;
  try {
    raw = Buffer.from(token, "base64url");
  } catch {
    return { valid: false, reason: "malformed" };
  }

  // `base64url` decoding is lenient — it drops characters it does not
  // recognise rather than failing — so the length and version checks below are
  // what actually reject garbage.
  if (raw.length <= 1 + IV_BYTES + TAG_BYTES) {
    return { valid: false, reason: "malformed" };
  }
  if (raw[0] !== TOKEN_VERSION) {
    return { valid: false, reason: "malformed" };
  }

  const iv = raw.subarray(1, 1 + IV_BYTES);
  const tag = raw.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(1 + IV_BYTES + TAG_BYTES);

  let plaintext: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), iv);
    decipher.setAAD(Buffer.from(UNSUBSCRIBE_TOKEN_AAD, "utf8"));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM's auth tag failing is the whole tamper story: a flipped byte
    // anywhere in the IV, tag, ciphertext or AAD lands here.
    return { valid: false, reason: "tampered" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return { valid: false, reason: "tampered" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { valid: false, reason: "tampered" };
  }

  const { u, c, x } = parsed as Partial<SealedPayload>;

  if (typeof u !== "string" || !UUID_PATTERN.test(u)) {
    return { valid: false, reason: "tampered" };
  }
  if (!isNotificationCategory(c)) {
    return { valid: false, reason: "tampered" };
  }
  if (typeof x !== "number" || !Number.isFinite(x)) {
    return { valid: false, reason: "tampered" };
  }

  const expiresAt = new Date(x * 1000);
  if (now.getTime() >= expiresAt.getTime()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, userId: u, category: c, expiresAt };
}
