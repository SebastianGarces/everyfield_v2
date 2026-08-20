import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { churches } from "./church";
import { sendingChurches } from "./sending-church";
import { sendingNetworks } from "./sending-network";
import { inList } from "./sql";
import { users } from "./user";

// ============================================================================
// `user_invitations` — ONE table for both invitations INTO AN ACCOUNT (AS-010 /
// AS-011, #495).
//
// NOT `organization_invitations`, and the difference is what each one creates.
// An organization invitation binds one ORG to another and never makes an
// account; this one hands a PERSON a seat in a tenancy, or a coach an
// assignment, and the row is answered by registering. Two tables because the
// two have different subjects, different answers and different surfaces —
// merging them would put a nullable target-church FK beside a nullable seat and
// make "which kind of thing is this row" a question nothing could answer.
//
// ONE table for the two KINDS, though, because everything except `seat` is the
// same shape: an address, an inviting tenancy, a hashed token, a status, an
// expiry. `kind` is the discriminator and the CHECK below is what stops the two
// shapes mixing.
//
// THREE INVARIANTS ARE IN THE DATABASE, not in a comment:
//
//   1. EXACTLY ONE TENANCY. `church_id` / `sending_church_id` /
//      `sending_network_id` — the same exactly-one shape `association_events`
//      carries since 0036, and for the same reason: a row naming two tenancies
//      is a row two orgs can both claim, and the application layer is the only
//      isolation this product has (`memory/invariants.md` → Multi-Tenancy).
//   2. `kind = 'seat'` ⟺ `seat IS NOT NULL`. A seat invitation that grants no
//      seat is unanswerable; a coach invitation carrying one would grant a seat
//      through a path that is not registration or seat management (AS-012).
//   3. THE TOKEN IS NEVER STORED. `token_hash` holds sha256 of the token that
//      went out in the email, so a database read hands nobody a working invite
//      link. The unique index on it is what makes the lookup a point read.
//
// `seat` NEVER HOLDS `owner`. The Owner seat is the account that created the
// tenancy (registration) or the one the OB-010 claim granted; it is not
// invitable, and `users_church_owner_unique_idx` would refuse a second one
// anyway. The CHECK names `admin` and `member` explicitly rather than deferring
// to `users_seat_check`, so the narrower vocabulary is stated where it is true.
// ============================================================================

/** What the invitation makes the invitee: a seat holder, or a coach. */
export const userInvitationKinds = ["seat", "coach"] as const;
export type UserInvitationKind = (typeof userInvitationKinds)[number];

/**
 * The seats an invitation may grant. `owner` is deliberately absent — see the
 * header.
 */
export const invitableSeats = ["admin", "member"] as const;
export type InvitableSeat = (typeof invitableSeats)[number];

/**
 * No `declined`. A seat invitation is REGISTER-ONLY (AS-010): the only person
 * who can answer it has no account yet, so there is no in-product surface to
 * decline from and an unwanted invitation is simply left to expire. The
 * inviting side closes one with `revoked`.
 */
export const userInvitationStatuses = [
  "pending",
  "accepted",
  "expired",
  "revoked",
] as const;
export type UserInvitationStatus = (typeof userInvitationStatuses)[number];

export const userInvitations = pgTable(
  "user_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: varchar("kind", { length: 20 }).$type<UserInvitationKind>().notNull(),
    /** The address the inviter typed, normalised the way `users.email` is stored. */
    inviteeEmail: varchar("invitee_email", { length: 255 }).notNull(),
    // The INVITING tenancy — exactly one, by the CHECK below. It is also the
    // tenancy a `seat` invitation grants, so there is no second "target" column
    // for the two to disagree about.
    churchId: uuid("church_id").references(() => churches.id),
    sendingChurchId: uuid("sending_church_id").references(
      () => sendingChurches.id
    ),
    sendingNetworkId: uuid("sending_network_id").references(
      () => sendingNetworks.id
    ),
    seat: varchar("seat", { length: 20 }).$type<InvitableSeat>(),
    /** sha256 of the token the email carried. The token itself is never stored. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    inviterUserId: uuid("inviter_user_id")
      .references(() => users.id)
      .notNull(),
    status: varchar("status", { length: 20 })
      .$type<UserInvitationStatus>()
      .notNull()
      .default("pending"),
    /** The account registration created, once this row is accepted. */
    respondedBy: uuid("responded_by").references(() => users.id),
    respondedAt: timestamp("responded_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /**
     * NOT NULL, unlike the org table's. That column is nullable only because
     * rows predate the window; this table starts with `INVITATION_EXPIRY_DAYS`
     * applied by its one writer, so a row with no expiry is a defect rather
     * than history and the column says so.
     */
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [
    // The three vocabularies, IN THE DATA. `.$type<>()` on a varchar is a
    // compile-time brand and nothing else — the same reasoning `users_seat_check`
    // and the `association_events` unions apply.
    check(
      "user_invitations_kind_check",
      sql`${table.kind} in (${inList(userInvitationKinds)})`
    ),
    check(
      "user_invitations_status_check",
      sql`${table.status} in (${inList(userInvitationStatuses)})`
    ),
    // INVARIANT 1 — exactly one inviting tenancy. `num_nonnulls` is the whole
    // rule in one expression; the or-of-three-arms spelling `association_events`
    // uses is only needed there because a discriminator column has to agree with
    // the FK, and this table's discriminator (`kind`) says nothing about which
    // tenancy invited.
    check(
      "user_invitations_tenancy_check",
      sql`num_nonnulls(${table.churchId}, ${table.sendingChurchId}, ${table.sendingNetworkId}) = 1`
    ),
    // INVARIANT 2 — `kind = 'seat'` ⟺ a seat, and it is the narrow vocabulary.
    //
    // WRITTEN AS A BICONDITIONAL, NOT AS TWO ARMS, BECAUSE `NULL` PASSES A
    // CHECK. The obvious spelling —
    //
    //   (kind = 'seat' and seat in ('admin','member'))
    //     or (kind = 'coach' and seat is null)
    //
    // — admits exactly the row it exists to refuse. For `kind = 'seat',
    // seat = NULL` the first arm is `true and NULL` = `NULL`, the second is
    // `false`, and `NULL or false` is `NULL`. A CHECK constraint fails only on
    // `false`: an `UNKNOWN` result is ACCEPTED (SQL:2011 §11.9). So the
    // unanswerable invitation the constraint is named after was writable, and
    // the DDL read as though it were not. Proven on a scratch Postgres:
    // `INSERT 0 1`.
    //
    // `(kind = 'seat') = (seat is not null)` is two-valued by construction —
    // both sides are non-null booleans, so their equality is never UNKNOWN —
    // and it states the ⟺ the FRD asks for as one expression rather than as a
    // pair of arms whose gap is invisible. The vocabulary then rides alongside,
    // guarded by `seat is null or …` so it says nothing when there is no seat.
    check(
      "user_invitations_seat_check",
      sql`(${table.kind} = 'seat') = (${table.seat} is not null) and (${table.seat} is null or ${table.seat} in (${inList(invitableSeats)}))`
    ),
    // INVARIANT 3's other half: the token lookup is a point read, and two rows
    // can never carry one token.
    uniqueIndex("user_invitations_token_hash_unique_idx").on(table.tokenHash),
    // The pending list is read by TENANCY, exactly as the org list is read by
    // inviting org.
    index("user_invitations_church_idx").on(table.churchId, table.status),
    index("user_invitations_sending_church_idx").on(
      table.sendingChurchId,
      table.status
    ),
    index("user_invitations_sending_network_idx").on(
      table.sendingNetworkId,
      table.status
    ),
    // The cap counts every row one tenancy addressed to one address, whatever
    // its status (`assertSeatInviteRateLimit`).
    index("user_invitations_invitee_email_idx").on(table.inviteeEmail),
  ]
);

export type UserInvitation = typeof userInvitations.$inferSelect;
export type NewUserInvitation = typeof userInvitations.$inferInsert;
