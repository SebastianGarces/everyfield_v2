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
 * Counts only FAILED attempts in the window, so a successful login/register
 * (recorded with success=true) does not count toward the threshold — the
 * window effectively "resets" on success.
 */
export async function checkRateLimit(
  identifier: string,
  ip: string | null,
  kind: AuthAttemptKind
): Promise<RateLimitResult> {
  const normalizedIdentifier = identifier.toLowerCase();

  if (kind === "login") {
    const identifierFailures = await countFailures(
      authAttempts.identifier,
      normalizedIdentifier,
      "login",
      LOGIN_WINDOW_MS
    );
    if (identifierFailures >= LOGIN_MAX_PER_IDENTIFIER) {
      return { limited: true };
    }

    if (ip) {
      const ipFailures = await countFailures(
        authAttempts.ip,
        ip,
        "login",
        LOGIN_WINDOW_MS
      );
      if (ipFailures >= LOGIN_MAX_PER_IP) {
        return { limited: true };
      }
    }

    return { limited: false };
  }

  // register: limit by IP per hour
  if (ip) {
    const ipFailures = await countFailures(
      authAttempts.ip,
      ip,
      "register",
      REGISTER_WINDOW_MS
    );
    if (ipFailures >= REGISTER_MAX_PER_IP) {
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
  await db.insert(authAttempts).values({
    identifier: identifier.toLowerCase(),
    ip,
    kind,
    success,
  });

  // Opportunistic cleanup: delete rows older than one day.
  const cutoff = new Date(Date.now() - 24 * HOUR_MS);
  await db.delete(authAttempts).where(lt(authAttempts.createdAt, cutoff));
}
