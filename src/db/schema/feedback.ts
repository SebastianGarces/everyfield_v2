import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { users } from "./user";

// ============================================================================
// Enums
// ============================================================================

export const feedbackCategories = [
  "bug",
  "suggestion",
  "question",
  "other",
] as const;
export type FeedbackCategory = (typeof feedbackCategories)[number];

export const feedbackStatuses = [
  "new",
  "reviewed",
  "resolved",
  "dismissed",
] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];

// ============================================================================
// Tables
// ============================================================================

// ----------------------------------------------------------------------------
// Feedback - User feedback submissions
// ----------------------------------------------------------------------------
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id").references(() => churches.id),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    category: varchar("category", { length: 20 })
      .$type<FeedbackCategory>()
      .notNull()
      .default("suggestion"),
    description: text("description").notNull(),
    pageUrl: varchar("page_url", { length: 500 }),
    status: varchar("status", { length: 20 })
      .$type<FeedbackStatus>()
      .notNull()
      .default("new"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("feedback_user_id_idx").on(table.userId),
    index("feedback_church_id_idx").on(table.churchId),
    index("feedback_status_idx").on(table.status),
    index("feedback_created_at_idx").on(table.createdAt),
  ]
);

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
