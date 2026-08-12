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

/**
 * The whole policy as one table. A missing threshold means "no limit on that
 * axis" — register deliberately has no per-identifier limit, because the
 * failure mode it guards against (mass account creation) is per-IP.
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
 * Count failed attempts in a window matching a single column predicate.
 */
async function countFailures(
  column: typeof authAttempts.identifier | typeof authAttempts.ip,
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
  kind: AuthAttemptKind
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
    const failures = await countFailures(column, value, kind, limit.windowMs);
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
