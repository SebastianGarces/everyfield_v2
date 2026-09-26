// Retired agent tables: retained to match applied migration history.
// No alpha runtime reads or writes these tables. Drop only in an explicitly
// approved forward migration after reviewing stored data and dependencies.
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
