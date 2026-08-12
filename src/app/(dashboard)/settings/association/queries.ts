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

// ----------------------------------------------------------------------------
// TWO ROLES ANSWER HERE, NOT ONE (#304 WS3, ruled 2026-08-09)
// ----------------------------------------------------------------------------
//
// `inviteeAccountTarget` maps TWO roles to a target: a `planter` to their plant,
// and a `sending_church_admin` to their sending church. So two of the three
// invitation types can name an existing account, and the rule
// (`memory/invariants.md` → Multi-Tenancy, "No invitation that cannot be
// answered") is per TYPE:
//
//   * `church_to_sending_church` / `church_to_network` → the planter answers,
//     from the reads below that take a CHURCH id;
//   * `sending_church_to_network` → the sending church's ADMIN answers, from
//     the reads below that take a SENDING CHURCH id.
//
// #304's first build shipped only the first pair, which is the dead end HR4
// found: a `sending_church_admin` was targetable with nowhere in the product to
// answer. The second pair is the fix, and it is deliberately the same shape —
// same answerable predicate, same "derive the org from `type`" rule, same
// refusal to render an invitation whose counterparty does not resolve.
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// The SENDING CHURCH's side of the same screen (#304 WS3)
// ----------------------------------------------------------------------------

/**
 * The statement behind the sending church's pending list. Exported for the same
 * reason its plant-side twin is: the ANSWERABLE predicate is three clauses and
 * losing the third is invisible in behaviour until a 30-day-old row hits it.
 *
 * The `target_sending_church_id` predicate is also what keeps this list to the
 * ONE type a sending-church admin can answer — `sending_church_to_network` is
 * the only type whose target is a sending church.
 */
export function pendingInvitationsForSendingChurchQuery(
  sendingChurchId: string,
  now: Date
) {
  return db
    .select({
      id: organizationInvitations.id,
      createdAt: organizationInvitations.createdAt,
      expiresAt: organizationInvitations.expiresAt,
      type: organizationInvitations.type,
      sendingNetworkName: sendingNetworks.name,
    })
    .from(organizationInvitations)
    .leftJoin(
      sendingNetworks,
      eq(sendingNetworks.id, organizationInvitations.sendingNetworkId)
    )
    .where(
      and(
        eq(organizationInvitations.targetSendingChurchId, sendingChurchId),
        eq(organizationInvitations.status, "pending"),
        // UNEXPIRED — the same clause the plant-side query carries, for the
        // same reason: expiry is LAZY (`expireInvitationQuery` runs only when
        // somebody tries to answer), so `pending` alone would render Accept and
        // Decline buttons the server then refuses.
        sql`(${organizationInvitations.expiresAt} is null or ${organizationInvitations.expiresAt} > ${now})`
      )
    )
    .orderBy(desc(organizationInvitations.createdAt));
}

/**
 * Every ANSWERABLE invitation addressed to this SENDING CHURCH, newest first,
 * with the inviting network's name resolved.
 *
 * Only a network invites a sending church, so there is one join and one org
 * kind — but the org is still derived from `type` rather than from whichever FK
 * column happens to be populated, because nothing constrains an
 * `organization_invitations` row to one FK and `insertInvitation` validates
 * none. A row of the wrong type that somehow carried this sending church as its
 * target names no counterparty and is dropped rather than rendered blank.
 */
export async function getPendingInvitationsForSendingChurch(
  sendingChurchId: string,
  now = new Date()
): Promise<PendingInvitationView[]> {
  const rows = await pendingInvitationsForSendingChurchQuery(
    sendingChurchId,
    now
  );

  return rows.flatMap((row) => {
    if (row.type !== "sending_church_to_network") return [];
    if (!row.sendingNetworkName) return [];

    return [
      {
        id: row.id,
        orgName: row.sendingNetworkName,
        // The counterparty of a `sending_church_to_network` invitation is
        // always a network; the field says which KIND of org is asking, and
        // that is the one thing it can be.
        orgType: "network" as const,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      },
    ];
  });
}

/**
 * The sending church's CURRENT network, or null.
 *
 * One association, not two: `sending_churches` has a single oversight FK, so
 * this returns at most one row where the plant's side returns up to two.
 *
 * IT IS SEVERABLE, and the endpoint behind it is the sending church's own:
 * `leaveNetworkAsSendingChurchAdmin` (OV-013, shipped with #304 WS3), which
 * takes NO argument at all — the sending church is the actor's own, the network
 * is whatever it currently points at, and the org kind is fixed. The plant's
 * `leaveOversightOrgAs` is a different endpoint with a different authority rule
 * and takes no sending-church shape; a single endpoint with a role branch was
 * rejected (`memory/invariants.md` → Multi-Tenancy).
 *
 * (This comment used to say the view was read-only "because there is no sever
 * for this side of the hierarchy". That was true only until migration 0036 gave
 * `association_events` a subject discriminator, which is what a sending church's
 * sever needed in order to be audited at all — #274 requires an audit row of
 * every sever, so OV-013 could not ship before it.)
 */
export async function getCurrentNetworkAssociation(
  sendingChurchId: string
): Promise<CurrentAssociationView | null> {
  const [row] = await db
    .select({
      sendingNetworkId: sendingChurches.sendingNetworkId,
      sendingNetworkName: sendingNetworks.name,
    })
    .from(sendingChurches)
    .leftJoin(
      sendingNetworks,
      eq(sendingNetworks.id, sendingChurches.sendingNetworkId)
    )
    .where(eq(sendingChurches.id, sendingChurchId))
    .limit(1);

  if (!row?.sendingNetworkId || !row.sendingNetworkName) return null;

  return {
    orgType: "network",
    orgId: row.sendingNetworkId,
    orgName: row.sendingNetworkName,
  };
}
