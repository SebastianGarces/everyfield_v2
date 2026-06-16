import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ============================================================================
// Enums
// ============================================================================

export const authAttemptKinds = ["login", "register"] as const;
export type AuthAttemptKind = (typeof authAttemptKinds)[number];

// ============================================================================
// Tables
// ============================================================================

// ----------------------------------------------------------------------------
// Auth Attempts - Login/registration attempt tracking (for rate limiting)
// ----------------------------------------------------------------------------
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Lowercased email used in the attempt
    identifier: text("identifier").notNull(),
    // Originating IP address (nullable when unavailable)
    ip: text("ip"),
    kind: text("kind").$type<AuthAttemptKind>().notNull(),
    success: boolean("success").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("auth_attempts_identifier_kind_created_at_idx").on(
      table.identifier,
      table.kind,
      table.createdAt
    ),
    index("auth_attempts_ip_kind_created_at_idx").on(
      table.ip,
      table.kind,
      table.createdAt
    ),
  ]
);

export type AuthAttempt = typeof authAttempts.$inferSelect;
export type NewAuthAttempt = typeof authAttempts.$inferInsert;
