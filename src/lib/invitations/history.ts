import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  associationEvents,
  users,
  type AssociationEventType,
  type AssociationOrgType,
} from "@/db/schema";

// ============================================================================
// The association audit's READ side (#304, OV-011) — "how did this plant come to
// be ours, and has it been ours before?"
//
// `./audit.ts` only ever INSERTs, by design; this is the one reader, kept in its
// own module so that statement stays true and so a future second reader has an
// obvious place to go.
//
// NO `"use server"` DIRECTIVE. Every export of such a module is a POSTable
// endpoint (`memory/invariants.md` → Authentication), and this is a read that
// takes a church id. Its caller — the oversight plant detail page — has already
// proved the plant is the caller's (`getOversightPlantDetail` answers null
// otherwise); nothing here re-checks that, and nothing here may ever be
// re-exported from an action module.
//
// ----------------------------------------------------------------------------
// SCOPED TO THE CALLER'S OWN ORG, in the WHERE clause
// ----------------------------------------------------------------------------
//
// `memory/invariants.md` → Hierarchical Access Control: reaching a plant is not
// permission to name the orgs BEHIND it. A plant's history can contain events
// belonging to an org the caller is not party to — the two oversight FKs are
// independent, so an accessible plant may have joined and left a sending church
// in a different network entirely, and that history is that sending church's
// business.
//
// So `org_type` and `org_id` are part of the predicate, and the id comes from the
// caller's session (`oversightOrgOfUser` in `./core`). A network admin reading a
// plant's history sees their own network's events and nothing else; there is no
// argument on this function a caller could put another org's id into that the
// page would ever supply, and no row comes back that names an org other than the
// one asked for.
//
// The ACTOR's name is the one identity this returns, and it is not a person
// record in the OV-002 sense: the actor of an event scoped to the caller's own
// org is either the plant's planter — whose name OV-001 already puts on the
// directory row, as the org's counterparty — or one of the caller's own
// colleagues. `association_events.actor_user_id` is NOT NULL, so a null name here
// means an account with no display name set, never a missing actor.
// ============================================================================

/** One row of a plant's association history, as the detail page renders it. */
export interface AssociationHistoryEntry {
  id: string;
  /** Which direction: the association was made, or it ended. */
  event: AssociationEventType;
  /** WHO did it. Null when that account has no display name set. */
  actorName: string | null;
  occurredAt: Date;
}

/**
 * The statement. Exported — not executed — so a test can read the bound
 * parameters off the generated SQL and assert that BOTH halves of the scope are
 * in the WHERE clause: the plant AND the caller's own org. Prose cannot hold
 * that, and dropping the org half is a two-character edit that no behaviour on
 * the page would reveal.
 *
 * Both arguments are required and both are in the WHERE: the plant (already
 * proved accessible by the caller) and the org (the caller's own). The index
 * `association_events_church_id_created_at_idx` covers the ordering.
 *
 * A projection rather than `select()` on the join: answering "who" must not pull
 * `password_hash` into application memory — the same reasoning as `accessColumns`
 * in `@/lib/notifications/enqueue`.
 */
export function associationHistoryQuery(
  org: { orgType: AssociationOrgType; orgId: string },
  churchId: string
) {
  return (
    db
      .select({
        id: associationEvents.id,
        event: associationEvents.event,
        actorName: users.name,
        occurredAt: associationEvents.createdAt,
      })
      .from(associationEvents)
      // LEFT, not inner: the column is NOT NULL and references `users`, but an
      // audit row has to survive its referent — an inner join would make a future
      // account deletion erase the record of what that account did, which is the
      // exact inverse of what an audit is for.
      .leftJoin(users, eq(users.id, associationEvents.actorUserId))
      .where(
        and(
          eq(associationEvents.churchId, churchId),
          eq(associationEvents.orgType, org.orgType),
          eq(associationEvents.orgId, org.orgId)
        )
      )
      .orderBy(desc(associationEvents.createdAt))
  );
}

/** One plant's association history WITH ONE ORG, newest first. Runs the statement above. */
export async function getAssociationHistoryForOrg(
  org: { orgType: AssociationOrgType; orgId: string },
  churchId: string
): Promise<AssociationHistoryEntry[]> {
  return associationHistoryQuery(org, churchId);
}
