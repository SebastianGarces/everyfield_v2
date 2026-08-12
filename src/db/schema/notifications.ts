import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { inList } from "./sql";
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
 * Vision Meeting". Adding one is a code change plus a coded default; it needs
 * no backfill (absence resolves to the coded default) but it DOES need the
 * CHECK constraints in migration 0024 widened — see 0029.
 *
 * `milestones` (N-025, ruled 2026-07-27) is the one category an oversight
 * recipient may receive per event. It exists so "oversight never gets granular
 * per-event notifications" is a structural fact rather than a rule about
 * `type` strings: the five granular categories above it are refused for an
 * oversight recipient outright, toggle or no toggle, and only `milestones` and
 * `digest` are eligible at all (`OVERSIGHT_ELIGIBLE_CATEGORIES`).
 */
export const notificationCategories = [
  "tasks",
  "meetings",
  "communication",
  "teams",
  "phase",
  "milestones",
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

/**
 * What a notification can be ABOUT — the cancel-by-entity discriminator and the
 * feed's link target.
 *
 * Code-defined rather than free text on purpose. `cancelByEntity` is a denial
 * primitive that spans every recipient in a church, so `entity_type` is half of
 * the key that decides what gets suppressed; a free-text field lets a typo
 * silently cancel nothing and lets request-forwarded input aim the primitive at
 * anything. Adding a type is a one-line code change here — deliberately NOT a
 * database CHECK, so a follow-on unit (#131, #133) can name a new subject
 * without a migration.
 *
 * Values are the singular of the owning table, so a reviewer can map a
 * notification back to what it speaks for.
 */
export const notificationEntityTypes = [
  "task",
  "meeting",
  "person",
  "message",
  "ministry_team",
  "training",
  "phase_assessment",
  "document",
  "facility",
  "financial_entry",
] as const;
export type NotificationEntityType = (typeof notificationEntityTypes)[number];

// ============================================================================
// Enum guards at the database boundary
// ============================================================================
//
// `.$type<>()` is a TypeScript brand and nothing more — it disappears at
// runtime, so a value that never passed a Zod parse (a server action forwarding
// a form body, a script, a psql session) reaches a plain `varchar` unopposed.
// A mangled `category` is not a loud failure either: it is simply never found
// by the code-defined preference lookup, so the user sees a setting saved that
// resolution will never consult. These CHECK constraints make the enum a
// property of the data instead of a property of the caller.
//
// They list values, not a pgEnum, deliberately: adding a category stays a code
// change plus a small migration, never a type rewrite with a table rewrite.

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
    entityType: varchar("entity_type", {
      length: 32,
    }).$type<NotificationEntityType>(),
    entityId: uuid("entity_id"),
    /**
     * Caller-supplied idempotency key. Unique per (church, RECIPIENT) — see the
     * index below. The recipient is part of the key because a fan-out enqueue
     * ("remind all six attendees") composes one key per event, not per person.
     */
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
    // Idempotency (N-001), scoped to (church, RECIPIENT, key).
    //
    // The recipient is in the key on purpose. A notification is addressed to one
    // user, but the EVENT it announces is usually shared: the natural caller for
    // a meeting reminder (F3) or a team alert (F8) loops the attendees and
    // enqueues one row each under a per-event key
    // (`meeting.reminder:<id>:3d`). Leaving the recipient out of this index
    // would let attendee #1 win the insert and silently swallow #2..N — the
    // caller would get `created: false` and someone else's row back, with no
    // way to detect the drop.
    //
    // Partial, because most notifications carry no key and NULLs would not
    // collide anyway — the predicate keeps the index small and states the
    // intent. This is the concurrency guard: two simultaneous enqueues with the
    // same key race into the same INSERT, and the loser is absorbed by ON
    // CONFLICT DO NOTHING rather than by a SELECT that both requests would have
    // passed (see memory/invariants.md → Atomicity).
    //
    // `status <> 'cancelled'` is the LIVENESS term, and it is load-bearing
    // (migration 0025). N-011 defines reschedule as cancel + re-enqueue, and
    // reopen (task completed → cancelled, task reopened → re-enqueue) has the
    // same shape. Without the term, a cancelled row keeps occupying its key
    // forever: the re-enqueue is absorbed by ON CONFLICT, the caller gets
    // `created: false` with a CANCELLED row back, and the notification is
    // silently lost — no pending row for the dispatcher, and nothing in the
    // feed. A cancelled row is a record of something that will never be
    // delivered, so it must not reserve the key for the thing that replaces it.
    // Delivered and failed rows DO keep reserving it: those announcements
    // happened, and re-announcing them is exactly what dedupe exists to stop.
    //
    // The predicate is mirrored BYTE-FOR-BYTE by the ON CONFLICT clause in
    // `dbEnqueueDeps.insertIfAbsent` (src/lib/notifications/enqueue.ts).
    // Postgres infers a partial arbiter index only from a matching predicate,
    // so the two must change together or every keyed enqueue fails at runtime
    // with "no unique or exclusion constraint matching the ON CONFLICT
    // specification".
    uniqueIndex("notifications_dedupe_key_unique_idx")
      .on(table.churchId, table.recipientUserId, table.dedupeKey)
      .where(
        sql`${table.dedupeKey} is not null and ${table.status} <> 'cancelled'`
      ),
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
    check(
      "notifications_category_check",
      sql`${table.category} in (${inList(notificationCategories)})`
    ),
    check(
      "notifications_status_check",
      sql`${table.status} in (${inList(notificationStatuses)})`
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
    // A preference is a consent record. One stored under a category or channel
    // the code does not define is never found by resolution, so the opt-out it
    // represents is silently ignored — the failure mode a CHECK turns into a
    // write error at the boundary.
    check(
      "notification_preferences_category_check",
      sql`${table.category} in (${inList(notificationCategories)})`
    ),
    check(
      "notification_preferences_channel_check",
      sql`${table.channel} in (${inList(notificationChannels)})`
    ),
    check(
      "notification_preferences_digest_cadence_check",
      sql`${table.digestCadence} is null or ${table.digestCadence} in (${inList(digestCadences)})`
    ),
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
    check(
      "notification_deliveries_channel_check",
      sql`${table.channel} in (${inList(notificationChannels)})`
    ),
    check(
      "notification_deliveries_status_check",
      sql`${table.status} in (${inList(notificationDeliveryStatuses)})`
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
