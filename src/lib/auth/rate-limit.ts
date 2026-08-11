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
 * Read the originating IP from the `x-forwarded-for` header (first hop).
 * Returns `null` when unavailable.
 */
export async function getRequestIp(): Promise<string | null> {
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  if (!forwardedFor) {
    return null;
  }
  const firstHop = forwardedFor.split(",")[0]?.trim();
  return firstHop && firstHop.length > 0 ? firstHop : null;
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
 * successful attempt is recorded (success=true) but is neither counted nor
 * does it clear earlier failures — so a lockout persists until the failed
 * rows age out of the window, even across an intervening successful login.
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
 * Record an auth attempt. Opportunistically prunes rows older than one day on
 * each write (no cron exists; acceptable at beta volume).
 */
export async function recordAttempt(
  identifier: string,
  ip: string | null,
  kind: AuthAttemptKind,
  success: boolean
): Promise<void> {
  // Both statements are known up front and touch only auth_attempts, so they
  // ship as one batched transaction (sanctioned shape #1, src/db/index.ts):
  // one round trip, all-or-nothing.
  const cutoff = new Date(Date.now() - 24 * HOUR_MS);
  await db.batch([
    db.insert(authAttempts).values({
      identifier: identifier.toLowerCase(),
      ip,
      kind,
      success,
    }),
    // Opportunistic cleanup: delete rows older than one day.
    db.delete(authAttempts).where(lt(authAttempts.createdAt, cutoff)),
  ]);
}
