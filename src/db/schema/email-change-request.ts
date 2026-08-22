import {
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./user";

// ============================================================================
// `email_change_requests` — the address an account has ASKED for, before it is
// the address it signs in with (CS-002, #616).
//
// `users.email` IS THE LOGIN IDENTIFIER, so it may only ever hold an address
// somebody has PROVEN they can read. That proof is a link sent to the new
// address, and this table is what the link is redeemed against: one row per
// request, holding the address that has been asked for and the digest of the
// token that was mailed to it.
//
// THE TOKEN IS A SECRET, NOT AN ID — the same rule `user_invitations` carries
// (`memory/invariants.md` → Multi-Tenancy). `token_hash` holds sha256 of 32
// random bytes that exist only in transit, so a database read, a log line or a
// backup hands nobody a working link, and the unique index makes the redemption
// a point read on the digest.
//
// TWO INVARIANTS ARE IN THE DATABASE rather than in a comment:
//
//   1. ONE LIVE REQUEST PER ACCOUNT. `email_change_requests_live_user_unique_idx`
//      is partial on `consumed_at IS NULL`, so a second request cannot commit
//      beside a first. That is what makes "asking again supersedes the last ask"
//      a property of the schema instead of a step a writer can forget — and it
//      is why a mistyped address needs no Cancel control: the next request
//      settles the old row in the same batch that writes the new one.
//   2. A TOKEN IS SINGLE-USE. `consumed_at` is the whole gate, set by the
//      compare-and-set in `confirmEmailChange` and re-asserted by the `users`
//      write beside it (`memory/invariants.md` → Transactions).
//
// `consumed_at` MEANS "NO LONGER LIVE", NOT "VERIFIED", and both doors set it:
// a redemption and a supersede. The column governs exactly one thing — whether
// this token still opens anything — and for that question the two doors are the
// same answer. Nothing reads WHICH door it was, so no outcome column exists to
// go stale; the day something needs to (a history surface), it is a column plus
// a CHECK that pairs it with this timestamp, not a re-reading of this one.
//
// EXPIRY IS NOT IN THE INDEX and cannot be: `now()` is not immutable, so a
// partial index may not name it. The window is enforced in the redemption's own
// `WHERE`; an expired-but-unconsumed row therefore still holds the live slot
// until the account asks again, which is the honest reading — that account HAS
// an outstanding request, it has simply run out of time to answer it.
// ============================================================================

export const emailChangeRequests = pgTable(
  "email_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The address asked for, normalised the way `users.email` is stored. */
    newEmail: varchar("new_email", { length: 255 }).notNull(),
    /** sha256 of the token the email carried. The token itself is never stored. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    /** When this row stopped being live — redeemed, or superseded. NULL = live. */
    consumedAt: timestamp("consumed_at"),
  },
  (table) => [
    // INVARIANT 2's other half: the redemption is a point read, and two rows can
    // never carry one token.
    uniqueIndex("email_change_requests_token_hash_unique_idx").on(
      table.tokenHash
    ),
    // INVARIANT 1 — at most one live request per account.
    uniqueIndex("email_change_requests_live_user_unique_idx")
      .on(table.userId)
      .where(sql`${table.consumedAt} is null`),
  ]
);

export type EmailChangeRequest = typeof emailChangeRequests.$inferSelect;
export type NewEmailChangeRequest = typeof emailChangeRequests.$inferInsert;
