"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  hashPassword,
  generateSessionToken,
  createSession,
  setSessionCookie,
} from "@/lib/auth";
import { registerSchema, extractFieldErrors } from "@/lib/validations";

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
  const result = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
    role: formData.get("role") || undefined,
  });

  if (!result.success) {
    return {
      fieldErrors: extractFieldErrors<NonNullable<RegisterState["fieldErrors"]>>(
        result.error
      ),
    };
  }

  const { email, password, name, role } = result.data;

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
      name,
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
