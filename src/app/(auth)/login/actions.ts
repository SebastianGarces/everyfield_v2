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
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  // Validate inputs
  const fieldErrors: LoginState["fieldErrors"] = {};

  if (!email || !email.includes("@")) {
    fieldErrors.email = "Please enter a valid email address";
  }

  if (!password) {
    fieldErrors.password = "Please enter your password";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  // Find user by email
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    return { error: "Invalid email or password" };
  }

  // Verify password
  const validPassword = await verifyPassword(user.passwordHash, password);

  if (!validPassword) {
    return { error: "Invalid email or password" };
  }

  // Create session
  const token = generateSessionToken();
  const session = await createSession(token, user.id);

  // Set session cookie
  await setSessionCookie(token, session.expiresAt);

  redirect("/dashboard");
}
