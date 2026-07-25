"use server";

// ============================================================================
// LOCAL DEVELOPMENT ONLY — password-less sign-in.
//
// ⚠️  This creates a real session for an arbitrary user with NO credential
// check. It is the security-critical half of the dev account switcher, and the
// gate below is the one that actually matters: a client can call any server
// action by name, so hiding the UI is not protection. This check is.
//
// See dev-accounts.ts for why `isDevLoginEnabled()` holds in a production build.
// ============================================================================

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  generateSessionToken,
  setSessionCookie,
} from "@/lib/auth";

import { isDevLoginEnabled } from "./dev-accounts";

export type DevLoginState = { error?: string };

/**
 * Sign in as `userId` without a password. Refuses outright unless running on a
 * local development machine.
 */
export async function devLoginAs(
  _prevState: DevLoginState,
  formData: FormData
): Promise<DevLoginState> {
  // The gate. Nothing below this line may run in any deployed environment.
  if (!isDevLoginEnabled()) {
    return { error: "Not available." };
  }

  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId.length === 0) {
    return { error: "Select an account first." };
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return { error: "That account no longer exists." };
  }

  // Deliberately skips rate limiting and attempt recording: this is not a
  // login attempt, and polluting auth_attempts would distort the real
  // rate-limit behaviour being tested.
  const token = generateSessionToken();
  const session = await createSession(token, user.id);
  await setSessionCookie(token, session.expiresAt);

  const redirectTo = formData.get("redirect");
  const redirectPath =
    typeof redirectTo === "string" && redirectTo.startsWith("/")
      ? redirectTo
      : "/dashboard";

  redirect(redirectPath);
}
