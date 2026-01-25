import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "session";

const SESSION_EXPIRY_DAYS = 30;

/**
 * Set the session cookie with secure attributes
 * @param token - The unhashed session token
 * @param expiresAt - When the session expires
 */
export async function setSessionCookie(
  token: string,
  expiresAt: Date
): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
  });
}

/**
 * Delete the session cookie
 */
export async function deleteSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
  });
}

/**
 * Get the session token from cookies
 * @returns The session token or null if not present
 */
export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/**
 * Get cookie options for session cookie
 * Useful when setting cookie in middleware
 */
export function getSessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60, // 30 days in seconds
  };
}
