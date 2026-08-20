import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { sendingChurches } from "./sending-church";
import { sendingNetworks } from "./sending-network";
import { inList } from "./sql";

/**
 * The seat an account holds in its tenancy (#185, ruled 2026-08-20) — the same
 * three words in a plant, a sending church and a sending network.
 *
 * NULL IS A VALUE HERE, not a gap: a coach-only account holds no seat, because
 * coaching is an assignment (`coach_assignments`) that sits beside a seat
 * rather than being one. So the column is nullable and every reader that asks
 * "what may this account do in its tenancy?" must read the seat TOGETHER with
 * the tenancy FK — `church_id`, `sending_church_id` or `sending_network_id` —
 * which is what names WHICH tenancy the seat is held in. Neither half answers
 * alone: `seat = 'owner'` says nothing about whose owner.
 */
export const userSeats = ["owner", "admin", "member"] as const;
export type UserSeat = (typeof userSeats)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    seat: varchar("seat", { length: 20 }).$type<UserSeat>(),
    churchId: uuid("church_id").references(() => churches.id),
    sendingChurchId: uuid("sending_church_id").references(
      () => sendingChurches.id
    ),
    sendingNetworkId: uuid("sending_network_id").references(
      () => sendingNetworks.id
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // The enum, in the DATA — `.$type<>()` on a varchar is a compile-time brand
    // and nothing else, the same reasoning `association_events` applies to its
    // three unions. A NULL seat passes: `null in (…)` is NULL, and a CHECK
    // refuses only on false.
    check("users_seat_check", sql`${table.seat} in (${inList(userSeats)})`),
    // ONE OWNER PER TENANCY, IN THE DATABASE (AS-002, ruling 185 (4)). Three
    // indexes because there are three tenancies and an account holds a seat in
    // exactly one of them; one index per FK is what keeps a network's owner
    // from being counted against a sending church's.
    //
    // PARTIAL ON THE SEAT, AND THAT IS WHAT MAKES THE NULLS SAFE. A btree
    // unique index treats NULLs as distinct, so every account with no tenancy
    // FK indexes separately however many of them there are; the `where` then
    // keeps Admins and Members out of the index entirely. A coach-only account
    // — no tenancy, no seat — is caught by neither half and inserts freely.
    //
    // THIS IS THE ENFORCEMENT, not a backstop for an application check. The
    // OB-010 planter claim was a raced write (`memory/invariants.md` → User
    // Roles, before this change): two callers both read "this plant has no
    // planter" and both wrote one. A second owner is now a write that cannot
    // commit, so the loser gets a unique violation instead of a second owner.
    uniqueIndex("users_church_owner_unique_idx")
      .on(table.churchId)
      .where(sql`${table.seat} = 'owner'`),
    uniqueIndex("users_sending_church_owner_unique_idx")
      .on(table.sendingChurchId)
      .where(sql`${table.seat} = 'owner'`),
    uniqueIndex("users_sending_network_owner_unique_idx")
      .on(table.sendingNetworkId)
      .where(sql`${table.seat} = 'owner'`),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
