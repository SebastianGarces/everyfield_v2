import { cache } from "react";
import { eq, and, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, churches, type Session, type User, type Church } from "@/db/schema";

// Constants
const SESSION_EXPIRY_DAYS = 30;
const SESSION_REFRESH_THRESHOLD_DAYS = 15;
const FRESH_SESSION_MINUTES = 10;

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
 * Invalidate all sessions for a user
 * Useful for password changes, account compromise, etc.
 * @param userId - The user's ID
 */
export async function invalidateUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Get all active sessions for a user
 * Useful for "manage sessions" UI
 * @param userId - The user's ID
 * @returns Array of active sessions
 */
export async function getUserSessions(userId: string): Promise<Session[]> {
  return db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date()))
    );
}

/**
 * Mark a session as no longer fresh
 * @param sessionId - The hashed session ID from the database
 */
export async function markSessionStale(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ fresh: false })
    .where(eq(sessions.id, sessionId));
}

/**
 * Check if a session is fresh (for sensitive operations)
 * A session is fresh if it was created within maxAgeMinutes
 * @param session - The session to check
 * @param maxAgeMinutes - Maximum age in minutes (default: 10)
 */
export function isSessionFresh(
  session: Session,
  maxAgeMinutes: number = FRESH_SESSION_MINUTES
): boolean {
  if (!session.fresh) {
    return false;
  }

  const maxAge = maxAgeMinutes * 60 * 1000;
  const sessionAge = Date.now() - session.createdAt.getTime();

  return sessionAge < maxAge;
}

/**
 * Delete expired sessions from the database
 * Can be called from a cron job or background task
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });

  return result.length;
}

// Import cookies module lazily to avoid circular dependencies
// and to ensure it's only loaded in server context
async function getCookiesModule() {
  return import("./cookies");
}

/**
 * Get the current session and user (cached per request)
 * Uses React.cache() for request-level deduplication
 */
export const getCurrentSession = cache(
  async (): Promise<SessionValidationResult | SessionValidationFailure> => {
    const { getSessionToken } = await getCookiesModule();
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
 * @throws Error if no valid session exists
 */
export async function verifySession(): Promise<SessionValidationResult> {
  const result = await getCurrentSession();

  if (!result.session || !result.user) {
    throw new Error("Unauthorized");
  }

  return result as SessionValidationResult;
}

/**
 * Get the current user's church (cached per request)
 * Returns null if user is not authenticated or has no church
 */
export const getCurrentUserChurch = cache(
  async (): Promise<Church | null> => {
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
  }
);
