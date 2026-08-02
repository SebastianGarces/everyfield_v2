import { pgTable, uuid, boolean, timestamp, unique } from "drizzle-orm/pg-core";
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
    shareMeetings: boolean("share_meetings").default(false).notNull(),
    shareTasks: boolean("share_tasks").default(false).notNull(),
    shareFinancials: boolean("share_financials").default(false).notNull(),
    shareMinistryTeams: boolean("share_ministry_teams")
      .default(false)
      .notNull(),
    shareFacilities: boolean("share_facilities").default(false).notNull(),
    /**
     * F11 N-026 (ruled 2026-07-27) — the ONE control over everything an
     * oversight recipient (`sending_church_admin`, `network_admin`) is told
     * about this plant.
     *
     * It replaced `share_phase` and `share_digest` (added by migration 0026).
     * Those were per-category notification toggles, and the ruling
     * removed the category model for oversight altogether: oversight receives a
     * daily activity SUMMARY plus three milestones, never granular per-event
     * notifications, so there is nothing left for a per-category toggle to say.
     * One switch, phrased in the planter's terms ("share activity with your
     * sending church or network"), is also the only phrasing a planter can
     * actually reason about.
     *
     * Default FALSE, for every church, including the ones that had opted in to
     * the columns it replaces — 0029 migrates nobody forward. Sharing your
     * plant's activity outward is a consent decision, and inheriting it from a
     * toggle that meant something else would be inventing consent.
     *
     * The six `share_*` toggles above are a DIFFERENT question and are
     * untouched: they gate what an oversight user may PULL on the oversight
     * dashboard. This one gates what is PUSHED to them.
     *
     * NOTE — `share_phase` and `share_digest` are absent from this schema but
     * STILL PRESENT IN THE DATABASE. 0029 is deliberately expand-only: it adds
     * the column below without dropping the two it supersedes, because this
     * Neon branch is shared by local dev, every preview AND production, and
     * dropping a column that pre-0029 builds still name in their SELECT list
     * would break `canAccessFeatureData` everywhere for as long as #224 sat in
     * review. A follow-up contract migration drops them after #224 merges.
     * Leaving them out of this file is what makes the new code stop reading
     * them; see the 0029 header for the full reasoning.
     */
    shareActivityWithOversight: boolean("share_activity_with_oversight")
      .default(false)
      .notNull(),
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
