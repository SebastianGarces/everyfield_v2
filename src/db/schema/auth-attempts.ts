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

/**
 * WHICH CREDENTIAL ATTEMPT THIS ROW IS ABOUT.
 *
 * A CLOSED UNION, and `RATE_LIMITS` (`@/lib/auth/rate-limit`) is a total map
 * over it — so a member added here has no policy until one is written for it,
 * and the compiler says so. That is the whole extension point: CS-005 says the
 * email and password changes ride the guard sign-in rides, "one implementation,
 * not a second copy", and what they added was two members of this union and two
 * rows of that table.
 *
 * `email_change` counts the REQUEST, not the redemption — see the policy table
 * for why an unverified request is an attempt that has not succeeded yet.
 */
export const authAttemptKinds = [
  "login",
  "register",
  "email_change",
  "password_change",
] as const;
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
