import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { associationEvents, organizationInvitations } from "@/db/schema";

// ============================================================================
// The recorded-relationship tenancy basis (#304, OV-006 / OV-007).
//
// `enqueue`'s gate 1 asks `canAccessChurch`, which for an oversight admin is
// resolved from the PLANT'S CURRENT oversight FK. That is the right question
// for every notification about how a plant is doing, and the wrong one for the
// two events that END the relationship — see `OVERSIGHT_OWN_RELATIONSHIP_TYPES`
// in `./categories.ts` for why both are structurally false at the moment they
// fire.
//
// So this module answers the OTHER tenancy question, and it is a question about
// the database rather than about the caller: is there a record, in this
// product, of a relationship between this org and this plant? Two places can
// hold one, and either is enough:
//
//   * `organization_invitations` — the org invited this plant. Covers the
//     decline, where no association was ever made.
//   * `association_events`       — the org and this plant were associated at
//     some point. Covers the sever, whose audit row is written in the SAME
//     statement as the FK null (`severAssociationWithAuditStatement` in
//     `@/lib/invitations/audit`), so by the time the announcement runs the row
//     is committed and this returns true.
//
// WHAT THIS IS NOT. It is not a widening of `getAccessibleChurchIds` and it must
// never become one: nothing here is consulted by any READ path. It decides one
// thing — whether a notification row of two server-composed types may be filed
// under this church for this recipient — and `enqueue` reaches it only after
// `canAccessChurch` has already refused. An org that never invited and was never
// associated with this plant matches neither table and is refused exactly as
// before.
//
// NO `"use server"` DIRECTIVE, like everything else in this module: these are
// reads with no authority check of their own, and their whole job is to be
// called from inside a gate.
// ============================================================================

/**
 * The recipient's own org, as `enqueue` already has it projected off the `users`
 * row. At most one field is meaningfully set — an oversight admin belongs to a
 * sending church or to a network — and a recipient with NEITHER matches nothing
 * rather than everything (see `orgFilters` below).
 */
export interface RecipientOrg {
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
}

/**
 * `EXISTS` over the invitations this org issued to this plant, in ANY status.
 *
 * Status is deliberately not filtered. The event being announced IS the status
 * change (a decline), and a race in which the row is read back before the
 * commit this announcement follows would silently drop the notification. What
 * the predicate has to establish is that the org and the plant have an
 * invitation between them at all, which no status can make untrue.
 */
function invitationRelationship(org: RecipientOrg, churchId: string): SQL {
  const reaches = [
    org.sendingChurchId
      ? eq(organizationInvitations.sendingChurchId, org.sendingChurchId)
      : undefined,
    org.sendingNetworkId
      ? eq(organizationInvitations.sendingNetworkId, org.sendingNetworkId)
      : undefined,
  ].filter((clause) => clause !== undefined);

  // No org named — no relationship. Never "every invitation in the product",
  // which is what an `and()` with an undefined arm would collapse to.
  if (reaches.length === 0) return sql`false`;

  return and(
    eq(organizationInvitations.targetChurchId, churchId),
    or(...reaches)
  )!;
}

/** `EXISTS` over the audit: this org and this plant were associated at some point. */
function auditRelationship(org: RecipientOrg, churchId: string): SQL {
  const reaches = [
    org.sendingChurchId
      ? and(
          eq(associationEvents.orgType, "sending_church"),
          eq(associationEvents.orgId, org.sendingChurchId)
        )
      : undefined,
    org.sendingNetworkId
      ? and(
          eq(associationEvents.orgType, "network"),
          eq(associationEvents.orgId, org.sendingNetworkId)
        )
      : undefined,
  ].filter((clause) => clause !== undefined);

  if (reaches.length === 0) return sql`false`;

  return and(eq(associationEvents.churchId, churchId), or(...reaches))!;
}

/**
 * Is there a record of a relationship between this org and this plant?
 *
 * Two `LIMIT 1` probes, run only on the path where `canAccessChurch` has already
 * said no and the notification's `type` is one of the two own-relationship
 * events — so the ordinary fan-out (a digest, a gated milestone) never reaches
 * it and never pays for it.
 */
export async function orgHasRecordedRelationshipWithChurch(
  org: RecipientOrg,
  churchId: string
): Promise<boolean> {
  if (!org.sendingChurchId && !org.sendingNetworkId) return false;

  const [invited] = await db
    .select({ id: organizationInvitations.id })
    .from(organizationInvitations)
    .where(invitationRelationship(org, churchId))
    .limit(1);

  if (invited) return true;

  const [associated] = await db
    .select({ id: associationEvents.id })
    .from(associationEvents)
    .where(auditRelationship(org, churchId))
    .limit(1);

  return Boolean(associated);
}
