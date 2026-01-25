import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./user";

export const sessions = pgTable(
  "sessions",
  {
    // Core session fields
    id: varchar("id", { length: 255 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    // Audit fields
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: varchar("ip_address", { length: 45 }), // IPv6 max length
    userAgent: varchar("user_agent", { length: 512 }),

    // IP geolocation (resolved at session creation)
    country: varchar("country", { length: 2 }), // ISO 3166-1 alpha-2 code
    city: varchar("city", { length: 100 }),

    // Fresh session tracking (for sensitive operations)
    // A session is "fresh" for ~10 minutes after login, requiring re-auth after
    fresh: boolean("fresh").default(true).notNull(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ]
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
