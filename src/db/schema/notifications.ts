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

/**
 * Why an address stopped being mailable (#324, from #262).
 *
 * Both values are the PROVIDER's fact, not a count we inferred: a hard bounce
 * says the mailbox does not exist, a spam complaint says the reader asked us to
 * stop. Neither is a number of retries away from working. A SOFT bounce is
 * deliberately absent — a full mailbox empties, and suppressing on one would
 * silently un-reach a live cohort member.
 */
export const emailSuppressionReasons = [
  "hard_bounce",
  "spam_complaint",
] as const;
export type EmailSuppressionReason = (typeof emailSuppressionReasons)[number];

/** Cadence of the recurring roll-up (N-013). Only meaningful on `digest`. */
export const digestCadences = ["daily", "weekly"] as const;
export type DigestCadence = (typeof digestCadences)[number];

/**
 * WHY A PREFERENCE ROW EXISTS — the stamp that decides whether its `enabled`
 * is a consent record or a by-product.
 *
 * A row can exist without anybody having decided anything. `enabled` is NOT
 * NULL and the table's grain is (user, category, channel), so a save that only
 * meant to store a cadence still has to invent an `enabled` for the row it
 * creates. Without a stamp the only thing left to read is the VALUE, and a
 * value that happens to equal the coded default cannot be told from a value
 * nobody chose.
 *
 *   `chosen`      a human decided this value — a settings toggle, or the
 *                 emailed unsubscribe and its undo. Honoured as written,
 *                 forever, however it agrees with today's coded default.
 *   `incidental`  a save wrote it to carry something else. It says nothing on
 *                 its own, so it stays subject to the value-equality rule: as
 *                 long as it agrees with the coded default it is inheritable
 *                 and a later change to that default still reaches the user.
 *
 * IT IS NEVER REQUEST INPUT. Each write path states its own stamp, so a caller
 * cannot claim `chosen` for a by-product — see `setPreferenceQuery` and
 * `setDigestCadenceQuery` in `src/lib/notifications/preferences.ts`.
 *
 * `chosen` is the column DEFAULT because that is the fail-safe direction: its
 * cost is a row that keeps following the user instead of the default, while
 * `incidental`'s cost is a preference the user set being dropped.
 */
export const preferenceIntents = ["chosen", "incidental"] as const;
export type PreferenceIntent = (typeof preferenceIntents)[number];

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
/**
 * WHAT A NOTIFICATION IS ANCHORED TO — the tenancy discriminator (#304 WS3,
 * ruling #351, migration 0036).
 *
 * Until 0036 there was one answer, `church_id`, NOT NULL: every notification in
 * the product was about a plant, filed under that plant, and read back through
 * `NotificationScope`. #304 WS3 produced the first events that name NO plant —
 * a sending church accepting, declining or leaving a NETWORK's invitation — and
 * the two ways to file them were a parallel org-notifications table or a
 * generalized anchor on this one. #351 ruled for the anchor: two tables would
 * mean two queues, two dispatchers, two feeds and two places for the
 * at-most-once delivery guarantee to be re-implemented.
 *
 *   `church`         `church_id` carries it. EVERY notification that existed
 *                    before 0036 is one of these, and every church-scoped read
 *                    in the product is unchanged — `scopedWhere` still names
 *                    `church_id`, so an org-anchored row can never appear in a
 *                    plant's feed by omission.
 *   `sending_church` `anchor_org_id` is a `sending_churches.id`.
 *   `network`        `anchor_org_id` is a `sending_networks.id`.
 *
 * ONE ORG COLUMN, NOT TWO, and it is the dedupe index that decides it. A
 * notification's idempotency (N-001) is a UNIQUE index over the anchor, the
 * recipient and the key; with a nullable column per org kind, every org-anchored
 * row would carry a NULL in the index and NULLs never collide in a btree unique
 * index — so `dedupeKey` would silently stop being idempotent for exactly the
 * rows this change adds. A single non-null `anchor_org_id` keeps the guarantee.
 * It carries no FK for the same reason `association_events.org_id` does not:
 * Postgres has no polymorphic foreign key, and the discriminator plus the CHECK
 * is the integrity available.
 */
export const notificationAnchorTypes = [
  "church",
  "sending_church",
  "network",
] as const;
export type NotificationAnchorType = (typeof notificationAnchorTypes)[number];

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
    /**
     * WHICH KIND of thing this notification is filed under (N-010, migration
     * 0036). Defaults to `'church'` in the database as well as here: that is
     * what every pre-0036 row is, and it makes the CHECK below the thing that
     * catches a writer who names an org anchor and forgets the discriminator.
     */
    anchorType: varchar("anchor_type", { length: 20 })
      .$type<NotificationAnchorType>()
      .notNull()
      .default("church"),
    /**
     * The CHURCH anchor, and the tenancy boundary EVERY church-scoped read
     * still filters on (N-010). Nullable only because it is one of two anchor
     * columns; the CHECK below permits the null exclusively when
     * `anchor_org_id` carries the anchor instead.
     */
    churchId: uuid("church_id").references(() => churches.id, {
      onDelete: "cascade",
    }),
    /**
     * The ORG anchor — a `sending_churches.id` or a `sending_networks.id`,
     * discriminated by `anchor_type`. No FK: see `notificationAnchorTypes`.
     *
     * Losing the church anchor's ON DELETE CASCADE with it is deliberate and
     * bounded — neither org table has a delete path in the product, and an
     * org-anchored row is only ever one of the three own-relationship
     * milestones, which are the org's own record of what it did.
     */
    anchorOrgId: uuid("anchor_org_id"),
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
    // The SAME guarantee for an ORG-ANCHORED row (migration 0036).
    //
    // A second index rather than a widened first one, and the reason is that a
    // widened one would have had to change: the index above is arbitrated by an
    // ON CONFLICT clause that mirrors its predicate byte for byte
    // (`dbEnqueueDeps.insertIfAbsent`), and every keyed enqueue in the product
    // rides it. Leaving it untouched means the church path cannot regress on a
    // change that is not about it. Org-anchored rows carry a NULL `church_id`
    // and so never collide there at all — this index is the only thing that
    // makes their `dedupeKey` idempotent, which is why `anchor_org_id` is one
    // non-null column and not two nullable ones.
    uniqueIndex("notifications_org_dedupe_key_unique_idx")
      .on(table.anchorOrgId, table.recipientUserId, table.dedupeKey)
      .where(
        sql`${table.anchorOrgId} is not null and ${table.dedupeKey} is not null and ${table.status} <> 'cancelled'`
      ),
    // The org-anchored feed read: newest-first for one recipient within one org.
    index("notifications_org_feed_idx").on(
      table.anchorOrgId,
      table.recipientUserId,
      table.createdAt
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
    check(
      "notifications_anchor_type_check",
      sql`${table.anchorType} in (${inList(notificationAnchorTypes)})`
    ),
    // EXACTLY ONE ANCHOR, in the data (#351). A row with neither would be a
    // notification no read path can reach; a row with both would be reachable
    // from two tenants at once, which is the one thing N-010 exists to prevent.
    check(
      "notifications_anchor_check",
      sql`(
        (${table.anchorType} = 'church'
          and ${table.churchId} is not null
          and ${table.anchorOrgId} is null)
        or
        (${table.anchorType} in ('sending_church', 'network')
          and ${table.anchorOrgId} is not null
          and ${table.churchId} is null)
      )`
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
    /**
     * WHY this row exists — see `preferenceIntents`. It is what
     * `preferenceValueIsInheritable` decides on, so a row whose `enabled` was
     * invented to carry a cadence cannot be read back as a consent record.
     */
    intent: varchar("intent", { length: 16 })
      .$type<PreferenceIntent>()
      .notNull()
      .default("chosen"),
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
    // The stamp decides whether a row is honoured as written or may still be
    // overtaken by a change to the coded default, so a value the code cannot
    // name would put a consent record in a state no resolver has a rule for.
    check(
      "notification_preferences_intent_check",
      sql`${table.intent} in (${inList(preferenceIntents)})`
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

// ----------------------------------------------------------------------------
// email_suppressions — an ADDRESS we must stop mailing (#324, from #262).
// ----------------------------------------------------------------------------
//
// WHY THIS IS NOT A COLUMN ON `notification_deliveries`. That table records what
// happened to ONE attempt, and `PERMANENT_FAILURE_PREFIX` on its `error` stops
// exactly that (notification, channel) pair being retried. It says nothing about
// the NEXT notification, which gets a fresh row with a fresh attempt count and
// mails the same dead mailbox again. The exposure compounds: a digest is
// enqueued per day, so one dead address in the alpha cohort is a bounce a day
// against a sending domain that takes months to earn back. Suppression is
// therefore a fact about the ADDRESS, filed once, read by every later send.
//
// THE ADDRESS IS THE KEY, not the user. The same mailbox can sit on two
// accounts, an account can change address, and the provider's webhook names an
// address and never a user id. `email` is stored ALREADY NORMALISED —
// `normalizeEmailAddress` in `src/lib/notifications/channels/suppression.ts` is
// the single writer of that form — because a `lower(email)` expression index
// would make the `ON CONFLICT` target unspellable (the same reasoning as the
// rejected `coalesce` index in memory/invariants.md → Transactions).
//
// A SUPPRESSION IS NOT A LIFE SENTENCE. `cleared_at` retires a row without
// deleting it, so the history of "this address bounced in August" survives the
// clear — an address that bounces, clears and bounces again is three rows and a
// legible story, not one row overwritten twice. `cleared_reason` is NOT NULL
// whenever `cleared_at` is (`email_suppressions_cleared_check`): a clear that
// does not say why is indistinguishable from a bug that cleared it.
//
// `email_suppressions_active_email_idx` is PARTIAL — unique on `email` only
// `where cleared_at is null` — which is what makes "at most one ACTIVE
// suppression per address" a database property while leaving room for the
// cleared history beside it. It is also the arbiter for the recorder's
// `ON CONFLICT … DO NOTHING`, so two webhook deliveries of the same bounce
// write one row.
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Already lowercased and trimmed — see `normalizeEmailAddress`. */
    email: varchar("email", { length: 320 }).notNull(),
    reason: varchar("reason", { length: 32 })
      .$type<EmailSuppressionReason>()
      .notNull(),
    /** The provider event that produced it, e.g. `email.bounced`. Diagnostic. */
    source: varchar("source", { length: 64 }),
    /** What the provider said, kept verbatim so a dispute has evidence. */
    detail: text("detail"),
    suppressedAt: timestamp("suppressed_at").defaultNow().notNull(),
    /** Non-null = retired. The row stays as history. */
    clearedAt: timestamp("cleared_at"),
    /**
     * The admin who cleared it. NULL with a non-null `cleared_at` is the
     * self-service path — the address holder re-verified — which has no actor
     * row to name, so this cannot be the "was it cleared?" test. `cleared_at`
     * is.
     */
    clearedByUserId: uuid("cleared_by_user_id").references(() => users.id),
    clearedReason: text("cleared_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("email_suppressions_active_email_idx")
      .on(table.email)
      .where(sql`${table.clearedAt} is null`),
    index("email_suppressions_email_idx").on(table.email),
    check(
      "email_suppressions_reason_check",
      sql`${table.reason} in (${inList(emailSuppressionReasons)})`
    ),
    check(
      "email_suppressions_cleared_check",
      sql`(${table.clearedAt} is null) = (${table.clearedReason} is null)`
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

export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppression = typeof emailSuppressions.$inferInsert;
