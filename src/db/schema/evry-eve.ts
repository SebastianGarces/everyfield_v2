import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { churches } from "./church";
import { users } from "./user";

/** Ownership is application-enforced; Eve does not authorize access to a session id. */
export const evryEveSessions = pgTable(
  "evry_eve_sessions",
  {
    id: text("id").primaryKey(),
    conversationId: uuid("conversation_id").defaultRandom().notNull().unique(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => churches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull().default("New conversation"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("evry_eve_sessions_owner_idx").on(
      table.churchId,
      table.userId,
      table.updatedAt
    ),
  ]
);

/** Private upload bindings never enter model context; an ID grants no authority by itself. */
export const evryEveAttachments = pgTable(
  "evry_eve_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => evryEveSessions.id),
    churchId: uuid("church_id")
      .notNull()
      .references(() => churches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    referenceHash: text("reference_hash").notNull(),
    reference: text("reference").notNull(),
    kind: text("kind").notNull(),
    digest: text("digest").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("evry_eve_attachments_session_reference_idx").on(
      table.sessionId,
      table.referenceHash
    ),
    check(
      "evry_eve_attachments_kind_check",
      sql`${table.kind} in ('people_csv', 'person_photo', 'commitment_document')`
    ),
    check(
      "evry_eve_attachments_hash_check",
      sql`${table.digest} ~ '^[a-f0-9]{64}$' and ${table.referenceHash} ~ '^[a-f0-9]{64}$'`
    ),
  ]
);
