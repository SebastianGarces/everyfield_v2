import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type Session, type User } from "@/db/schema";

export interface SessionValidationResult {
  session: Session;
  user: User;
}
export interface SessionValidationFailure {
  session: null;
  user: null;
}

export async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function validateSessionToken(token: string) {
  return validateSessionId(await hashToken(token));
}

/** Server-only revalidation of an identity previously authenticated from a cookie. */
export async function validateSessionId(
  sessionId: string
): Promise<SessionValidationResult | SessionValidationFailure> {
  const [found] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!found) return { session: null, user: null };
  const { session, user } = found;
  if (Date.now() >= session.expiresAt.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return { session: null, user: null };
  }
  const day = 24 * 60 * 60 * 1000;
  if (session.expiresAt.getTime() < Date.now() + 15 * day) {
    const expiresAt = new Date(Date.now() + 30 * day);
    await db
      .update(sessions)
      .set({ expiresAt })
      .where(eq(sessions.id, sessionId));
    return { session: { ...session, expiresAt }, user };
  }
  return { session, user };
}
