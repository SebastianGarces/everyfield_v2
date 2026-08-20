// ============================================================================
// LOCAL DEVELOPMENT ONLY — account switcher data source.
//
// Backs a combobox on the login form that signs in as any existing user
// WITHOUT a password, so features can be exercised across seats and tenancies
// (plant / oversight / eval corpus) without juggling credentials.
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
import { oversightOrgOf, type SeatFields } from "@/lib/auth/tenancy";

import type { DevAccount, DevAccountGroup } from "./dev-account-types";

/**
 * Marker shared by every phase-engine eval address
 * (`<who>@eval.phase-engine.<domain>`, seeded by
 * `scripts/seed-phase-engine-eval.ts`).
 *
 * The SUBDOMAIN, not the full domain, on purpose: the product domain changed
 * once already (everyfield.app, ruled 2026-07-31) and this picker groups
 * whatever rows the database happens to hold — including a corpus seeded before
 * a retirement. Pinning the full domain here would silently drop those accounts
 * into "Other" rather than the eval group, which is a wrong label with no error
 * behind it.
 */
const EVAL_EMAIL_MARKER = "@eval.phase-engine.";

/**
 * The ONE gate for the dev account switcher. Everything else defers to this.
 * Deliberately not configurable by env var — an env var is exactly the kind of
 * thing that gets copied into a deployed environment by accident.
 */
export function isDevLoginEnabled(): boolean {
  return process.env.NODE_ENV === "development" && !process.env.VERCEL;
}

/** Exported for its test — the grouping rule is the only logic in this module. */
export function groupFor(email: string, account: SeatFields): DevAccountGroup {
  if (email.includes(EVAL_EMAIL_MARKER)) return "Phase Engine eval";
  if (oversightOrgOf(account)) return "Oversight";
  if (account.seat === "owner" && account.churchId) return "Planters";
  return "Other";
}

/**
 * What this account IS, in one phrase — the switcher's right-hand column.
 *
 * Built HERE rather than mapped from an enum in the component: the seat alone
 * is three words that mean nothing without a tenancy ("owner" of what?), so the
 * label is the pair, and the pair is only knowable server-side.
 */
export function standingLabel(account: SeatFields): string {
  const org = oversightOrgOf(account);
  const where = org
    ? org.type === "network"
      ? "Network"
      : "Sending church"
    : account.churchId
      ? "Plant"
      : null;

  if (!account.seat) return where ? `${where} · no seat` : "Coach / no seat";
  if (!where) return `${account.seat} · no tenancy`;

  return `${where} ${account.seat}`;
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
      seat: users.seat,
      churchId: users.churchId,
      sendingChurchId: users.sendingChurchId,
      sendingNetworkId: users.sendingNetworkId,
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
    standing: standingLabel(row),
    churchName: row.churchName ?? null,
    group: groupFor(row.email, row),
  }));
}
