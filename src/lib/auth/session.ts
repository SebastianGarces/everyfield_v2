import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { getSessionToken } from "./cookies";
import { UnauthorizedError } from "./unauthorized";
import {
  sessions,
  users,
  churches,
  type Session,
  type User,
  type Church,
} from "@/db/schema";

// Constants
const SESSION_EXPIRY_DAYS = 30;
const SESSION_REFRESH_THRESHOLD_DAYS = 15;

// Encoding helpers
const encodeHexLowerCase = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

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

/**
 * Hash a token using SHA-256
 * Returns lowercase hex string (64 chars)
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return encodeHexLowerCase(new Uint8Array(hashBuffer));
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

export interface SessionValidationResult {
  session: Session;
  user: User;
}

export interface SessionValidationFailure {
  session: null;
  user: null;
}

/**
 * Validate a session token
 * Implements sliding window expiration - extends if within threshold of expiry
 * @param token - The unhashed session token from the cookie
 * @returns Session and user if valid, null values if invalid
 */
export async function validateSessionToken(
  token: string
): Promise<SessionValidationResult | SessionValidationFailure> {
  const sessionId = await hashToken(token);

  return validateSessionId(sessionId);
}

/**
 * Reload one already-authenticated session identity and its current user row.
 *
 * This deliberately is not React-cached. Sensitive multi-step operations use
 * it after the request's cached session has established which exact session is
 * speaking, so a seat, tenancy, revocation, or expiry change becomes visible
 * before the next lasting effect.
 */
async function validateSessionId(
  sessionId: string
): Promise<SessionValidationResult | SessionValidationFailure> {
  const result = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (result.length === 0) {
    return { session: null, user: null };
  }

  const { session, user } = result[0];

  // Check if session has expired
  if (Date.now() >= session.expiresAt.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return { session: null, user: null };
  }

  // Sliding window: extend expiration if within threshold
  const refreshThreshold =
    Date.now() + SESSION_REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

  if (session.expiresAt.getTime() < refreshThreshold) {
    const newExpiresAt = new Date(
      Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    );

    await db
      .update(sessions)
      .set({ expiresAt: newExpiresAt })
      .where(eq(sessions.id, sessionId));

    return {
      session: { ...session, expiresAt: newExpiresAt },
      user,
    };
  }

  return { session, user };
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
  const result = await getCurrentSession();

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
