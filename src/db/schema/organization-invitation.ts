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
  ]
);

export type OrganizationInvitation =
  typeof organizationInvitations.$inferSelect;
export type NewOrganizationInvitation =
  typeof organizationInvitations.$inferInsert;
