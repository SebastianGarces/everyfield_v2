import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { sendingNetworks } from "./sending-network";

export const sendingChurches = pgTable("sending_churches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  sendingNetworkId: uuid("sending_network_id").references(
    () => sendingNetworks.id
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SendingChurch = typeof sendingChurches.$inferSelect;
export type NewSendingChurch = typeof sendingChurches.$inferInsert;
