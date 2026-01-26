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
