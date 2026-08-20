// ============================================================================
// The network's sending-church roster — the read layer (OV-009).
//
// `/oversight/sending-churches` answers one question for a NETWORK admin: which
// sending churches belong to my network, how many plants does each of them
// account for, and how many invitations are they still waiting on.
//
// THREE RULES, all enforced at the query and none of them in a component:
//
//  1. NETWORK ADMINS ONLY. A sending-church admin IS one of the rows this page
//     lists; a roster of their PEERS is another org's portfolio, so the answer
//     for them is `[]` here and `notFound()` at the route. The network id comes
//     from the session user's own `sending_network_id` — there is no parameter
//     anywhere on this surface that names an organization, so one network
//     cannot ask for another's roster.
//
//  2. THE COUNTS STAY INSIDE THE CALLER'S TENANCY. A plant counts for a sending
//     church only when it is ALSO in the caller's network
//     (`sending_network_id` = theirs) — the exact predicate
//     `getAccessibleChurchIds` uses for a network admin (memory/invariants.md →
//     Hierarchical Access Control). Counting every plant that merely names a
//     member sending church would report plants the network has no access to,
//     and would make this page's numbers disagree with `/oversight/plants`.
//     With this predicate the roster's plant counts PARTITION that directory.
//
//  3. AGGREGATES ONLY. Both counts are `count()` over rows the caller may
//     already see in aggregate. No query here selects a name, an email or an id
//     belonging to a person — not even the invitee address that
//     `/oversight/invitations` renders, because that surface is scoped to the
//     caller's OWN invitations and this one reads a member org's.
// ============================================================================

import { oversightOrgOf } from "@/lib/auth/tenancy";
import { and, count, eq, inArray, sql } from "drizzle-orm";

import {
  churches,
  organizationInvitations,
  sendingChurches,
  type User,
} from "@/db/schema";
import type { NetworkSendingChurchSummary } from "@/lib/oversight/types";

// The value import below transitively loads the DB client (`@/db`). It is
// deferred to the call sites inside the async read so this module can be
// imported — and its contract asserted — without a DATABASE_URL, the same seam
// `./read.ts` uses.

/**
 * Every sending church in the caller's network, with its plant count and its
 * count of invitations still awaiting a reply, ordered by name.
 *
 * Returns `[]` for anybody who is not a network admin, and for a network admin
 * with no network of their own — the same refusal `getAccessibleChurchIds`
 * gives them, stated once more where the roster is built. The route refuses
 * them too; this is not the only guard, it is the guard that survives a future
 * caller.
 */
export async function listNetworkSendingChurches(
  user: User,
  asOf: Date = new Date()
): Promise<NetworkSendingChurchSummary[]> {
  const { db } = await import("@/db");

  // Rule 1. Not a tenancy check plus an id check — ONE check, because a network
  // id on an account whose tenancy is something else is not a licence to read a
  // network. `oversightOrgOf` is that one check: it answers only when the row
  // names exactly one tenancy and that tenancy is this network.
  const org = oversightOrgOf(user);
  if (org?.type !== "network") return [];
  const networkId = org.id;

  const members = await db
    .select({ id: sendingChurches.id, name: sendingChurches.name })
    .from(sendingChurches)
    .where(eq(sendingChurches.sendingNetworkId, networkId));

  if (members.length === 0) return [];

  const memberIds = members.map((member) => member.id);

  const [plantCounts, pendingCounts] = await Promise.all([
    readPlantCounts(memberIds, networkId),
    readPendingInvitationCounts(memberIds, asOf),
  ]);

  return members
    .map(
      (member) =>
        ({
          sendingChurchId: member.id,
          name: member.name,
          plantCount: plantCounts.get(member.id) ?? 0,
          pendingInvitationCount: pendingCounts.get(member.id) ?? 0,
        }) satisfies NetworkSendingChurchSummary
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How many plants each member sending church accounts for, WITHIN the caller's
 * network (rule 2 above). A member with none is simply absent from the map.
 */
async function readPlantCounts(
  memberIds: string[],
  networkId: string
): Promise<Map<string, number>> {
  const { db } = await import("@/db");

  const rows = await db
    .select({ sendingChurchId: churches.sendingChurchId, total: count() })
    .from(churches)
    .where(
      and(
        inArray(churches.sendingChurchId, memberIds),
        eq(churches.sendingNetworkId, networkId)
      )
    )
    .groupBy(churches.sendingChurchId);

  return countsByOrg(rows);
}

/**
 * How many invitations each member sending church has out that nobody has
 * answered yet.
 *
 * "Pending" means pending AND still open: `status = 'pending'` alone counts
 * rows whose window has closed, because expiry is applied LAZILY — an
 * invitation is flipped to `expired` when somebody tries to answer it
 * (`expireInvitationQuery`), so a lapsed row keeps reading `pending` until then.
 * A roster number that counts those overstates what the org is still waiting on.
 * The predicate is the one `bindOpenInvitationTarget` uses for the same
 * question, so the count and the redeem path cannot disagree about what is
 * still live.
 */
async function readPendingInvitationCounts(
  memberIds: string[],
  asOf: Date
): Promise<Map<string, number>> {
  const { db } = await import("@/db");

  const rows = await db
    .select({
      sendingChurchId: organizationInvitations.sendingChurchId,
      total: count(),
    })
    .from(organizationInvitations)
    .where(
      and(
        inArray(organizationInvitations.sendingChurchId, memberIds),
        eq(organizationInvitations.status, "pending"),
        sql`(${organizationInvitations.expiresAt} is null or ${organizationInvitations.expiresAt} > ${asOf})`
      )
    )
    .groupBy(organizationInvitations.sendingChurchId);

  return countsByOrg(rows);
}

/** Grouped rows → a lookup, dropping the null-key group Drizzle types in. */
function countsByOrg(
  rows: { sendingChurchId: string | null; total: number }[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.sendingChurchId) continue;
    counts.set(row.sendingChurchId, row.total);
  }
  return counts;
}
