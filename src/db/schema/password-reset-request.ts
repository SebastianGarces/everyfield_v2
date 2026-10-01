import { sql } from "drizzle-orm";
import {
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./user";

/** Mailbox proof is bound to the credentials at issuance; never store bearer tokens. */
export const passwordResetRequests = pgTable(
  "password_reset_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    emailSnapshot: varchar("email_snapshot", { length: 255 }).notNull(),
    passwordHashSnapshot: varchar("password_hash_snapshot", {
      length: 255,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("password_reset_requests_token_hash_unique_idx").on(
      table.tokenHash
    ),
    uniqueIndex("password_reset_requests_live_user_unique_idx")
      .on(table.userId)
      .where(sql`${table.consumedAt} is null`),
  ]
);
