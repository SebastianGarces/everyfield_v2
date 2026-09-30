import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { users } from "./user";

/** Append-only correction evidence. Never exposed outside the owning record's authority. */
export const recordCorrections = pgTable(
  "record_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => churches.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    correctedBy: uuid("corrected_by")
      .notNull()
      .references(() => users.id),
    correctedAt: timestamp("corrected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("record_corrections_record_idx").on(
      table.churchId,
      table.entityType,
      table.entityId
    ),
  ]
);
