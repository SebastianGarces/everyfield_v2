// ============================================================================
// The association audit — OV-008's write side (issue #303).
//
// One table (`association_events`, `src/db/schema/association-event.ts`), one
// writer, and it only ever INSERTs. Every association write (an accepted
// invitation) and every sever (#277 planter-side, #278 org-side) records a row
// here, so that "which org was this plant with, who put them there, who took
// them out, and when" survives the sever that nulls `churches.sending_church_id`
// / `sending_network_id`.
//
// THIS MODULE HAS NO `"use server"` DIRECTIVE, AND THAT IS DELIBERATE — the same
// rule `./core` is built on and the finding of #265. In a `"use server"` module
// every export is a POSTable endpoint reachable with no session and no UI, so
// exporting `recordAssociationEvent` from one would publish an anonymous
// "write any audit row you like, about any church, attributed to any user"
// endpoint — which is the exact inverse of what an audit is for. The
// authenticated wrappers live with the surfaces that own the authority rule
// (#277/#278) and call this; nothing here is ever re-exported from an action
// module. `audit.test.ts` pins both halves.
//
// THE ACTOR IS NOT A UUID. `recordAssociationEvent` takes an `InvitationActor`
// — the branded type from `./core`, mintable only by
// `invitationActorFromSession(await verifySession())` — and reads the id off it.
// A bare `{ id: string }` is not assignable, so "attribute this to whoever the
// request said" cannot be written by accident, let alone reached by a forged
// POST. The type is imported with `import type`, so this module does not pull
// the invitation logic layer into anybody's module graph at runtime: importing
// the audit writer must not silently widen what a caller can reach.
//
// ATOMICITY. `associationEventStatement` builds the INSERT without executing it,
// so a caller can put the audit row in the SAME `db.batch([...])` as the write
// it audits — the only way the two are all-or-nothing on neon-http, which has no
// interactive transactions (`memory/invariants.md` → Transactions / Atomicity).
// Prefer that over `recordAssociationEvent` wherever the audited write is a
// statement you already have: batching is what stops a committed sever from
// having no audit row behind it, and an audit written in a second round trip is
// exactly the "half-applied" shape the invariant warns about.
//
// `recordAssociationEvent` is the one-statement convenience for the cases where
// there is nothing to batch it with (a backfill, a path whose write already
// committed elsewhere). It runs the same statement.
// ============================================================================

import { db } from "@/db";
import {
  associationEvents,
  type AssociationEvent,
  type AssociationEventType,
  type AssociationOrgType,
} from "@/db/schema";

import type { InvitationActor } from "./core";

/**
 * WHAT is being recorded. Everything except the actor, which never comes from a
 * caller's data — see `recordAssociationEvent`.
 */
export interface AssociationEventFacts {
  /** The plant the event is about; also the tenant scope of the row. */
  churchId: string;
  /** The oversight org on the other side of the association. */
  orgType: AssociationOrgType;
  orgId: string;
  /** Which direction: the association was made, or it was severed. */
  event: AssociationEventType;
  /**
   * The invitation responsible, when one is. Omitted for every sever (#277/#278
   * answer no invitation) and for an association that predates the invitation
   * system — see the column's doc comment; null is a fact there, not a gap.
   */
  sourceInvitationId?: string | null;
}

/**
 * The INSERT, built but not executed — so the caller can batch it with the write
 * it audits and have both commit or neither (`memory/invariants.md` →
 * Transactions / Atomicity).
 *
 * Exported for that reason and for one more: a test can read the bound
 * parameters off the generated SQL and assert that `actor_user_id` carries the
 * ACTOR's id and not anything a caller supplied.
 *
 * `returning()` so a batching caller can tell "wrote the audit row" from
 * "matched nothing" — an INSERT with no conflict clause always writes, but the
 * shape is what lets a future guarded variant stay a drop-in.
 */
export function associationEventStatement(
  actor: InvitationActor,
  facts: AssociationEventFacts
) {
  return db
    .insert(associationEvents)
    .values({
      churchId: facts.churchId,
      orgType: facts.orgType,
      orgId: facts.orgId,
      event: facts.event,
      // The SESSION's user. There is no parameter for a client value to land in:
      // `InvitationActor` is branded and only `invitationActorFromSession` mints
      // one.
      actorUserId: actor.id,
      sourceInvitationId: facts.sourceInvitationId ?? null,
    })
    .returning();
}

/**
 * Write one association event.
 *
 * Use `associationEventStatement` instead wherever the audited write is a
 * statement you can batch this with; this runs on its own, so a crash between
 * the audited write and this call loses the audit row. That is acceptable only
 * where there is nothing to batch with.
 *
 * Never takes a user id. The actor is minted from the session by the caller
 * (`invitationActorFromSession(await verifySession())`) and its `id` is read
 * here, so an audit row cannot be attributed to somebody the request named.
 */
export async function recordAssociationEvent(
  actor: InvitationActor,
  facts: AssociationEventFacts
): Promise<AssociationEvent> {
  const [row] = await associationEventStatement(actor, facts);
  return row;
}

/**
 * The `org_type` / `org_id` pair for an association, derived from the two
 * oversight FKs an invitation (or a church row) carries. Exists so the accept
 * path and both sever paths cannot disagree about which org an event names.
 *
 * `null` for anything that is not EXACTLY ONE org, and both halves of that
 * matter:
 *
 *   * NEITHER set — there is no association to audit, and a helper that guessed
 *     `sending_church` for a missing id would write a row pointing at nothing.
 *   * BOTH set — genuinely reachable, not a theoretical: `associationStatement`
 *     in `./core` sets one of a plant's two oversight FKs without clearing the
 *     other, so a plant can belong to a sending church AND a network at once.
 *     Which of the two an event is about is then a fact only the caller has, and
 *     a precedence rule here would quietly attribute a sever to the wrong org.
 *     A sever passes the ONE FK it is severing.
 *
 * Pure, so both refusals are unit-testable without a database.
 */
export function associationOrg(org: {
  sendingChurchId?: string | null;
  sendingNetworkId?: string | null;
}): { orgType: AssociationOrgType; orgId: string } | null {
  if (org.sendingChurchId && org.sendingNetworkId) return null;
  if (org.sendingChurchId) {
    return { orgType: "sending_church", orgId: org.sendingChurchId };
  }
  if (org.sendingNetworkId) {
    return { orgType: "network", orgId: org.sendingNetworkId };
  }
  return null;
}
