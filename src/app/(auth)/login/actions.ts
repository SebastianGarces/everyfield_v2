"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  verifyPassword,
  generateSessionToken,
  createSession,
  setSessionCookie,
} from "@/lib/auth";
import { loginSchema, extractFieldErrors } from "@/lib/validations";
import {
  checkRateLimit,
  getRequestIp,
  recordAttempt,
} from "@/lib/auth/rate-limit";

export type LoginState = {
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
  };
};

export async function login(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return {
      fieldErrors: extractFieldErrors<NonNullable<LoginState["fieldErrors"]>>(
        result.error
      ),
    };
  }

  const { email, password } = result.data;
  const identifier = email.toLowerCase();
  const ip = await getRequestIp();

  // Rate-limit check BEFORE verifying credentials. Generic message avoids
  // leaking whether the account exists or timing of credential checks.
  const { limited } = await checkRateLimit(identifier, ip, "login");
  if (limited) {
    return { error: "Too many attempts. Please try again later." };
  }

  // Find user by email
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, identifier))
    .limit(1);

  if (!user) {
    await recordAttempt(identifier, ip, "login", false);
    return { error: "Invalid email or password" };
  }

  // Verify password
  const validPassword = await verifyPassword(user.passwordHash, password);

  if (!validPassword) {
    await recordAttempt(identifier, ip, "login", false);
    return { error: "Invalid email or password" };
  }

  // Record the successful attempt (counts toward success, not the failure
  // threshold — the failed-attempt window effectively resets on success).
  await recordAttempt(identifier, ip, "login", true);

  // Create session
  const token = generateSessionToken();
  const session = await createSession(token, user.id);

  // Set session cookie
  await setSessionCookie(token, session.expiresAt);

  // Get redirect path from form, default to dashboard
  const redirectTo = formData.get("redirect");
  const redirectPath =
    typeof redirectTo === "string" && redirectTo.startsWith("/")
      ? redirectTo
      : "/dashboard";

  redirect(redirectPath);
}
