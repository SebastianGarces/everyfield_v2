import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { churches } from "./church";
import { sendingChurches } from "./sending-church";
import { sendingNetworks } from "./sending-network";

export const userRoles = [
  "planter",
  "coach",
  "team_member",
  "sending_church_admin",
  "network_admin",
] as const;
export type UserRole = (typeof userRoles)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }),
  role: varchar("role", { length: 50 }).$type<UserRole>().notNull(),
  churchId: uuid("church_id").references(() => churches.id),
  sendingChurchId: uuid("sending_church_id").references(
    () => sendingChurches.id
  ),
  sendingNetworkId: uuid("sending_network_id").references(
    () => sendingNetworks.id
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
