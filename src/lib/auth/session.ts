import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { getSessionToken } from "./cookies";
import { UnauthorizedError } from "./unauthorized";
import { authenticatedSessionId } from "./session-scope";
import {
  hashToken,
  validateSessionToken,
  validateSessionId,
  type SessionValidationResult,
  type SessionValidationFailure,
} from "./session-token";
export {
  hashToken,
  validateSessionToken,
  type SessionValidationResult,
  type SessionValidationFailure,
} from "./session-token";
import { sessions, churches, type Session, type Church } from "@/db/schema";

// Constants
const SESSION_EXPIRY_DAYS = 30;

// Encoding helpers

const encodeBase32LowerCaseNoPadding = (bytes: Uint8Array): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let result = "";
  let bits = 0;
  let value = 0;

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 0x1f];
  }

  return result;
};

/**
 * Generate a cryptographically secure session token
 * Uses 120+ bits of entropy (15 bytes = 120 bits)
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return encodeBase32LowerCaseNoPadding(bytes);
}

export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
  country?: string;
  city?: string;
}

/**
 * Create a new session for a user
 * @param token - The unhashed session token (given to client)
 * @param userId - The user's ID
 * @param metadata - Optional session metadata (IP, user agent, etc.)
 * @returns The created session
 */
export async function createSession(
  token: string,
  userId: string,
  metadata: SessionMetadata = {}
): Promise<Session> {
  const sessionId = await hashToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  );

  const [session] = await db
    .insert(sessions)
    .values({
      id: sessionId,
      userId,
      expiresAt,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      country: metadata.country,
      city: metadata.city,
      // No reader yet: the freshness control is deliberately unwired until
      // the first sensitive op ships (ruled 405-2b, 2026-08-12).
      fresh: true,
    })
    .returning();

  return session;
}

/**
 * Invalidate a single session
 * @param sessionId - The hashed session ID from the database
 */
export async function invalidateSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Get the current session and user (cached per request)
 * Uses React.cache() for request-level deduplication
 */
export const getCurrentSession = cache(
  async (): Promise<SessionValidationResult | SessionValidationFailure> => {
    const token = await getSessionToken();

    if (!token) {
      return { session: null, user: null };
    }

    return validateSessionToken(token);
  }
);

/**
 * Verify that a valid session exists
 * Throws an error if unauthorized - use in Server Actions
 *
 * It throws `UnauthorizedError`, whose only addition to `Error` is a `digest`
 * (`@/lib/auth/unauthorized`): the throw leaves every action unhandled by
 * design, and the digest is what lets `@/components/app-error` tell THIS 500
 * from any other one — a client boundary is handed no message in production.
 * The message is still `"Unauthorized"`, so every reader of it is unaffected.
 *
 * @throws UnauthorizedError if no valid session exists
 */
export async function verifySession(): Promise<SessionValidationResult> {
  // Durable agent tools have no Next request. Never cache their current authority.
  const scopedSessionId = authenticatedSessionId();
  const result = scopedSessionId
    ? await validateSessionId(scopedSessionId)
    : await getCurrentSession();

  if (!result.session || !result.user) {
    throw new UnauthorizedError();
  }

  return result as SessionValidationResult;
}

/**
 * Preserve the request's authenticated session identity while bypassing its
 * cached user snapshot. No actor, user id, or session id is accepted from the
 * caller: the exact session comes only from `verifySession()`.
 */
export async function verifyFreshSession(): Promise<SessionValidationResult> {
  const authenticated = await verifySession();
  const fresh = await validateSessionId(authenticated.session.id);

  if (
    !fresh.session ||
    !fresh.user ||
    fresh.session.id !== authenticated.session.id ||
    fresh.user.id !== authenticated.user.id
  ) {
    throw new UnauthorizedError();
  }

  return fresh as SessionValidationResult;
}

/**
 * Get the current user's church (cached per request)
 * Returns null if user is not authenticated or has no church
 */
export const getCurrentUserChurch = cache(async (): Promise<Church | null> => {
  const { user } = await getCurrentSession();

  if (!user?.churchId) {
    return null;
  }

  const [church] = await db
    .select()
    .from(churches)
    .where(eq(churches.id, user.churchId))
    .limit(1);

  return church ?? null;
});
