import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  associationEvents,
  organizationInvitations,
  type User,
} from "@/db/schema";
import { OVERSIGHT_ADMIN } from "./oversight-admin";

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
 * The org this recipient may be asked about — EXACTLY ONE field set, or neither.
 *
 * Not a projection of the `users` row, and that is the whole point: both org FKs
 * live on the same row and nothing stops a user carrying both. Only
 * `recipientOrgOf` produces this shape, so the pairing of role to org kind
 * cannot be skipped by a caller who happens to hold a `users` row.
 */
export interface RecipientOrg {
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
}

/** The columns the pairing reads — exactly what `enqueue` already projects. */
export type OversightRecipient = Pick<
  User,
  "role" | "sendingChurchId" | "sendingNetworkId"
>;

/**
 * THE ROLE IS PAIRED WITH THE ORG KIND — #304 round 8 (ruled 2026-08-10),
 * the same rule `recipientAdministersOrg` applies to an org-ANCHORED row.
 *
 * Both oversight FKs live on one `users` row and neither implies the other
 * (memory/invariants.md → Multi-Tenancy). Until this function existed, the
 * recorded-relationship probe took the row as it came and OR'd the two arms
 * together, so a `network_admin` who also carried a `sending_church_id` — a
 * founder who administers both, or a row where the second FK was set once and
 * never cleared — could satisfy the probe through an invitation that SENDING
 * CHURCH had issued, and receive an own-relationship notification about a plant
 * they administer nothing of. That is the hierarchy walk `memory/invariants.md`
 * forbids, arriving through the role instead of through the FK.
 *
 * So each role contributes EXACTLY its own kind of org and nothing else:
 * `sending_church_admin` → the sending church, `network_admin` → the network,
 * every other role → neither, which matches nothing at all rather than
 * everything (see the `false` returns below).
 *
 * WHICH ROLE GOES WITH WHICH KIND, AND WHICH FK THAT KIND LIVES IN, are both
 * read from `OVERSIGHT_ADMIN` (`./oversight-admin.ts`, whose header carries the
 * rationale). This is the inverse direction of the other readers' lookup — a
 * role asking which org it speaks through, rather than an org kind asking which
 * role administers it — but it is the SAME pairing.
 *
 * The scan carries the whole answer, so no column name is written here: a role
 * that matches no row contributes nothing and the all-null base is returned
 * unchanged, which matches NOTHING at all rather than everything (see the
 * `false` returns below). Adding a kind is a row in that table; this function
 * does not change.
 *
 * Pure, and exported so it can be tested over the whole role × org-FK domain.
 */
export function recipientOrgOf(recipient: OversightRecipient): RecipientOrg {
  const org: RecipientOrg = { sendingChurchId: null, sendingNetworkId: null };

  for (const { role, fk } of Object.values(OVERSIGHT_ADMIN)) {
    if (recipient.role === role) org[fk] = recipient[fk];
  }

  return org;
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
 * Is there a record of a relationship between this recipient's org and this
 * plant?
 *
 * Two `LIMIT 1` probes, run only on the path where `canAccessChurch` has already
 * said no and the notification's `type` is one of the two own-relationship
 * events — so the ordinary fan-out (a digest, a gated milestone) never reaches
 * it and never pays for it.
 *
 * TAKES THE RECIPIENT, NOT AN ORG (#304 round 8). The pairing happens HERE,
 * behind the only door callers use, so there is no signature that accepts an
 * unpaired pair of FKs and no call site that has to remember to build one. The
 * caller in `enqueue` hands over the row it already projected.
 */
export async function orgHasRecordedRelationshipWithChurch(
  recipient: OversightRecipient,
  churchId: string
): Promise<boolean> {
  const org = recipientOrgOf(recipient);

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
