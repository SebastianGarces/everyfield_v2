import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { users } from "./user";

export const churchPrivacySettings = pgTable(
  "church_privacy_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    sharePeople: boolean("share_people").default(false).notNull(),
    shareMeetings: boolean("share_meetings")
      .default(false)
      .notNull(),
    shareTasks: boolean("share_tasks").default(false).notNull(),
    shareFinancials: boolean("share_financials").default(false).notNull(),
    shareMinistryTeams: boolean("share_ministry_teams")
      .default(false)
      .notNull(),
    shareFacilities: boolean("share_facilities").default(false).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [
    unique("church_privacy_settings_church_id_unique").on(table.churchId),
  ]
);

export type ChurchPrivacySettings = typeof churchPrivacySettings.$inferSelect;
export type NewChurchPrivacySettings =
  typeof churchPrivacySettings.$inferInsert;
