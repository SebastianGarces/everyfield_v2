import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  organizationInvitations,
  sendingChurches,
  sendingNetworks,
  type AssociationOrgType,
} from "@/db/schema";

// ============================================================================
// The planter's association area — its reads (#304, OV-004/OV-005).
//
// NO `"use server"` DIRECTIVE, and that is the point: every export of such a
// module is a POSTable endpoint (`memory/invariants.md` → Authentication), and
// these are reads that take a church id. They are called from the page and from
// the dashboard, both of which have already resolved the church from the
// session; nothing here checks authority, and nothing here may ever be
// re-exported from `./actions.ts`.
//
// WHAT THE PLANTER IS TOLD, AND WHY IT IS MORE THAN OVERSIGHT GETS. The
// invariant that oversight may not name the orgs behind a plant
// (`memory/invariants.md` → Hierarchical Access Control) runs the other way
// here: this is the plant's OWN view of its own associations and of the
// invitations addressed to it. Naming the org that invited them is the entire
// content of the decision they are being asked to make — an "accept" with an
// unnamed counterparty is not consent.
//
// The invitee email is deliberately NOT read back onto this screen. The planter
// already knows their own address, and the row's two internal user ids
// (`inviter_user_id`, `responded_by`) are never selected at all — see
// `InvitationView` in `@/lib/invitations/core` for why an id that reaches the
// client is an id somebody can aim a request at.
// ============================================================================

/** One pending invitation, as the association area and the dashboard render it. */
export interface PendingInvitationView {
  id: string;
  /** WHICH org is asking, named — the substance of the decision. */
  orgName: string;
  orgType: AssociationOrgType;
  createdAt: Date;
  expiresAt: Date | null;
}

/** One association the plant currently has, and can end. */
export interface CurrentAssociationView {
  orgType: AssociationOrgType;
  orgId: string;
  orgName: string;
}

/**
 * The statement behind the read below. Exported so a test can read its bound
 * parameters — the ANSWERABLE predicate is three clauses and losing any one of
 * them is invisible in behaviour until a real row hits it.
 */
export function pendingInvitationsForPlantQuery(churchId: string, now: Date) {
  return db
    .select({
      id: organizationInvitations.id,
      createdAt: organizationInvitations.createdAt,
      expiresAt: organizationInvitations.expiresAt,
      type: organizationInvitations.type,
      sendingChurchName: sendingChurches.name,
      sendingNetworkName: sendingNetworks.name,
    })
    .from(organizationInvitations)
    .leftJoin(
      sendingChurches,
      eq(sendingChurches.id, organizationInvitations.sendingChurchId)
    )
    .leftJoin(
      sendingNetworks,
      eq(sendingNetworks.id, organizationInvitations.sendingNetworkId)
    )
    .where(
      and(
        eq(organizationInvitations.targetChurchId, churchId),
        eq(organizationInvitations.status, "pending"),
        // UNEXPIRED, the same predicate `bindOpenInvitationTargetQuery` and
        // `loadRespondableInvitation` carry (#304, HR4 2026-08-09).
        //
        // `status` alone is not "answerable": expiry is LAZY in this product —
        // a row is stamped `expired` only when somebody tries to answer it
        // (`expireInvitationQuery`), so an invitation whose window closed on
        // day 30 still reads `pending` on day 40. Without this clause the
        // dashboard rendered it with live Accept/Decline buttons that the
        // server then refused with "Invitation has expired" — and because the
        // reminder is dismissible only by ANSWERING, a planter had a banner
        // they could neither answer nor remove.
        sql`(${organizationInvitations.expiresAt} is null or ${organizationInvitations.expiresAt} > ${now})`
      )
    )
    .orderBy(desc(organizationInvitations.createdAt));
}

/**
 * Every ANSWERABLE invitation addressed to this plant, newest first, with the
 * inviting org's NAME resolved.
 *
 * Two left joins rather than two queries: an invitation carries a sending church
 * id or a network id (never both, for a row `resolveInvitationRequest` built),
 * and which one is set is what says who is asking.
 *
 * `sending_church_to_network` rows cannot appear — their target is a sending
 * church, not a church — so the `target_church_id` predicate is also what keeps
 * this list to the two types a planter can answer.
 *
 * `now` is injectable for the same reason it is on the invitation writes: the
 * instant is the server's, never a client's, and a test needs to stand on both
 * sides of an expiry without waiting 30 days.
 */
export async function getPendingInvitationsForPlant(
  churchId: string,
  now = new Date()
): Promise<PendingInvitationView[]> {
  const rows = await pendingInvitationsForPlantQuery(churchId, now);

  return rows.flatMap((row) => {
    // Derived from `type`, never from whichever FK happens to be populated —
    // the same rule `invitingOrgForInvitation` applies to the notification
    // audience, and for the same reason: nothing constrains a row to one FK.
    const orgType: AssociationOrgType | null =
      row.type === "church_to_sending_church"
        ? "sending_church"
        : row.type === "church_to_network"
          ? "network"
          : null;

    const orgName =
      orgType === "sending_church"
        ? row.sendingChurchName
        : orgType === "network"
          ? row.sendingNetworkName
          : null;

    // A row whose type-implied org does not resolve names nobody, and an
    // invitation from nobody is not something to ask a planter to answer. It is
    // dropped rather than rendered with a blank counterparty.
    if (!orgType || !orgName) return [];

    return [
      {
        id: row.id,
        orgName,
        orgType,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      },
    ];
  });
}

/**
 * The plant's CURRENT associations — zero, one, or two.
 *
 * Both oversight FKs are read, because they are independent
 * (`memory/invariants.md` → Multi-Tenancy): belonging to a sending church says
 * nothing about belonging to a network, and leaving one leaves the other
 * standing. The surface has to show both or the planter cannot tell which of
 * them the Leave button is about.
 */
export async function getCurrentAssociations(
  churchId: string
): Promise<CurrentAssociationView[]> {
  const [row] = await db
    .select({
      sendingChurchId: churches.sendingChurchId,
      sendingChurchName: sendingChurches.name,
      sendingNetworkId: churches.sendingNetworkId,
      sendingNetworkName: sendingNetworks.name,
    })
    .from(churches)
    .leftJoin(sendingChurches, eq(sendingChurches.id, churches.sendingChurchId))
    .leftJoin(
      sendingNetworks,
      eq(sendingNetworks.id, churches.sendingNetworkId)
    )
    .where(eq(churches.id, churchId))
    .limit(1);

  if (!row) return [];

  const associations: CurrentAssociationView[] = [];

  if (row.sendingChurchId && row.sendingChurchName) {
    associations.push({
      orgType: "sending_church",
      orgId: row.sendingChurchId,
      orgName: row.sendingChurchName,
    });
  }

  if (row.sendingNetworkId && row.sendingNetworkName) {
    associations.push({
      orgType: "network",
      orgId: row.sendingNetworkId,
      orgName: row.sendingNetworkName,
    });
  }

  return associations;
}
