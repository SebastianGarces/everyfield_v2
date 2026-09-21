import { sql } from "drizzle-orm";
import { bigint, pgTable, uuid } from "drizzle-orm/pg-core";
import { churches } from "./church";

// A conflict witness, not a business timestamp. Database triggers advance it
// for every writer of leadership candidate/set state, including new rows.
export const leadershipVersions = pgTable("leadership_versions", {
  churchId: uuid("church_id")
    .primaryKey()
    .references(() => churches.id, { onDelete: "cascade" }),
  version: bigint("version", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
});
