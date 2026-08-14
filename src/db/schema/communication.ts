import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
  // COM-020. An entry the app RECORDED rather than sent — today, a person-
  // related task the planter completed (`src/lib/communication/log.ts`). It is
  // a terminal state with no delivery behind it, which is what tells a logged
  // contact apart from a sent email everywhere the log is read.
  "logged",
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
//
// #407 D1 — a church has at most ONE fork of any given system template, and the
// DATABASE is what says so (`message_templates_church_fork_unique_idx`,
// migration 0038).
//
// WHY. Copy-on-write forking is reachable from two places — `forkTemplate` and
// `updateTemplate`'s system branch, which calls it — and both used to be
// guarded by a read ("does a fork already exist?") in front of an unconditional
// INSERT. `memory/invariants.md` → Transactions names that shape exactly:
// SELECT-then-INSERT is not a concurrency guard. Two edits of one system
// template a few milliseconds apart both passed the read, and the church woke
// up with two forks of the same original — after which `getTemplates()` hides
// the system row and renders BOTH forks, so the planter sees the template they
// just edited twice and cannot tell which one their next edit will land on.
//
// WHY PARTIAL, ON `source_template_id IS NOT NULL`. A church's own templates
// carry no source, and two of them may legitimately share a name and a
// category. The predicate keeps the constraint where the invariant holds — on
// the forks — and off rows it was never about.
//
// `church_id` IS NULLABLE HERE and that is the index's one gap: NULLs never
// collide in a btree unique index, so a row with a source but no church is
// unconstrained. Nothing writes that shape (a fork is a church's copy by
// definition, and a system template has no source), and the alternative — a
// `coalesce` expression index — would make the ON CONFLICT target unspellable.
//
// The insert that speaks for this index carries `ON CONFLICT … DO NOTHING`
// with the SAME predicate — see `forkTemplate`. The two change together: a
// mismatch is not subtle, it is "there is no unique or exclusion constraint
// matching the ON CONFLICT specification" on every fork.
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
    sourceTemplateId: uuid("source_template_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("message_templates_church_id_idx").on(table.churchId),
    index("message_templates_category_idx").on(table.category),
    index("message_templates_is_system_idx").on(table.isSystem),
    // The rule: one fork of a system template per church, ever.
    uniqueIndex("message_templates_church_fork_unique_idx")
      .on(table.churchId, table.sourceTemplateId)
      .where(sql`${table.sourceTemplateId} is not null`),
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
//
// #407 D2 — a (meeting, person) pair has at most ONE token awaiting an answer,
// and the DATABASE is what says so
// (`meeting_confirm_tokens_pending_unique_idx`, migration 0038).
//
// WHY. `createConfirmationToken` read "is there a pending token for this pair?"
// and inserted one when the answer was no — the SELECT-then-INSERT shape
// `memory/invariants.md` → Transactions refuses. `sendCommunication` calls it
// once per recipient, so two sends of the same meeting invitation (a resend, a
// double-submitted compose form) each minted a token for every person, and the
// planter's tracking then showed two unanswered RSVPs for one invitee. The
// EXPIRY path made it reachable without any race at all: an expired pending row
// failed the freshness test, so the service inserted a SECOND pending row and
// left the first one standing.
//
// WHY PARTIAL, ON `status = 'pending'`. Answered tokens are history — a person
// invited to the same meeting twice over may legitimately hold a `confirmed`
// row and a `declined` one — and only the unanswered slot is single. That is
// also what lets an answered row make room for a fresh invitation without
// anything being deleted.
//
// The insert that speaks for this index carries `ON CONFLICT` with the SAME
// predicate — see `createConfirmationToken`, which renews an EXPIRED pending row
// in place rather than adding a second, and re-reads the live one otherwise.
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
    // The rule: one UNANSWERED token per (meeting, person).
    uniqueIndex("meeting_confirm_tokens_pending_unique_idx")
      .on(table.meetingId, table.personId)
      .where(sql`${table.status} = 'pending'`),
  ]
);

export type MeetingConfirmationToken =
  typeof meetingConfirmationTokens.$inferSelect;
export type NewMeetingConfirmationToken =
  typeof meetingConfirmationTokens.$inferInsert;
