"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type UserRole } from "@/db/schema";
import {
  hashPassword,
  generateSessionToken,
  createSession,
  setSessionCookie,
} from "@/lib/auth";

export type RegisterState = {
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
    name?: string;
  };
};

export async function register(
  _prevState: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const name = formData.get("name") as string;
  const role = (formData.get("role") as UserRole) || "planter";

  // Validate inputs
  const fieldErrors: RegisterState["fieldErrors"] = {};

  if (!email || !email.includes("@")) {
    fieldErrors.email = "Please enter a valid email address";
  }

  if (!password || password.length < 8) {
    fieldErrors.password = "Password must be at least 8 characters";
  }

  if (!name || name.trim().length === 0) {
    fieldErrors.name = "Please enter your name";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  // Check if user already exists
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (existingUser.length > 0) {
    return { error: "An account with this email already exists" };
  }

  // Hash password and create user
  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      passwordHash,
      name: name.trim(),
      role,
    })
    .returning();

  // Create session
  const token = generateSessionToken();
  const session = await createSession(token, user.id);

  // Set session cookie
  await setSessionCookie(token, session.expiresAt);

  redirect("/dashboard");
}
