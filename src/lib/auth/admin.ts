import "server-only";

import { notFound } from "next/navigation";

import type { User } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";

/**
 * Platform admin access control.
 *
 * Decision: until a dedicated platform-admin role exists, platform admins are
 * defined by the `ADMIN_EMAILS` environment variable — a comma-separated,
 * case-insensitive allowlist of user emails. The check is always performed
 * server-side.
 *
 * FUTURE UPGRADE PATH, and the seat model does NOT provide it. `users.seat` is
 * the seat held in ONE tenancy (see `src/db/schema/user.ts`), and a platform
 * admin belongs to no tenancy at all — there is no fourth seat to add, and
 * adding one would make `owner` mean something different in a fourth place.
 * Whatever replaces this allowlist is a fact about the account rather than
 * about a tenancy. Callers of `isPlatformAdmin` / `requirePlatformAdmin` would
 * not need to change.
 */

/**
 * Parse the ADMIN_EMAILS allowlist into a set of lowercased, trimmed emails.
 */
function getAdminEmailAllowlist(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0)
  );
}

/**
 * Check whether a user is a platform admin (non-throwing).
 * Compares the user's email against the ADMIN_EMAILS allowlist (case-insensitive).
 */
export function isPlatformAdmin(user: Pick<User, "email"> | null): boolean {
  if (!user?.email) {
    return false;
  }

  return getAdminEmailAllowlist().has(user.email.trim().toLowerCase());
}

/**
 * Guard for platform-admin-only surfaces. Resolves the current session and
 * verifies the user is a platform admin. Triggers a 404 (notFound) otherwise so
 * the existence of admin routes is not leaked to non-admins.
 *
 * Use in both admin pages AND admin server actions.
 *
 * @returns The authenticated platform-admin user.
 */
export async function requirePlatformAdmin(): Promise<User> {
  const { user } = await getCurrentSession();

  if (!user || !isPlatformAdmin(user)) {
    notFound();
  }

  return user;
}
