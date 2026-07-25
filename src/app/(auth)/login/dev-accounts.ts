// ============================================================================
// LOCAL DEVELOPMENT ONLY — account switcher data source.
//
// Backs a combobox on the login form that signs in as any existing user
// WITHOUT a password, so features can be exercised across roles (planter /
// oversight / eval corpus) without juggling credentials.
//
// ⚠️  This bypasses authentication entirely. It must never run anywhere but a
// local dev machine. `isDevLoginEnabled()` is the single gate, and it is
// checked in THREE independent places:
//   1. here, before any account is listed,
//   2. in the server action, before any session is created (the one that
//      actually matters — a client cannot talk itself past it),
//   3. in the page, before the component is rendered at all.
//
// Why the guard holds in production:
//   - Next.js inlines `process.env.NODE_ENV` at build time. `next build` sets
//     it to "production", so the comparison becomes a compile-time `false` and
//     the guarded branches are dead-code-eliminated from the bundle.
//   - Vercel deployments — including PREVIEW deployments — are production
//     builds, so NODE_ENV alone already covers them. The extra `VERCEL` check
//     is belt-and-braces in case anything is ever deployed with a dev build.
// ============================================================================

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { churches, users } from "@/db/schema";

import type { DevAccount, DevAccountGroup } from "./dev-account-types";

/** Email domain used by the phase-engine eval corpus. */
const EVAL_EMAIL_DOMAIN = "eval.phase-engine.everyfield.dev";

/**
 * The ONE gate for the dev account switcher. Everything else defers to this.
 * Deliberately not configurable by env var — an env var is exactly the kind of
 * thing that gets copied into a deployed environment by accident.
 */
export function isDevLoginEnabled(): boolean {
  return process.env.NODE_ENV === "development" && !process.env.VERCEL;
}

function groupFor(email: string, role: string): DevAccountGroup {
  if (email.endsWith(`@${EVAL_EMAIL_DOMAIN}`)) return "Phase Engine eval";
  if (role === "network_admin" || role === "sending_church_admin") {
    return "Oversight";
  }
  if (role === "planter") return "Planters";
  return "Other";
}

/**
 * Every user in the database, shaped for the switcher. Returns an empty list
 * when the switcher is disabled, so a production build can never leak the
 * account roster even if a caller forgets to check the gate.
 */
export async function listDevAccounts(): Promise<DevAccount[]> {
  if (!isDevLoginEnabled()) return [];

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      churchName: churches.name,
    })
    .from(users)
    .leftJoin(churches, eq(churches.id, users.churchId))
    .orderBy(asc(users.email));

  return rows.map((row) => ({
    id: row.id,
    // `users.name` is nullable; the email is always the reliable identifier.
    name: row.name ?? "(unnamed)",
    email: row.email,
    role: row.role,
    churchName: row.churchName ?? null,
    group: groupFor(row.email, row.role),
  }));
}
