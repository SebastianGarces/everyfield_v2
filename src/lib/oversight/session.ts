// ============================================================================
// The oversight route guard — ONE copy of "who may open an /oversight page".
//
// Every route under `src/app/(dashboard)/oversight/` opened with the same nine
// lines: read the session, `redirect("/login")` with no user, then
//
//     if (user.role !== "sending_church_admin" && user.role !== "network_admin")
//       redirect("/dashboard");
//
// Six copies of one authority rule, and the rule is not cosmetic — it is the
// only thing between a planter and a portfolio read. A rule written six times is
// a rule that can be weakened in one of them, and adding a seventh oversight
// route meant remembering to write it again rather than failing to compile
// without it.
//
// THIS IS NOT THE ONLY GUARD AND MUST NOT BECOME ONE. Every read behind these
// routes refuses independently — `listOversightPlants` resolves no org for a
// church-level role, `listNetworkSendingChurches` refuses anything but a network
// admin, `getOversightPlantDetail` checks membership before the id reaches a
// query. This is the guard that stops a wrong-role user reaching the page at
// all, so the refusal is a redirect they can act on rather than an empty screen.
//
// NO `"use server"` DIRECTIVE, deliberately: an export of a `"use server"`
// module is a POSTable endpoint (memory/invariants.md → Authentication), and
// this is a helper the pages call, not one of them.
//
// The `@/lib/auth` import is DEFERRED into the call, the same seam `./read.ts`
// uses: it transitively loads the DB client, and keeping this module importable
// without a `DATABASE_URL` is what lets `session.test.ts` import the role list
// and assert it against `OVERSIGHT_ROLES` instead of restating it.
// ============================================================================

import { redirect } from "next/navigation";

import type { User, UserRole } from "@/db/schema";

/**
 * The two roles an `/oversight` route serves.
 *
 * A `const` tuple rather than a reference to `OVERSIGHT_ROLES`
 * (`@/lib/auth/access`), which is typed `UserRole[]` and therefore narrows
 * nothing — the tuple is what makes `isOversightRole` a type predicate and what
 * gives every page a `user` whose role the compiler already knows. The two
 * lists are asserted equal in `session.test.ts`, so they cannot drift.
 */
export const OVERSIGHT_ROLE_LIST = [
  "sending_church_admin",
  "network_admin",
] as const;

export type OversightRole = (typeof OVERSIGHT_ROLE_LIST)[number];

/** A session user already known to hold one of the two oversight roles. */
export type OversightUser = User & { role: OversightRole };

export function isOversightRole(role: UserRole): role is OversightRole {
  return (OVERSIGHT_ROLE_LIST as readonly UserRole[]).includes(role);
}

/**
 * The session behind every `/oversight` page, or a redirect.
 *
 * Two refusals, and they are deliberately different: no session goes to
 * `/login` because signing in is what is missing, and a church-level role goes
 * to `/dashboard` because they have a home to be sent to. Neither is a 404 —
 * that answer is reserved for the one case where the ROUTE's existence is
 * itself the disclosure (`/oversight/sending-churches` refusing a sending-church
 * admin), and it stays at that page because it is that page's rule.
 */
export async function requireOversightUser(): Promise<OversightUser> {
  const { getCurrentSession } = await import("@/lib/auth");

  const { user } = await getCurrentSession();

  if (!user) {
    redirect("/login");
  }

  if (!isOversightRole(user.role)) {
    redirect("/dashboard");
  }

  // The cast is the narrowing TypeScript will not do for us: `isOversightRole`
  // is a predicate about `user.role`, and `User` is not a discriminated union,
  // so refining the property does not refine the object. It is sound because
  // the line above is the only way past — `redirect()` returns `never`.
  return user as OversightUser;
}
