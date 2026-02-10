import {
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sendingChurches } from "./sending-church";
import { sendingNetworks } from "./sending-network";

export const churches = pgTable("churches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  currentPhase: integer("current_phase").default(0).notNull(),
  sendingChurchId: uuid("sending_church_id").references(
    () => sendingChurches.id
  ),
  sendingNetworkId: uuid("sending_network_id").references(
    () => sendingNetworks.id
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Church = typeof churches.$inferSelect;
export type NewChurch = typeof churches.$inferInsert;
