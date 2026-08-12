import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { inList } from "./sql";
import { organizationInvitations } from "./organization-invitation";
import { users } from "./user";

// ============================================================================
// association_events — the append-only audit of a plant's oversight
// association (OV-008; FRD `product-docs/features/oversight/frd.md`).
//
// WHY IT EXISTS. Until #274 there was exactly one way a plant became associated
// with an oversight org (accepting an invitation) and NO way to leave one, so
// `churches.sending_church_id` / `sending_network_id` — a single mutable FK —
// was the whole history. #274 ruled that both sides may sever (#277 planter,
// #278 org admin), which turns that FK into *current state* and nothing more:
// once a sever can null it, "was this plant ever ours, who joined them, who
// removed them, and when" is unanswerable from the churches row. So every
// association write (accept) and every sever writes a row here as well.
//
// APPEND-ONLY, AND THAT IS THE POINT. There is deliberately no `updated_at`, no
// soft-delete column and no update path: an audit row that can be edited by the
// code being audited records nothing. `src/lib/invitations/audit.ts` is the only
// writer and only ever INSERTs. That is enforced by the code, not by the
// database — a rule/trigger blocking UPDATE/DELETE would make it structural and
// is deliberately NOT in this expand-only migration, since it has to be reasoned
// about alongside an eventual retention story rather than smuggled in here.
// ============================================================================

/**
 * WHICH KIND of oversight org the event is about. There are two, and they are
 * the two nullable oversight FKs on `churches`: a plant belongs to a sending
 * church, to a network directly, or to neither.
 *
 * Note this is NOT `organizationInvitationTypes` narrowed. That enum describes
 * an INVITATION (`church_to_network`), and it has a third arm — a sending church
 * joining a network — which this table does not record, because its subject is a
 * CHURCH (`church_id` below is not nullable). If a sending church's own network
 * membership ever needs auditing it gets a subject column and a ruling, not a
 * nullable `church_id` here: a null `church_id` already means "global content"
 * everywhere else in this schema (`memory/contracts/db.md`).
 */
export const associationOrgTypes = ["sending_church", "network"] as const;
export type AssociationOrgType = (typeof associationOrgTypes)[number];

/**
 * WHAT happened. Both directions are recorded, not just severs: an audit that
 * logged only departures cannot tell "never associated" from "joined and left".
 */
export const associationEventTypes = ["associated", "disassociated"] as const;
export type AssociationEventType = (typeof associationEventTypes)[number];

export const associationEvents = pgTable(
  "association_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The tenant scope, and the subject of the event: WHICH PLANT joined or
     * left. Not nullable — see `associationOrgTypes` for why a sending church's
     * own network membership is not squeezed in here.
     */
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    /**
     * The other side of the association, as a discriminated pair.
     *
     * `org_id` carries NO foreign key, deliberately: it points at
     * `sending_churches` or at `sending_networks` depending on `org_type`, and
     * Postgres has no polymorphic FK. The alternative — two nullable FK columns
     * plus a CHECK that exactly one is set, the shape
     * `organization_invitations` uses — buys referential integrity at the cost
     * of every reader coalescing two columns, and an AUDIT row has to survive
     * its referent anyway: an org deleted tomorrow must not take the record of
     * what it did today with it. The CHECK on `org_type` is the integrity this
     * pair gets; the id is resolved by the reader (OV-011).
     */
    orgType: varchar("org_type", { length: 20 })
      .$type<AssociationOrgType>()
      .notNull(),
    orgId: uuid("org_id").notNull(),
    event: varchar("event", { length: 20 })
      .$type<AssociationEventType>()
      .notNull(),
    /**
     * WHO did it — the session's user, never a value that arrived from a
     * client. `recordAssociationEvent` takes a branded actor for exactly this
     * reason (`src/lib/invitations/audit.ts`); an audit row whose actor the
     * caller could name is a forgery surface, not an audit.
     *
     * Not null: every path that writes here has an authenticated actor. A
     * future system-initiated sever (expiry, admin tooling) needs a ruling on
     * how it is attributed, not a null.
     */
    actorUserId: uuid("actor_user_id")
      .references(() => users.id)
      .notNull(),
    /**
     * The invitation this event came from, when there was one.
     *
     * NULLABLE on purpose, and not merely for old rows: a DISASSOCIATION has no
     * invitation behind it at all (#277/#278 sever an association, they do not
     * answer an invitation), and an association may predate the invitation
     * system or come from seeding. So null reads as "no invitation is
     * responsible for this event" — a fact, not a gap.
     *
     * ONE TRAP, for whoever writes the next migration on this table: the FK
     * drizzle names `association_events_source_invitation_id_organization_invitations_id_fk`
     * is 66 characters, so Postgres TRUNCATED it to 63 on the way in —
     * `…_organization_invitation` — and said so as a NOTICE while 0031 applied.
     * The name in the DB is therefore not the name in the snapshot. Anything
     * that has to DROP or rename this constraint must use the truncated name (or
     * look it up in `pg_constraint`); drizzle's own diff never does, which is why
     * `db:generate` reports no drift.
     */
    sourceInvitationId: uuid("source_invitation_id").references(
      () => organizationInvitations.id
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // OV-011's read: one plant's association history, newest first.
    index("association_events_church_id_created_at_idx").on(
      table.churchId,
      table.createdAt
    ),
    // The org-side read: everything that happened to one oversight org's
    // portfolio — who joined, who left.
    index("association_events_org_idx").on(table.orgType, table.orgId),
    // The enums, in the DATA. `.$type<>()` on a varchar is a compile-time brand
    // and nothing else — the same reasoning migration 0024 applied to the
    // notification tables, and the same premise `verifyInvitationAuthority` has
    // to fail closed on for `organization_invitations.type`.
    check(
      "association_events_org_type_check",
      sql`${table.orgType} in (${inList(associationOrgTypes)})`
    ),
    check(
      "association_events_event_check",
      sql`${table.event} in (${inList(associationEventTypes)})`
    ),
  ]
);

export type AssociationEvent = typeof associationEvents.$inferSelect;
export type NewAssociationEvent = typeof associationEvents.$inferInsert;
