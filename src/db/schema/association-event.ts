import { sql, type SQL } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { organizationInvitations } from "./organization-invitation";
import { sendingChurches } from "./sending-church";
import { users } from "./user";

// ============================================================================
// association_events — the append-only audit of an oversight association
// (OV-008; FRD `product-docs/features/oversight/frd.md`).
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
//
// THE SUBJECT IS NO LONGER ALWAYS A PLANT (#304 WS3, ruling #351, migration
// 0035). Until 0035 the subject was `church_id`, NOT NULL, and the third
// invitation type — a sending church joining a network — therefore had nowhere
// to be filed: it wrote no audit row at all, which is the debt `#351` was raised
// to settle. #351 ruled for the shape this table's own header had asked for: a
// SUBJECT DISCRIMINATOR plus one nullable FK per subject kind, and a CHECK that
// exactly one of them is set. `church_id` is now nullable because it is one of
// two subject columns, NOT because a null there means "global" — that reading
// belongs to feature tables (`memory/contracts/db.md`), and the CHECK is what
// keeps it from ever meaning it here: a row with no subject at all cannot be
// written.
// ============================================================================

/**
 * WHICH KIND of oversight org the event is about. There are two, and they are
 * the two nullable oversight FKs a subject can carry: a plant belongs to a
 * sending church, to a network directly, or to neither; a sending church belongs
 * to a network or to nothing.
 *
 * Note this is NOT `organizationInvitationTypes` narrowed. That enum describes
 * an INVITATION (`church_to_network`); this one describes the ORG on the other
 * side of an association, and `subjectType` below says which kind of thing is on
 * this side.
 */
export const associationOrgTypes = ["sending_church", "network"] as const;
export type AssociationOrgType = (typeof associationOrgTypes)[number];

/**
 * WHOSE association it is — the discriminator #351 ruled for (2026-08-09).
 *
 * Two values, and they are the two things in this product that can hold an
 * oversight association of their own:
 *
 *   * `church`         a church plant, filed under `church_id`. Its org is a
 *                      sending church OR a network (both FKs on `churches` are
 *                      independent — `memory/invariants.md` → Multi-Tenancy);
 *   * `sending_church` a sending church, filed under `subject_sending_church_id`.
 *                      Its org is always a network.
 *
 * A DISCRIMINATOR PLUS PER-SUBJECT FKs, not a second polymorphic pair. `org_id`
 * below is deliberately FK-less because an audit row must outlive the org it
 * names; the SUBJECT is the row's tenancy anchor, which every reader scopes on,
 * so it keeps referential integrity and gets a column of its own per kind. The
 * CHECK that exactly one is set is what makes "every row has exactly one
 * subject" a property of the data rather than of the writer.
 */
export const associationSubjectTypes = ["church", "sending_church"] as const;
export type AssociationSubjectType = (typeof associationSubjectTypes)[number];

/**
 * WHAT happened. Both directions are recorded, not just severs: an audit that
 * logged only departures cannot tell "never associated" from "joined and left".
 */
export const associationEventTypes = ["associated", "disassociated"] as const;
export type AssociationEventType = (typeof associationEventTypes)[number];

/** `'a', 'b'` — the CHECK's value list, built from the tuples above so the two cannot drift. */
function inList(values: readonly string[]): SQL {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

export const associationEvents = pgTable(
  "association_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * WHICH KIND of thing joined or left — the discriminator, and the column
     * every reader branches on before it trusts either subject FK.
     *
     * Defaulted to `'church'` in the DATABASE as well as here, because that is
     * what every row written before migration 0035 is, and because a raw INSERT
     * that names a subject FK but forgets this column must fail the CHECK rather
     * than silently file itself under the wrong kind — which is exactly what the
     * default plus the CHECK together produce.
     */
    subjectType: varchar("subject_type", { length: 20 })
      .$type<AssociationSubjectType>()
      .notNull()
      .default("church"),
    /**
     * The CHURCH subject: WHICH PLANT joined or left.
     *
     * Nullable since 0035 — not because a null means "global content" (the
     * repo-wide reading of a null `church_id` on a FEATURE table), but because
     * this is one of two subject columns and the CHECK below permits a null here
     * only when `subject_sending_church_id` carries the subject instead. There
     * is no row in this table without a subject.
     */
    churchId: uuid("church_id").references(() => churches.id),
    /**
     * The SENDING CHURCH subject: which sending church joined or left a network
     * (#304 WS3 / OV-013).
     *
     * The counterpart to `church_id`, under the same CHECK. A real FK, unlike
     * `org_id`: the subject is the row's tenancy anchor and the thing its one
     * reader scopes on, so it is worth referential integrity — whereas the ORG
     * side must survive its referent.
     */
    subjectSendingChurchId: uuid("subject_sending_church_id").references(
      () => sendingChurches.id
    ),
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
    // The same read for a SENDING CHURCH subject: its own association history
    // with a network (#304 WS3 / OV-013), newest first.
    index("association_events_subject_sending_church_idx").on(
      table.subjectSendingChurchId,
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
    check(
      "association_events_subject_type_check",
      sql`${table.subjectType} in (${inList(associationSubjectTypes)})`
    ),
    // EXACTLY ONE SUBJECT, in the data (#351). Both halves are load-bearing:
    // the discriminator has to agree with which column is populated, and the
    // OTHER column has to be null — a row carrying both would be two audits
    // wearing one id, and its one reader (`associationHistoryQuery`) would
    // return it to both tenants.
    check(
      "association_events_subject_check",
      sql`(
        (${table.subjectType} = 'church'
          and ${table.churchId} is not null
          and ${table.subjectSendingChurchId} is null)
        or
        (${table.subjectType} = 'sending_church'
          and ${table.subjectSendingChurchId} is not null
          and ${table.churchId} is null)
      )`
    ),
  ]
);

export type AssociationEvent = typeof associationEvents.$inferSelect;
export type NewAssociationEvent = typeof associationEvents.$inferInsert;
