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
// WHO MAY OPEN ONE IS NOT DECLARED HERE. It used to be — a second `as const`
// tuple of oversight roles beside the one in `@/lib/auth/access`, reconciled by
// a regex that parsed that module's source text. Two implementations of one
// authority policy, with a drift guard pointed backwards. The question is now
// answered once, by `oversightOrgOf` in `@/lib/auth/tenancy`, an import-free
// leaf that reaches no database.
//
// AND IT RETURNS THE ORG, NOT A BOOLEAN. Every page past this guard needed the
// caller's org kind a second time — for the scope label, for the network-only
// refusal on `/oversight/sending-churches` — and used to re-derive it from
// `user.role`. With the role gone there is nothing to re-derive it FROM except
// the same two FKs this guard already read, so it hands back what it resolved.
// ============================================================================

import { redirect } from "next/navigation";

import type { User } from "@/db/schema";
// Imported, never re-served: `@/lib/auth/tenancy` is the one place these come
// from, the same rule `@/lib/invitations/register-path` lives by.
import { oversightOrgOf, type OversightOrg } from "@/lib/auth/tenancy";

/**
 * A session whose tenancy is known to be an oversight org, with that org
 * resolved — the pair every `/oversight` page reads.
 *
 * TWO FIELDS RATHER THAN A NARROWED `User`, because there is nothing on the row
 * to narrow any more. The old shape was `User & { role: OversightRole }` and
 * needed a cast, since `User` is not a discriminated union and refining a
 * property does not refine the object. `org` carries the refinement instead: it
 * is non-null by construction, so a page reads `org.type` without asking again.
 */
export type OversightSession = { user: User; org: OversightOrg };

/**
 * The session behind every `/oversight` page, or a redirect.
 *
 * ONE refusal lives here: a church-level account goes to `/dashboard`, because
 * they have a home to be sent to. It is not a 404 — that answer is reserved for
 * the one case where the ROUTE's existence is itself the disclosure
 * (`/oversight/sending-churches` refusing a sending-church account), and it
 * stays at that page because it is that page's rule.
 *
 * The signed-out refusal USED to be here too, as a second `redirect("/login")`.
 * It is gone (#503). `/oversight` is inside the `(dashboard)` group, so the
 * layout has already bounced a session-less reader — carrying the return path,
 * which this copy did not — and the proxy bounces them at the edge before that.
 * A third bounce could only race the two that work and send the reader somewhere
 * with no way back. `verifySession` asks for the session those guards have
 * already established; if it ever throws, the reader is at a boundary that
 * offers a sign-in link back to where they were, not at a redirect loop.
 */
export async function requireOversightUser(): Promise<OversightSession> {
  const { verifySession } = await import("@/lib/auth");

  const { user } = await verifySession();

  const org = oversightOrgOf(user);

  if (!org) {
    redirect("/dashboard");
  }

  return { user, org };
}
