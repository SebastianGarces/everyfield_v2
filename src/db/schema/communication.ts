import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { churchMeetings } from "./meetings";
import { persons } from "./people";
import { users } from "./user";

// ============================================================================
// Enums
// ============================================================================

export const communicationChannels = ["email", "sms", "both"] as const;
export type CommunicationChannel = (typeof communicationChannels)[number];

export const communicationStatuses = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
] as const;
export type CommunicationStatus = (typeof communicationStatuses)[number];

export const recipientStatuses = [
  "pending",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "failed",
] as const;
export type RecipientStatus = (typeof recipientStatuses)[number];

export const templateCategories = [
  "meeting_invitation",
  "meeting_reminder",
  "follow_up",
  "core_group",
  "team",
  "announcement",
  "launch",
  "other",
] as const;
export type TemplateCategory = (typeof templateCategories)[number];

export const confirmationStatuses = [
  "pending",
  "confirmed",
  "declined",
] as const;
export type ConfirmationStatus = (typeof confirmationStatuses)[number];

// ============================================================================
// Tables
// ============================================================================

// ----------------------------------------------------------------------------
// Message Templates - Reusable email/SMS templates
// ----------------------------------------------------------------------------
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id").references(() => churches.id),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 30 })
      .$type<TemplateCategory>()
      .notNull(),
    channel: varchar("channel", { length: 10 })
      .$type<CommunicationChannel>()
      .notNull()
      .default("email"),
    subject: varchar("subject", { length: 500 }),
    body: text("body").notNull(),
    bodyHtml: text("body_html"),
    mergeFields: jsonb("merge_fields").$type<string[]>(),
    isSystem: boolean("is_system").default(false).notNull(),
    sourceTemplateId: uuid("source_template_id").references(
      () => messageTemplates.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("message_templates_church_id_idx").on(table.churchId),
    index("message_templates_category_idx").on(table.category),
    index("message_templates_is_system_idx").on(table.isSystem),
  ]
);

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;

// ----------------------------------------------------------------------------
// Communications - Main message records
// ----------------------------------------------------------------------------
export const communications = pgTable(
  "communications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    subject: varchar("subject", { length: 500 }),
    body: text("body").notNull(),
    bodyHtml: text("body_html"),
    channel: varchar("channel", { length: 10 })
      .$type<CommunicationChannel>()
      .notNull()
      .default("email"),
    templateId: uuid("template_id").references(() => messageTemplates.id),
    meetingId: uuid("meeting_id").references(() => churchMeetings.id),
    status: varchar("status", { length: 20 })
      .$type<CommunicationStatus>()
      .notNull()
      .default("draft"),
    scheduledAt: timestamp("scheduled_at"),
    sentAt: timestamp("sent_at"),
    recipientCount: integer("recipient_count"),
    createdById: uuid("created_by_id")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("communications_church_id_idx").on(table.churchId),
    index("communications_status_idx").on(table.status),
    index("communications_meeting_id_idx").on(table.meetingId),
    index("communications_created_by_idx").on(table.createdById),
  ]
);

export type Communication = typeof communications.$inferSelect;
export type NewCommunication = typeof communications.$inferInsert;

// ----------------------------------------------------------------------------
// Communication Recipients - Per-recipient tracking
// ----------------------------------------------------------------------------
export const communicationRecipients = pgTable(
  "communication_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    communicationId: uuid("communication_id")
      .references(() => communications.id, { onDelete: "cascade" })
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    channel: varchar("channel", { length: 10 })
      .$type<CommunicationChannel>()
      .notNull()
      .default("email"),
    status: varchar("status", { length: 20 })
      .$type<RecipientStatus>()
      .notNull()
      .default("pending"),
    deliveredAt: timestamp("delivered_at"),
    openedAt: timestamp("opened_at"),
    clickedAt: timestamp("clicked_at"),
    externalId: varchar("external_id", { length: 255 }),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("comm_recipients_church_id_idx").on(table.churchId),
    index("comm_recipients_communication_id_idx").on(table.communicationId),
    index("comm_recipients_person_id_idx").on(table.personId),
    index("comm_recipients_external_id_idx").on(table.externalId),
    index("comm_recipients_status_idx").on(table.status),
  ]
);

export type CommunicationRecipient =
  typeof communicationRecipients.$inferSelect;
export type NewCommunicationRecipient =
  typeof communicationRecipients.$inferInsert;

// ----------------------------------------------------------------------------
// Meeting Confirmation Tokens - Token-based RSVP for meetings
// ----------------------------------------------------------------------------
export const meetingConfirmationTokens = pgTable(
  "meeting_confirmation_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    meetingId: uuid("meeting_id")
      .references(() => churchMeetings.id, { onDelete: "cascade" })
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    status: varchar("status", { length: 20 })
      .$type<ConfirmationStatus>()
      .notNull()
      .default("pending"),
    respondedAt: timestamp("responded_at"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("meeting_confirm_tokens_token_idx").on(table.token),
    index("meeting_confirm_tokens_meeting_id_idx").on(table.meetingId),
    index("meeting_confirm_tokens_person_id_idx").on(table.personId),
  ]
);

export type MeetingConfirmationToken =
  typeof meetingConfirmationTokens.$inferSelect;
export type NewMeetingConfirmationToken =
  typeof meetingConfirmationTokens.$inferInsert;
