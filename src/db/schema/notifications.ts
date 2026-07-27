import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { users } from "./user";

// ============================================================================
// F11 — Notifications (N-001, N-002, N-005, N-010).
//
// Three tables, and the split between them is load-bearing:
//
//   notifications          the queue row AND the in-app feed row — one record.
//                          Two tables would let the feed and the email disagree
//                          about what happened.
//   notification_prefs     one row per (user, category, channel). ABSENCE is
//                          meaningful: no row = the category's coded default,
//                          NOT "off". Nothing is ever seeded.
//   notification_deliveries one row per channel, holding the attempt history.
//                          Its unique (notification_id, channel) index is what
//                          makes at-most-once delivery (N-004) a database
//                          guarantee rather than an application intention.
//
// The enum tuples live here, alongside every other schema enum in this repo.
// `src/lib/notifications/categories.ts` re-exports them and owns the semantics
// (coded defaults, labels), so a caller never has to import from `@/db` to
// enqueue.
// ============================================================================

// ============================================================================
// Enums
// ============================================================================

/**
 * The fixed, code-defined category set. The category is the unit of user
 * preference — a user turns off "meeting reminders", not "the 3-day offset of a
 * Vision Meeting". Adding one is a code change plus a coded default; it is
 * deliberately NOT a schema change and needs no backfill.
 */
export const notificationCategories = [
  "tasks",
  "meetings",
  "communication",
  "teams",
  "phase",
  "digest",
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

/** Channels shipping in v1. SMS and web push are N-021 / N-022 (Nice to Have). */
export const notificationChannels = ["email", "in_app"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

/**
 * Lifecycle of the queue row.
 * - `pending`   enqueued, not yet claimed by a dispatcher run.
 * - `claimed`   a dispatcher run owns it (so a concurrent run cannot take it).
 * - `delivered` every enabled channel reached a terminal non-failed outcome.
 * - `cancelled` the subject went away (cancel-by-entity, N-011).
 * - `failed`    every channel exhausted its bounded retries (N-015).
 */
export const notificationStatuses = [
  "pending",
  "claimed",
  "delivered",
  "cancelled",
  "failed",
] as const;
export type NotificationStatus = (typeof notificationStatuses)[number];

/**
 * Per-channel outcome (N-016). `suppressed_by_preference` exists so an opt-out
 * is visible in the delivery log rather than being a silent no-op.
 */
export const notificationDeliveryStatuses = [
  "queued",
  "sent",
  "failed",
  "suppressed_by_preference",
  "cancelled",
] as const;
export type NotificationDeliveryStatus =
  (typeof notificationDeliveryStatuses)[number];

/** Cadence of the recurring roll-up (N-013). Only meaningful on `digest`. */
export const digestCadences = ["daily", "weekly"] as const;
export type DigestCadence = (typeof digestCadences)[number];

// ============================================================================
// Tables
// ============================================================================

// ----------------------------------------------------------------------------
// notifications — the queue row and the feed row, one record.
// ----------------------------------------------------------------------------
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenancy boundary. EVERY read filters on it (N-010). */
    churchId: uuid("church_id")
      .references(() => churches.id, { onDelete: "cascade" })
      .notNull(),
    /** Addressed to a user, never a bare email address. */
    recipientUserId: uuid("recipient_user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    category: varchar("category", { length: 20 })
      .$type<NotificationCategory>()
      .notNull(),
    /** Caller-defined discriminator within a category (`task.overdue`, ...). */
    type: varchar("type", { length: 64 }).notNull(),
    /** Rendered by the caller. F11 stores copy, it never templates it. */
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    /** What it is about — powers cancel-by-entity and the feed's link target. */
    entityType: varchar("entity_type", { length: 32 }),
    entityId: uuid("entity_id"),
    /** Caller-supplied idempotency key (unique per church, see index below). */
    dedupeKey: varchar("dedupe_key", { length: 255 }),
    /** When it becomes eligible for dispatch. Defaults to now. */
    scheduledFor: timestamp("scheduled_for").defaultNow().notNull(),
    status: varchar("status", { length: 20 })
      .$type<NotificationStatus>()
      .notNull()
      .default("pending"),
    /** Null until read in-app. Independent of delivery. */
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Idempotency (N-001). Partial, because most notifications carry no key and
    // NULLs would not collide anyway — the predicate keeps the index small and
    // states the intent. This is the concurrency guard: two simultaneous
    // enqueues with the same key race into the same INSERT, and the loser is
    // absorbed by ON CONFLICT DO NOTHING rather than by a SELECT that both
    // requests would have passed (see memory/invariants.md → Atomicity).
    uniqueIndex("notifications_dedupe_key_unique_idx")
      .on(table.churchId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    // Feed read path: newest-first for one recipient within one church.
    index("notifications_feed_idx").on(
      table.churchId,
      table.recipientUserId,
      table.createdAt
    ),
    // Unread count for the app shell.
    index("notifications_unread_idx")
      .on(table.churchId, table.recipientUserId)
      .where(sql`${table.readAt} is null`),
    // Dispatcher claim scan: due + pending.
    index("notifications_dispatch_idx").on(table.status, table.scheduledFor),
    // Cancel-by-entity (N-011) and the still-live re-check (N-014).
    index("notifications_entity_idx").on(
      table.churchId,
      table.entityType,
      table.entityId
    ),
  ]
);

// ----------------------------------------------------------------------------
// notification_preferences — per (user, category, channel). Never seeded.
// ----------------------------------------------------------------------------
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Preferences are per USER, not per church: a coach across two churches has
     * one set of choices. That is why there is no `church_id` here — and why
     * this is the one notification table with no tenancy column.
     */
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    category: varchar("category", { length: 20 })
      .$type<NotificationCategory>()
      .notNull(),
    channel: varchar("channel", { length: 16 })
      .$type<NotificationChannel>()
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Only meaningful on the `digest` category; null elsewhere. */
    digestCadence: varchar("digest_cadence", {
      length: 16,
    }).$type<DigestCadence>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // N-005. Upsert target: writing a preference twice updates, never
    // duplicates.
    uniqueIndex("notification_preferences_user_category_channel_idx").on(
      table.userId,
      table.category,
      table.channel
    ),
    index("notification_preferences_user_id_idx").on(table.userId),
  ]
);

// ----------------------------------------------------------------------------
// notification_deliveries — one row per channel, with its attempt history.
// ----------------------------------------------------------------------------
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .references(() => notifications.id, { onDelete: "cascade" })
      .notNull(),
    channel: varchar("channel", { length: 16 })
      .$type<NotificationChannel>()
      .notNull(),
    status: varchar("status", { length: 32 })
      .$type<NotificationDeliveryStatus>()
      .notNull()
      .default("queued"),
    /** Bounded per N-015. */
    attemptCount: integer("attempt_count").notNull().default(0),
    /** Provider error, populated only on failure. */
    error: text("error"),
    /** For correlating with provider delivery webhooks. */
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // At-most-once per channel (N-004) as a database guarantee: a dispatcher
    // that runs twice, overlaps itself, or crashes mid-run cannot create a
    // second delivery row for the same channel, so it cannot double-send.
    uniqueIndex("notification_deliveries_notification_channel_idx").on(
      table.notificationId,
      table.channel
    ),
    index("notification_deliveries_status_idx").on(table.status),
    index("notification_deliveries_provider_message_id_idx").on(
      table.providerMessageId
    ),
  ]
);

// ============================================================================
// Types
// ============================================================================

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type NotificationPreference =
  typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference =
  typeof notificationPreferences.$inferInsert;

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDelivery =
  typeof notificationDeliveries.$inferInsert;
