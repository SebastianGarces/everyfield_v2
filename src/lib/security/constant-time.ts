// ============================================================================
// Constant-time secret comparison (#266).
//
// ONE comparison path for every shared secret in the app. It lives here rather
// than inside a route because `CRON_SECRET` authorises TWO public endpoints —
// `/api/notifications/dispatch` and `/api/phase-engine/assess` (see
// `memory/contracts/config.md`) — and a timing oracle on either one leaks the
// secret that opens both. A per-route copy is how one of them silently stays
// vulnerable; ruled 2026-08-04 to share instead.
// ============================================================================

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string equality.
 *
 * `===` on a secret is a timing oracle: V8 compares byte by byte and returns at
 * the first difference, so an attacker who can time the endpoint learns the
 * secret one character at a time. `crypto.timingSafeEqual` compares in time
 * that does not depend on WHERE the buffers differ — but it throws a
 * `RangeError` when the two buffers differ in LENGTH, so the lengths have to be
 * reconciled before it is called, and a naive `if (a.length !== b.length)
 * return false` in front of it just moves the oracle: it leaks the secret's
 * length, which is exactly the first thing a guesser wants.
 *
 * So both sides are hashed first. SHA-256 digests are always 32 bytes, so the
 * call can never throw, the same work happens for a 3-byte guess and a 3 KB
 * one, and nothing about the real secret's length is observable. The raw byte
 * lengths are compared too — after the constant-time compare, never as an early
 * return — so the result does not rest on collision resistance alone.
 *
 * Node-only (`node:crypto`): callers must be server code, which every caller of
 * a secret comparison is by definition.
 */
export function constantTimeEquals(
  presented: string,
  expected: string
): boolean {
  const presentedBytes = Buffer.from(presented, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  const presentedDigest = createHash("sha256").update(presentedBytes).digest();
  const expectedDigest = createHash("sha256").update(expectedBytes).digest();

  // `timingSafeEqual` first, and it is what decides the answer; the length
  // check is a redundant belt on an already-matching pair, not a short circuit.
  return (
    timingSafeEqual(presentedDigest, expectedDigest) &&
    presentedBytes.length === expectedBytes.length
  );
}

/**
 * True when an `Authorization` header carries exactly `Bearer <secret>`.
 *
 * The guard both cron routes call, so neither can drift from the other. A
 * missing header (`null`, which is what `Headers.get` returns) is refused
 * before any comparison: the absence of a header is a fact about the REQUEST,
 * so returning early there leaks nothing about the secret. Everything past that
 * point is compared in constant time, including the `Bearer ` scheme itself.
 *
 * Callers still have to fail closed on an unset secret themselves — an empty
 * `secret` here would authorise the literal header `"Bearer "`, and refusing
 * that is a configuration decision the route makes explicitly rather than one
 * this helper hides.
 */
export function matchesBearerSecret(
  header: string | null,
  secret: string
): boolean {
  if (header === null) return false;

  return constantTimeEquals(header, `Bearer ${secret}`);
}
