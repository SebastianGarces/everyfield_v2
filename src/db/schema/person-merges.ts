import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { persons } from "./people";
import { users } from "./user";

/** Private audit, not a client DTO. Original source stays on its retired row;
 * the survivor snapshot preserves overwritten values. No automatic undo. */
export const personMerges = pgTable(
  "person_merges",
  {
    id: uuid("id").primaryKey(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => churches.id),
    sourceId: uuid("source_id")
      .notNull()
      .unique()
      .references(() => persons.id),
    survivorId: uuid("survivor_id")
      .notNull()
      .references(() => persons.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    survivorBefore: jsonb("survivor_before").notNull(),
    choices: jsonb("choices").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "person_merges_distinct_check",
      sql`${table.sourceId} <> ${table.survivorId}`
    ),
    index("person_merges_church_idx").on(table.churchId),
  ]
);
