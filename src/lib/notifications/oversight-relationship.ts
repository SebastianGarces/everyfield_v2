import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  associationEvents,
  organizationInvitations,
  type User,
} from "@/db/schema";
import { oversightOrgOf } from "@/lib/auth/tenancy";

import {
  namesAnOversightOrg,
  noOversightOrg,
  OVERSIGHT_ADMIN_ROWS,
  oversightOrgOfKind,
  type OversightAdminPairing,
  type OversightOrgIds,
} from "./oversight-admin";

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
 * The columns the tenancy rule reads — exactly what `enqueue` already projects.
 *
 * The oversight half is the pairing table's own key set, so a new org kind
 * widens this projection with the row rather than by somebody remembering to
 * add a name. `churchId` is named directly: it is the plant tenancy, it has no
 * row in that table, and `oversightOrgOf` refuses any row that carries it.
 */
export type OversightRecipient = Pick<
  User,
  "churchId" | OversightAdminPairing["fk"]
>;

/**
 * THE ORG IS THE ROW'S OWN TENANCY — #304 round 8 (ruled 2026-08-10), the same
 * rule `recipientAdministersOrg` applies to an org-ANCHORED row.
 *
 * All three tenancy FKs live on one `users` row and nothing in the schema holds
 * an account to one (memory/invariants.md → Multi-Tenancy). Until this function
 * existed, the recorded-relationship probe took the row as it came and OR'd the
 * two arms together, so an account that carried a network's id AND a sending
 * church's — a founder who administers both, or a row where the second FK was
 * set once and never cleared — could satisfy the probe through an invitation
 * that SENDING CHURCH had issued, and receive an own-relationship notification
 * about a plant they administer nothing of. That is the hierarchy walk
 * `memory/invariants.md` forbids, arriving through a column nobody checked
 * against the rest of the row.
 *
 * So a row contributes EXACTLY the one org its tenancy resolves to, and a row
 * whose FKs name none — or name two — contributes neither, which matches
 * nothing at all rather than everything (see the `false` returns below). That
 * decision is `oversightOrgOf`'s (`@/lib/auth/tenancy`); this function only
 * files the answer under the pairing table's key, which is the shape every
 * builder downstream indexes.
 *
 * The all-null base is `noOversightOrg()`, enumerated from the same table, and
 * `oversightOrgOfKind` picks the column from the kind — so no column name is
 * written here, and adding an org kind is a row in that table rather than an
 * edit to this function.
 *
 * Pure, and exported so it can be tested over the whole tenancy × org-FK domain.
 */
export function recipientOrgOf(recipient: OversightRecipient): OversightOrgIds {
  const org = oversightOrgOf(recipient);

  return org === null ? noOversightOrg() : oversightOrgOfKind(org.type, org.id);
}

/**
 * `EXISTS` over the invitations this org issued to this plant, in ANY status.
 *
 * Status is deliberately not filtered. The event being announced IS the status
 * change (a decline), and a race in which the row is read back before the
 * commit this announcement follows would silently drop the notification. What
 * the predicate has to establish is that the org and the plant have an
 * invitation between them at all, which no status can make untrue.
 *
 * ONE ARM PER ROW OF `OVERSIGHT_ADMIN`, like every other reader — the FK is the
 * row's, and `organization_invitations` carries the sending-church and network
 * ids under the same names `users` does, so the row's `fk` indexes both tables.
 */
function invitationRelationship(org: OversightOrgIds, churchId: string): SQL {
  const reaches = OVERSIGHT_ADMIN_ROWS.map(([, { fk }]) => {
    const orgId = org[fk];

    return orgId === null ? undefined : eq(organizationInvitations[fk], orgId);
  }).filter((clause) => clause !== undefined);

  // No org named — no relationship. Never "every invitation in the product",
  // which is what an `and()` with an undefined arm would collapse to.
  if (reaches.length === 0) return sql`false`;

  return and(
    eq(organizationInvitations.targetChurchId, churchId),
    or(...reaches)
  )!;
}

/**
 * `EXISTS` over the audit: this org and this plant were associated at some point.
 *
 * This is the reader that needs the org KIND as well as the FK, because
 * `association_events` stores the kind in `org_type` beside a polymorphic
 * `org_id`. It reads the kind off the pairing row's KEY, so the two org-kind
 * literals that used to sit here are gone with the FK names.
 */
function auditRelationship(org: OversightOrgIds, churchId: string): SQL {
  const reaches = OVERSIGHT_ADMIN_ROWS.map(([kind, { fk }]) => {
    const orgId = org[fk];

    return orgId === null
      ? undefined
      : and(
          eq(associationEvents.orgType, kind),
          eq(associationEvents.orgId, orgId)
        );
  }).filter((clause) => clause !== undefined);

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

  // No org named — no relationship, asked over the table's keys rather than
  // over two column names this module would then have to keep in step.
  if (!namesAnOversightOrg(org)) return false;

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
