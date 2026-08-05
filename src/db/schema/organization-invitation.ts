import { index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { churches } from "./church";
import { sendingChurches } from "./sending-church";
import { sendingNetworks } from "./sending-network";
import { users } from "./user";

export const organizationInvitationTypes = [
  "church_to_sending_church",
  "sending_church_to_network",
  "church_to_network",
] as const;
export type OrganizationInvitationType =
  (typeof organizationInvitationTypes)[number];

export const organizationInvitationStatuses = [
  "pending",
  "accepted",
  "declined",
  "expired",
  "revoked",
] as const;
export type OrganizationInvitationStatus =
  (typeof organizationInvitationStatuses)[number];

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: varchar("type", { length: 40 })
      .$type<OrganizationInvitationType>()
      .notNull(),
    inviterUserId: uuid("inviter_user_id")
      .references(() => users.id)
      .notNull(),
    // Who the invitation was addressed to (#23 / OV-003). An oversight admin
    // invites an EMAIL — they have no directory of church plants to pick from
    // and must not be given one, since that would list every plant in the
    // product to every org. The email is what the surface renders, what the
    // invite link is sent to, and the only thing the admin types.
    //
    // Nullable because rows predating #23 have none. The two target FKs below
    // stay nullable for a second reason: an invitation to somebody with no
    // account yet has no target row to point at until they register (see
    // `bindOpenInvitationTarget` in `src/lib/invitations/core.ts`).
    inviteeEmail: varchar("invitee_email", { length: 255 }),
    // Target entity being invited
    targetChurchId: uuid("target_church_id").references(() => churches.id),
    targetSendingChurchId: uuid("target_sending_church_id").references(
      () => sendingChurches.id
    ),
    // Inviting entity
    sendingChurchId: uuid("sending_church_id").references(
      () => sendingChurches.id
    ),
    sendingNetworkId: uuid("sending_network_id").references(
      () => sendingNetworks.id
    ),
    // Status tracking
    status: varchar("status", { length: 20 })
      .$type<OrganizationInvitationStatus>()
      .notNull()
      .default("pending"),
    respondedBy: uuid("responded_by").references(() => users.id),
    respondedAt: timestamp("responded_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
  },
  (table) => [
    index("org_invitations_target_church_id_idx").on(table.targetChurchId),
    index("org_invitations_target_sending_church_id_idx").on(
      table.targetSendingChurchId
    ),
    index("org_invitations_status_idx").on(table.status),
    index("org_invitations_inviter_user_id_idx").on(table.inviterUserId),
    // The invitations surface lists by INVITING org, not by inviter (#23): the
    // list is scoped to the caller's org so a second admin sees the same
    // pending queue, which is also what stops one org reading another's.
    index("org_invitations_sending_church_id_idx").on(table.sendingChurchId),
    index("org_invitations_sending_network_id_idx").on(table.sendingNetworkId),
  ]
);

export type OrganizationInvitation =
  typeof organizationInvitations.$inferSelect;
export type NewOrganizationInvitation =
  typeof organizationInvitations.$inferInsert;
