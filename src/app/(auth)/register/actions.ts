"use server";

import { db } from "@/db";
import type { UserRole } from "@/db/schema";
import {
  churchPrivacySettings,
  sendingChurches,
  sendingNetworks,
  users,
} from "@/db/schema";
import {
  createSession,
  generateSessionToken,
  hashPassword,
  setSessionCookie,
} from "@/lib/auth";
import { extractFieldErrors, registerSchema } from "@/lib/validations";
import type { AccountType } from "@/lib/validations/auth";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export type RegisterState = {
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
    name?: string;
    organizationName?: string;
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
    accountType: formData.get("accountType") || "planter",
    organizationName: formData.get("organizationName") || undefined,
  });

  if (!result.success) {
    return {
      fieldErrors: extractFieldErrors<
        NonNullable<RegisterState["fieldErrors"]>
      >(result.error),
    };
  }

  const { email, password, name, accountType, organizationName } = result.data;

  // Check if user already exists
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (existingUser.length > 0) {
    return { error: "An account with this email already exists" };
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create entity + user based on account type
  // Planters sign up without a church — they create one later from the dashboard
  const { role, churchId, sendingChurchId, sendingNetworkId } =
    await createAccountEntities(accountType, organizationName ?? null);

  const [user] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      passwordHash,
      name,
      role,
      churchId,
      sendingChurchId,
      sendingNetworkId,
    })
    .returning();

  // Create default privacy settings for church plants
  if (churchId) {
    await db.insert(churchPrivacySettings).values({
      churchId,
      updatedBy: user.id,
    });
  }

  // Create session
  const token = generateSessionToken();
  const session = await createSession(token, user.id);

  // Set session cookie
  await setSessionCookie(token, session.expiresAt);

  redirect("/dashboard");
}

/**
 * Create the appropriate organizational entity based on account type.
 * Returns the role and FK values to set on the user.
 *
 * Planters sign up without creating a church — they get free access to
 * Phase 0 content and the Wiki. They create their church from the dashboard
 * when they're ready.
 */
async function createAccountEntities(
  accountType: AccountType,
  organizationName: string | null
): Promise<{
  role: UserRole;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
}> {
  switch (accountType) {
    case "planter": {
      // No church created at signup — planter gets free Phase 0 / Wiki access
      // They'll create a church from the dashboard when ready
      return {
        role: "planter",
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId: null,
      };
    }

    case "sending_church": {
      if (!organizationName) {
        throw new Error("Organization name is required for sending church accounts");
      }
      // Create a new sending church (independent, no network)
      const [sendingChurch] = await db
        .insert(sendingChurches)
        .values({ name: organizationName })
        .returning();

      return {
        role: "sending_church_admin",
        churchId: null,
        sendingChurchId: sendingChurch.id,
        sendingNetworkId: null,
      };
    }

    case "network": {
      if (!organizationName) {
        throw new Error("Organization name is required for network accounts");
      }
      // Create a new sending network
      const [network] = await db
        .insert(sendingNetworks)
        .values({ name: organizationName })
        .returning();

      return {
        role: "network_admin",
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId: network.id,
      };
    }
  }
}
