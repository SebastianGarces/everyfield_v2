import { and, count, eq, gt, lt } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { authAttempts, type AuthAttemptKind } from "@/db/schema";

// ----------------------------------------------------------------------------
// Rate limit configuration
// ----------------------------------------------------------------------------
// Postgres-table-based attempt tracking (no Redis in stack; in-memory state is
// unreliable on serverless). Failures are counted within a sliding window.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const LOGIN_WINDOW_MS = 15 * MINUTE_MS;
const LOGIN_MAX_PER_IDENTIFIER = 5; // >= 5 failed per email per 15 min -> reject
const LOGIN_MAX_PER_IP = 20; // >= 20 failed per IP per 15 min -> reject

const REGISTER_WINDOW_MS = HOUR_MS;
const REGISTER_MAX_PER_IP = 3; // >= 3 per IP per hour -> reject

const EMAIL_CHANGE_WINDOW_MS = HOUR_MS;
const EMAIL_CHANGE_MAX_PER_IDENTIFIER = 3; // >= 3 unverified per account per hour
const EMAIL_CHANGE_MAX_PER_IP = 10; // >= 10 unverified per IP per hour

/**
 * The whole policy as one table. A missing threshold means "no limit on that
 * axis" — register deliberately has no per-identifier limit, because the
 * failure mode it guards against (mass account creation) is per-IP.
 *
 * ----------------------------------------------------------------------------
 * THE TWO SELF-SERVICE KINDS (CS-005, #616)
 * ----------------------------------------------------------------------------
 *
 * `password_change` IS SHAPED EXACTLY LIKE `login`, and it is the same attack:
 * a session somebody else's browser is holding, guessing at the current
 * password until it lands. Same window, same thresholds, same axes — a second
 * set of numbers would say the two guesses were worth different amounts.
 *
 * `email_change` COUNTS THE REQUEST, NOT THE REDEMPTION, and that is the one
 * place these two kinds part company from the pair above. There is no secret to
 * get wrong when asking for a new address, so a guard that counted only wrong
 * answers would count nothing — and the thing worth capping here is a
 * verification email sent to an address that never confirms it, which is mail
 * this product put in a stranger's inbox on an account holder's say-so.
 *
 * So an email-change REQUEST is recorded as an attempt that has NOT SUCCEEDED
 * (`recordAttempt(..., false)`) and the REDEMPTION records the success. That is
 * not a lie told to reuse the guard: a change spans two steps and is not done
 * until the second one, so an unredeemed request is precisely an attempt still
 * outstanding. It also makes the cap self-clearing in the right direction —
 * `recordAttempt` deletes the identifier's failed rows on success (ruled
 * 405-4b), so an account that actually completes a change starts over, and only
 * the account leaving unconfirmed requests behind walks into the limit.
 *
 * The identifier on both kinds is the account's OWN CURRENT address, never the
 * address being asked for: the subject of the limit is the account doing the
 * asking, and keying on the target would let one account spread its requests
 * across many mailboxes and never meet a threshold.
 */
const RATE_LIMITS: Record<
  AuthAttemptKind,
  { windowMs: number; perIdentifier?: number; perIp?: number }
> = {
  login: {
    windowMs: LOGIN_WINDOW_MS,
    perIdentifier: LOGIN_MAX_PER_IDENTIFIER,
    perIp: LOGIN_MAX_PER_IP,
  },
  register: {
    windowMs: REGISTER_WINDOW_MS,
    perIp: REGISTER_MAX_PER_IP,
  },
  email_change: {
    windowMs: EMAIL_CHANGE_WINDOW_MS,
    perIdentifier: EMAIL_CHANGE_MAX_PER_IDENTIFIER,
    perIp: EMAIL_CHANGE_MAX_PER_IP,
  },
  password_change: {
    windowMs: LOGIN_WINDOW_MS,
    perIdentifier: LOGIN_MAX_PER_IDENTIFIER,
    perIp: LOGIN_MAX_PER_IP,
  },
};

export type RateLimitResult = { limited: boolean };

/**
 * Resolve the client IP for rate limiting (ruled 405-1a, 2026-08-12).
 *
 * Reads the platform-written `x-real-ip` header first. Falls back to the LAST
 * hop of `x-forwarded-for` — the hop nearest our proxy, which the client
 * cannot write. NEVER the first hop: that segment arrives in the request, so
 * a client can forge it and rotate it to evaporate every per-IP limit.
 * Returns `null` when neither header yields a value.
 */
export async function getRequestIp(): Promise<string | null> {
  const headersList = await headers();

  const realIp = headersList.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  const forwardedFor = headersList.get("x-forwarded-for");
  if (!forwardedFor) {
    return null;
  }
  const hops = forwardedFor.split(",");
  const lastHop = hops[hops.length - 1]?.trim();
  return lastHop && lastHop.length > 0 ? lastHop : null;
}

/**
 * WHICH AXIS A COUNT IS ABOUT — the two columns a threshold may be keyed on.
 *
 * Exported so a test can supply the count without a database (see
 * `FailureCounter`), and named as a type rather than left inline so the seam
 * and the real implementation are held to one signature by the compiler.
 */
export type RateLimitAxis =
  | typeof authAttempts.identifier
  | typeof authAttempts.ip;

/**
 * HOW FAILURES ARE COUNTED — the guard's ONE dependency, and its test seam.
 *
 * `checkRateLimit` is policy: which axes a kind is limited on, at what
 * thresholds, over what window. That policy is what CS-005 asks to be provable,
 * and it is not reachable from a unit test while the count is a query — a
 * neon-http client cannot answer one without a live Postgres.
 *
 * So the count is a PARAMETER with the production query as its default. No
 * caller changes, no branch inside the guard, and no second copy of the sliding
 * window: `src/lib/auth/rate-limit.test.ts` drives the real policy by handing it
 * a counter over an in-memory list of attempt timestamps.
 */
export type FailureCounter = (
  column: RateLimitAxis,
  value: string,
  kind: AuthAttemptKind,
  windowMs: number
) => Promise<number>;

/**
 * Count failed attempts in a window matching a single column predicate.
 */
async function countFailures(
  column: RateLimitAxis,
  value: string,
  kind: AuthAttemptKind,
  windowMs: number
): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await db
    .select({ value: count() })
    .from(authAttempts)
    .where(
      and(
        eq(column, value),
        eq(authAttempts.kind, kind),
        eq(authAttempts.success, false),
        gt(authAttempts.createdAt, since)
      )
    );
  return row?.value ?? 0;
}

/**
 * Determine whether an auth attempt should be rejected for exceeding limits.
 *
 * Only FAILED attempts inside the window count toward a threshold. A
 * successful attempt is recorded (success=true) and is never counted, and
 * `recordAttempt` deletes that identifier's failed rows inside the window on
 * success (ruled 405-4b) — so a successful login clears the identifier's
 * slate instead of leaving a near-lockout armed.
 */
export async function checkRateLimit(
  identifier: string,
  ip: string | null,
  kind: AuthAttemptKind,
  count: FailureCounter = countFailures
): Promise<RateLimitResult> {
  const limit = RATE_LIMITS[kind];

  // Checked in order: identifier first, then IP. A null value (no IP on the
  // request) or an absent threshold skips that axis.
  const axes = [
    {
      column: authAttempts.identifier,
      value: identifier.toLowerCase(),
      max: limit.perIdentifier,
    },
    { column: authAttempts.ip, value: ip, max: limit.perIp },
  ];

  for (const { column, value, max } of axes) {
    if (max === undefined || value === null) {
      continue;
    }
    const failures = await count(column, value, kind, limit.windowMs);
    if (failures >= max) {
      return { limited: true };
    }
  }

  return { limited: false };
}

/**
 * Record an auth attempt.
 *
 * On success, deletes that identifier's failed rows inside the kind's window
 * (ruled 405-4b) so a successful login clears the failure count instead of
 * leaving it armed. Also opportunistically prunes rows older than one day on
 * each write (no cron exists; acceptable at beta volume).
 */
export async function recordAttempt(
  identifier: string,
  ip: string | null,
  kind: AuthAttemptKind,
  success: boolean
): Promise<void> {
  // All statements are known up front and touch only auth_attempts, so they
  // ship as one batched transaction (sanctioned shape #1, src/db/index.ts):
  // one round trip, all-or-nothing.
  const normalizedIdentifier = identifier.toLowerCase();
  const cutoff = new Date(Date.now() - 24 * HOUR_MS);
  const insertAttempt = db.insert(authAttempts).values({
    identifier: normalizedIdentifier,
    ip,
    kind,
    success,
  });
  // Opportunistic cleanup: delete rows older than one day.
  const pruneOld = db
    .delete(authAttempts)
    .where(lt(authAttempts.createdAt, cutoff));

  if (!success) {
    await db.batch([insertAttempt, pruneOld]);
    return;
  }

  // Clear this identifier's failed rows inside the window, in the SAME batch
  // as the insert (ruled 405-4b). Identifier axis only — failed rows for
  // OTHER identifiers from the same IP still count toward the per-IP limit.
  const since = new Date(Date.now() - RATE_LIMITS[kind].windowMs);
  await db.batch([
    insertAttempt,
    pruneOld,
    db
      .delete(authAttempts)
      .where(
        and(
          eq(authAttempts.identifier, normalizedIdentifier),
          eq(authAttempts.kind, kind),
          eq(authAttempts.success, false),
          gt(authAttempts.createdAt, since)
        )
      ),
  ]);
}
