import {
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { users } from "./user";

export const coachAssignmentStatuses = ["active", "inactive"] as const;
export type CoachAssignmentStatus = (typeof coachAssignmentStatuses)[number];

export const coachAssignments = pgTable(
  "coach_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coachUserId: uuid("coach_user_id")
      .references(() => users.id)
      .notNull(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
    status: varchar("status", { length: 20 })
      .$type<CoachAssignmentStatus>()
      .notNull()
      .default("active"),
  },
  (table) => [
    unique("coach_assignments_coach_church_unique").on(
      table.coachUserId,
      table.churchId
    ),
    index("coach_assignments_coach_user_id_idx").on(table.coachUserId),
    index("coach_assignments_church_id_idx").on(table.churchId),
  ]
);

export type CoachAssignment = typeof coachAssignments.$inferSelect;
export type NewCoachAssignment = typeof coachAssignments.$inferInsert;
