import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const churches = pgTable("churches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  currentPhase: integer("current_phase").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Church = typeof churches.$inferSelect;
export type NewChurch = typeof churches.$inferInsert;
