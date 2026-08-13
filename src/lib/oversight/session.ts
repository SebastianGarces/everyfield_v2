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
// without a `DATABASE_URL` is what lets `session.test.ts` assert this guard's
// behaviour with no database at all.
//
// THE ROLE PAIR IS NOT DECLARED HERE. It used to be — a second `as const` tuple
// beside `OVERSIGHT_ROLES` in `@/lib/auth/access`, reconciled by a regex that
// parsed that module's source text. Two implementations of one authority policy,
// with a drift guard pointed backwards: the change that removes the reason for
// the copy (declaring `OVERSIGHT_ROLES` `as const`) was the change that failed
// the guard. The declaration now lives in `@/lib/auth/roles`, an import-free
// leaf that reaches no database, so this module imports it directly and
// `isOversightRole` gets its type predicate from the one declaration.
// ============================================================================

import { redirect } from "next/navigation";

import type { User } from "@/db/schema";
// Imported, never re-served: `@/lib/auth/roles` is the one place either symbol
// comes from, the same rule `@/lib/invitations/register-path` lives by.
import { isOversightRole, type OversightRole } from "@/lib/auth/roles";

/** A session user already known to hold one of the two oversight roles. */
export type OversightUser = User & { role: OversightRole };

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
