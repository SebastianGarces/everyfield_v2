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
// DIRECTION IS A PURPOSE, NOT A PARAMETER (ruled 2026-08-01)
// ----------------------------------------------------------------------------
//
// The first cut of this file minted ONE token that both disabled and re-enabled
// a category. That made the emailed link a bidirectional consent control with a
// six-month reach: anyone holding an old message — a forwarded thread, a shared
// mailbox, a departed staff member's inbox — could switch a category back ON
// that the user had deliberately turned off, or re-apply the opt-out after each
// undo. Not a leak; a consent-integrity defect.
//
// So `disable` and `enable` are now separate purposes with separate AADs, and
// therefore separate KEYS. A disable token fed to the enable verifier does not
// fail a comparison — its auth tag does not validate at all, because the key it
// was sealed under is not the key being used to open it. "The emailed link can
// only ever opt you out" is a cryptographic property here, not a branch.
//
// ----------------------------------------------------------------------------
// Expiry, per direction
// ----------------------------------------------------------------------------
//
// DISABLE: emails sit in inboxes for a long time and an unsubscribe link that
// has stopped working is a compliance problem, not a security win — so its TTL
// is generous (180 days). What bounds the damage is the width of the
// capability, not its lifetime: the worst a stolen disable token can do is
// silence one category of email for one user.
//
// ENABLE: the opposite shape of risk. Consent to RECEIVE should be deliberate
// and fresh, and the only legitimate holder is someone looking at the
// confirmation page right now — the token is minted when that page renders,
// not mailed to anyone. One hour, so the undo survives a distraction but not a
// forwarded inbox.
// ============================================================================

/**
 * Version byte, first in every token. Checked before anything else so a token
 * from a future format is REJECTED rather than fed to a decipher that would
 * fail for a less legible reason.
 */
const TOKEN_VERSION = 1;

/**
 * What a token is allowed to do. There is no third value, and no token can do
 * both — see "Direction is a purpose" in the header.
 */
export type UnsubscribeTokenPurpose = "disable" | "enable";

/**
 * Purpose + channel, bound into the ciphertext by GCM's AAD and into the key by
 * the derivation below. Changing either string invalidates every token of that
 * purpose in flight, which is exactly what a purpose change should do.
 *
 * The two strings differ, so the two keys differ, so the two capabilities are
 * disjoint at the cipher rather than at a comparison.
 */
const AAD_BY_PURPOSE: Record<UnsubscribeTokenPurpose, string> = {
  disable: "everyfield.notifications.unsubscribe.email.v1",
  enable: "everyfield.notifications.resubscribe.email.v1",
};

/** The emailed link's AAD. Exported for the same reason it always was: tests. */
export const UNSUBSCRIBE_TOKEN_AAD = AAD_BY_PURPOSE.disable;

/** The confirmation page's undo AAD. */
export const RESUBSCRIBE_TOKEN_AAD = AAD_BY_PURPOSE.enable;

/** How long an emailed opt-out link keeps working. Long, deliberately. */
export const UNSUBSCRIBE_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * How long the confirmation page's undo keeps working. Short, deliberately —
 * it is minted for the person reading the page, and nobody else should be
 * holding it an hour from now.
 */
export const RESUBSCRIBE_TOKEN_TTL_MS = 60 * 60 * 1000;

const TTL_BY_PURPOSE: Record<UnsubscribeTokenPurpose, number> = {
  disable: UNSUBSCRIBE_TOKEN_TTL_MS,
  enable: RESUBSCRIBE_TOKEN_TTL_MS,
};

/**
 * Shortest secret we will mint with.
 *
 * RAISED FROM 16 (#263 item 3). Sixteen was described as a placeholder guard
 * rather than a cryptographic bound, and that reasoning was wrong here: the key
 * is a SINGLE SHA-256 of the secret, not a KDF, so anyone holding one genuine
 * token holds an OFFLINE VERIFICATION ORACLE. They can guess a secret, derive
 * the key, and try to open the token — billions of guesses a second on
 * commodity hardware, with no request to us and nothing to rate-limit. A
 * sixteen-character human string ("EveryField2026!!") does not survive that.
 *
 * WHY 32. Length is the only thing this function can measure, so the floor is
 * set at the length that carries ~128 bits under the WEAKEST encoding an
 * operator plausibly pastes: hex, at 4 bits per character. Base64 (6 bits per
 * character) clears 128 bits by 22, and `.env.example`'s advised
 * `openssl rand -base64 32` produces 44 characters — comfortably over, which is
 * the point: the advice stops being advisory. A shorter secret now fails the
 * mint loudly instead of shipping a forgeable capability quietly.
 *
 * Length is NOT entropy — this cannot tell `"a".repeat(32)` from 32 random
 * characters — so it is a floor, never a certificate. The generator in
 * `.env.example` is what supplies the entropy.
 */
const MIN_SECRET_LENGTH = 32;

const IV_BYTES = 12;
const TAG_BYTES = 16;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when the app is asked to mint or open a token with no usable secret. */
export class MissingUnsubscribeSecretError extends Error {
  constructor(message?: string) {
    super(
      message ??
        `UNSUBSCRIBE_TOKEN_SECRET (or CRON_SECRET outside production) is unset or shorter than ${MIN_SECRET_LENGTH} characters — notification emails cannot carry a working unsubscribe link without it. Generate one with: openssl rand -base64 32`
    );
    this.name = "MissingUnsubscribeSecretError";
  }
}

/**
 * Is this a production runtime?
 *
 * `NODE_ENV`, not `VERCEL_ENV`: `next build` and `next start` set it to
 * `production` wherever they run, so a self-hosted or preview deployment is
 * held to the same bar as Vercel production, and no platform-specific variable
 * has to be present for the rule to bind. `pnpm test` and `next dev` leave it
 * at `test` / `development`, which is the ONLY window in which the fallback
 * below exists.
 */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The configured secret.
 *
 * Fails CLOSED when no usable value is set. The alternative — falling back to
 * a derived or empty key — would mean an environment that forgot the variable
 * still mints links, and those links are forgeable by anyone who can read this
 * file. A loud failure costs one retry of one email; a quiet fallback costs the
 * guarantee.
 *
 * ----------------------------------------------------------------------------
 * `CRON_SECRET` IS NO LONGER A FALLBACK IN PRODUCTION (#263 item 4)
 * ----------------------------------------------------------------------------
 *
 * It used to be one everywhere, argued from the key derivation: the key is
 * `SHA-256(purpose : secret)`, so the same bytes under another purpose produce
 * an unrelated key. That argument is about DERIVED KEYS and says nothing about
 * the SECRET, which is the thing that actually leaks. One set of bytes guarded
 * two unrelated capabilities — the scheduler's bearer token and every
 * unsubscribe link in flight — so a `CRON_SECRET` disclosed by a log line, a
 * workflow file or a rotated-out Actions secret silently handed the holder the
 * ability to forge opt-outs for six months, and rotating either capability
 * forced rotation of the other. Domain separation makes the two keys
 * independent; it cannot make the two secrets independent.
 *
 * So in production the dedicated variable is REQUIRED and nothing stands in for
 * it. Outside production the fallback earns its keep: a developer who has set
 * `CRON_SECRET` to run the dispatcher locally gets working links rather than a
 * throw in the middle of an unrelated feature, and a local secret guards
 * nothing anybody wants.
 *
 * The throw is for the MINT path only. `verifyUnsubscribeToken` catches it and
 * refuses the token instead, because its callers are public pages that must not
 * turn a deployment fault into a 500 in front of a stranger.
 */
export function unsubscribeTokenSecret(): string {
  const dedicated = process.env.UNSUBSCRIBE_TOKEN_SECRET ?? "";
  if (dedicated.length >= MIN_SECRET_LENGTH) return dedicated;

  if (isProductionRuntime()) {
    throw new MissingUnsubscribeSecretError(
      `UNSUBSCRIBE_TOKEN_SECRET is required in production and must be at least ${MIN_SECRET_LENGTH} characters — CRON_SECRET is NOT accepted here, because one set of bytes must not guard both the scheduler and every unsubscribe link in flight. Generate one with: openssl rand -base64 32`
    );
  }

  // Local and test runtimes only, per the block above.
  const fallback = process.env.CRON_SECRET ?? "";
  if (fallback.length >= MIN_SECRET_LENGTH) return fallback;

  throw new MissingUnsubscribeSecretError();
}

/**
 * Domain-separated key: the same secret under another purpose — including the
 * other DIRECTION of this same capability — is another key.
 */
function keyFor(secret: string, purpose: UnsubscribeTokenPurpose): Buffer {
  return createHash("sha256")
    .update(`${AAD_BY_PURPOSE[purpose]}:${secret}`)
    .digest();
}

/**
 * The sealed payload. Deliberately four short keys: a token travels in a URL
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
  /**
   * Direction. Redundant with the AAD by design: the key already makes a
   * cross-direction token undecryptable, and this field means a future refactor
   * that accidentally shares a key still cannot confuse the two. Belt to the
   * cipher's braces, checked after decryption.
   */
  p: UnsubscribeTokenPurpose;
}

export interface MintUnsubscribeTokenInput {
  userId: string;
  category: NotificationCategory;
  /**
   * Which direction this token authorises. Defaults to `disable` — the emailed
   * link, and the LESS powerful of the two. A default that silently produced a
   * re-enable capability would be the wrong way round.
   */
  purpose?: UnsubscribeTokenPurpose;
  /** Clock, injectable so expiry is assertable. */
  now?: Date;
  ttlMs?: number;
  /** Secret override. Tests pass one; production reads the environment. */
  secret?: string;
}

/**
 * Mint the token for one (user, category, direction) triple.
 *
 * A fresh random IV per call means two links for the same pair are different
 * strings, so a token is never a stable identifier for a user either — you
 * cannot correlate two emails by comparing their unsubscribe links.
 */
export function mintUnsubscribeToken(input: MintUnsubscribeTokenInput): string {
  const secret = input.secret ?? unsubscribeTokenSecret();
  const now = input.now ?? new Date();
  const purpose = input.purpose ?? "disable";
  const ttlMs = input.ttlMs ?? TTL_BY_PURPOSE[purpose];

  const payload: SealedPayload = {
    u: input.userId,
    c: input.category,
    x: Math.floor((now.getTime() + ttlMs) / 1000),
    p: purpose,
  };

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret, purpose), iv);
  cipher.setAAD(Buffer.from(AAD_BY_PURPOSE[purpose], "utf8"));

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
      purpose: UnsubscribeTokenPurpose;
      expiresAt: Date;
    }
  | { valid: false; reason: UnsubscribeTokenRejection };

export interface VerifyUnsubscribeTokenOptions {
  /**
   * Which direction the CALLER is about to perform. The token is opened with
   * this purpose's key, so a token minted for the other direction cannot be
   * decrypted at all. Defaults to `disable`, matching the mint default.
   */
  purpose?: UnsubscribeTokenPurpose;
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
 * an unknown category resolves to "off" forever). The purpose is re-validated
 * for the same reason, one layer down from the key that already enforces it.
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
  const purpose = options.purpose ?? "disable";

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
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFor(secret, purpose),
      iv
    );
    decipher.setAAD(Buffer.from(AAD_BY_PURPOSE[purpose], "utf8"));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM's auth tag failing is the whole tamper story: a flipped byte
    // anywhere in the IV, tag, ciphertext or AAD lands here — and so does a
    // perfectly genuine token minted for the OTHER direction, because the key
    // it was sealed under is not the key being used to open it.
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

  const { u, c, x, p } = parsed as Partial<SealedPayload>;

  if (typeof u !== "string" || !UUID_PATTERN.test(u)) {
    return { valid: false, reason: "tampered" };
  }
  if (!isNotificationCategory(c)) {
    return { valid: false, reason: "tampered" };
  }
  if (typeof x !== "number" || !Number.isFinite(x)) {
    return { valid: false, reason: "tampered" };
  }
  // Unreachable while the keys differ — which is the point of asserting it.
  if (p !== purpose) {
    return { valid: false, reason: "tampered" };
  }

  const expiresAt = new Date(x * 1000);
  if (now.getTime() >= expiresAt.getTime()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, userId: u, category: c, purpose, expiresAt };
}
