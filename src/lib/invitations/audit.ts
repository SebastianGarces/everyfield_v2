// ============================================================================
// The association audit — OV-008's write side (issue #303).
//
// One table (`association_events`, `src/db/schema/association-event.ts`), one
// writer, and it only ever INSERTs. The contract it exists to serve: every
// association write (an accepted invitation) and every sever (#277
// planter-side, #278 org-side) is to record a row here, so that "which org was
// this plant with, who put them there, who took them out, and when" survives
// the sever that nulls `churches.sending_church_id` / `sending_network_id`.
//
// #304 WIRED THE PLANTER SIDE OF THAT CONTRACT. `acceptInvitationAs` now batches
// `associationEventStatement` with the association it audits, and the planter's
// sever goes through `severAssociationWithAuditStatement` below — one statement
// that nulls the FK and writes the row, so neither can happen without the other.
// The org-side sever (#278/WS2) is the remaining caller.
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

import { sql } from "drizzle-orm";

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
 * Which column on `churches` holds an association with this KIND of org. The
 * two identifiers are derived from a closed union, never from input — the only
 * callers are the two statement builders below.
 */
const OVERSIGHT_FK_COLUMN: Record<AssociationOrgType, string> = {
  sending_church: "sending_church_id",
  network: "sending_network_id",
};

/**
 * THE ACCEPT'S AUDIT ROW (#304, OV-008) — the fourth statement of the accept
 * batch in `./core` → `acceptInvitationAs`, and deliberately not a fifth
 * concern of the three that were already there.
 *
 * `associationEventStatement` above cannot be dropped into that batch as it
 * stands: an unguarded INSERT writes whatever happens to the three statements it
 * travels with, and an empty `returning()` is not an error and rolls a batch
 * back (`memory/invariants.md` → Transactions / Atomicity). A lost claim or an
 * occupied slot would therefore have committed an audit row asserting an
 * association that was never made.
 *
 * So the row is an `INSERT ... SELECT` whose WHERE re-asserts, inside the same
 * transaction, exactly what the two writes before it must have done:
 *
 *   * `churches.<fk> = <org>` — the association statement applied (or the plant
 *     already held this org, which is the idempotent re-bind the replay path
 *     depends on). An accept refused by the slot rule fails here and writes
 *     nothing;
 *   * `EXISTS (… invitation … status = 'accepted')` — the same predicate
 *     `associationStatement` carries. Only the claim batched ahead of this can
 *     have written that value for a genuinely first acceptance;
 *   * `NOT EXISTS (… an 'associated' row for this invitation)` — an append-only
 *     audit must not gain a second row when the accept is retried against an
 *     invitation that already reads `accepted` (the claim loses, but the two
 *     predicates above are both still true). This is what makes the whole
 *     statement idempotent per invitation.
 *
 * `null` for `sending_church_to_network`: `association_events.church_id` is not
 * nullable and its subject is a CHURCH, so a sending church joining a network is
 * deliberately not recorded here (see the table's own header). The caller simply
 * batches one statement fewer.
 */
export function acceptedAssociationEventStatement(
  actor: InvitationActor,
  facts: {
    churchId: string;
    orgType: AssociationOrgType;
    orgId: string;
    invitationId: string;
  }
) {
  const fk = sql.raw(OVERSIGHT_FK_COLUMN[facts.orgType]);

  return db.execute<{ id: string }>(sql`
    insert into "association_events"
      ("church_id", "org_type", "org_id", "event", "actor_user_id", "source_invitation_id")
    select "churches"."id",
           ${facts.orgType}::varchar,
           ${facts.orgId}::uuid,
           'associated'::varchar,
           ${actor.id}::uuid,
           ${facts.invitationId}::uuid
      from "churches"
     where "churches"."id" = ${facts.churchId}::uuid
       and "churches".${fk} = ${facts.orgId}::uuid
       and exists (
         select 1 from "organization_invitations" oi
          where oi."id" = ${facts.invitationId}::uuid
            and oi."status" = 'accepted'
       )
       and not exists (
         select 1 from "association_events" ae
          where ae."source_invitation_id" = ${facts.invitationId}::uuid
            and ae."event" = 'associated'
       )
    returning "id"
  `);
}

/**
 * THE SEVER (#304, OV-007) — null the plant's oversight FK and write the audit
 * row that records it, as ONE statement.
 *
 * ----------------------------------------------------------------------------
 * Why raw SQL, and why not `db.batch`
 * ----------------------------------------------------------------------------
 *
 * The two writes have to be all-or-nothing (`memory/invariants.md` →
 * Transactions / Atomicity) AND the second must happen only if the first
 * actually matched. A batch gives the first and not the second: an UPDATE that
 * matches no row is not an error, does not roll a batch back, and would leave
 * an audit row asserting a sever that never happened — the exact inverse of
 * what an audit is for. There is no `EXISTS` the INSERT could carry instead,
 * either: the accept path can guard its association on "the invitation now
 * reads accepted" because the claim WROTE that fact, whereas a sever's only
 * fact is a column that is now null — indistinguishable from a plant that was
 * never associated, which is precisely the case that must write nothing.
 *
 * So the INSERT selects FROM the UPDATE's `RETURNING`. The audit row is written
 * once per row the sever actually touched: one if it severed, none if the
 * guard below refused. `memory/invariants.md` calls for exactly this shape — the
 * dependent write must be a DEPENDENCY of the CTE, not a sibling that merely
 * joins it, or it is pulled lazily and silently writes nothing.
 *
 * ----------------------------------------------------------------------------
 * The tenancy assertion (#304's high-risk extra)
 * ----------------------------------------------------------------------------
 *
 * `where id = <church> and <fk> = <org>` — the FK is nulled only if it still
 * points at the org being left. That is what makes the sever safe against the
 * two things a bare `set fk = null where id = ?` (the shape the `disassociate*`
 * primitives still have) cannot survive:
 *
 *   * a caller aiming at an org the plant does not belong to — nothing matches,
 *     nothing is written, and the action reports the refusal;
 *   * a plant that belongs to a sending church AND a network — only the named
 *     one is severed, and the other FK is not mentioned in the statement at
 *     all.
 *
 * The identifiers interpolated with `sql.raw` come from `OVERSIGHT_FK_COLUMN`,
 * keyed by a closed union; every VALUE is a bound parameter with an explicit
 * cast, so nothing a request carried is ever spliced into the text.
 */
export async function severAssociationWithAuditStatement(
  actor: InvitationActor,
  facts: {
    churchId: string;
    orgType: AssociationOrgType;
    orgId: string;
  }
): Promise<{ id: string } | null> {
  const fk = sql.raw(OVERSIGHT_FK_COLUMN[facts.orgType]);

  const result = await db.execute<{ id: string }>(sql`
    with severed as (
      update "churches"
         set ${fk} = null,
             "updated_at" = now()
       where "id" = ${facts.churchId}::uuid
         and ${fk} = ${facts.orgId}::uuid
      returning "id"
    )
    insert into "association_events"
      ("church_id", "org_type", "org_id", "event", "actor_user_id")
    select severed."id",
           ${facts.orgType}::varchar,
           ${facts.orgId}::uuid,
           'disassociated'::varchar,
           ${actor.id}::uuid
      from severed
    returning "id"
  `);

  return result.rows[0] ?? null;
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
