import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { users } from "./user";

// ============================================================================
// Enums
// ============================================================================

export const taskStatuses = [
  "not_started",
  "in_progress",
  "blocked",
  "complete",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const taskPriorities = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export const taskCategories = [
  "vision_meeting",
  "follow_up",
  "training",
  "facilities",
  "promotion",
  "administrative",
  "ministry_team",
  "launch_prep",
  "recurring",
  "general",
] as const;
export type TaskCategory = (typeof taskCategories)[number];

export const taskRelatedTypes = [
  "person",
  "meeting",
  "team",
  "facility",
] as const;
export type TaskRelatedType = (typeof taskRelatedTypes)[number];

// ============================================================================
// Tables
// ============================================================================

// ----------------------------------------------------------------------------
// Tasks - Core task records
// ----------------------------------------------------------------------------
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 20 })
      .$type<TaskStatus>()
      .notNull()
      .default("not_started"),
    priority: varchar("priority", { length: 10 })
      .$type<TaskPriority>()
      .notNull()
      .default("medium"),
    dueDate: date("due_date"),
    dueTime: time("due_time"),
    assignedToId: uuid("assigned_to_id").references(() => users.id),
    category: varchar("category", { length: 30 }).$type<TaskCategory>(),
    relatedType: varchar("related_type", {
      length: 20,
    }).$type<TaskRelatedType>(),
    relatedId: uuid("related_id"),
    parentTaskId: uuid("parent_task_id"),
    isRecurring: boolean("is_recurring").default(false).notNull(),
    recurrenceRule: jsonb("recurrence_rule"),
    completionEvent: varchar("completion_event", { length: 100 }),
    completedAt: timestamp("completed_at"),
    completedById: uuid("completed_by_id").references(() => users.id),
    createdById: uuid("created_by_id")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("tasks_church_id_idx").on(table.churchId),
    index("tasks_assigned_to_id_idx").on(table.assignedToId),
    index("tasks_status_idx").on(table.status),
    index("tasks_due_date_idx").on(table.dueDate),
    index("tasks_church_status_idx").on(table.churchId, table.status),
    index("tasks_church_assigned_idx").on(table.churchId, table.assignedToId),
    index("tasks_parent_task_id_idx").on(table.parentTaskId),
    index("tasks_deleted_at_idx").on(table.deletedAt),
    index("tasks_related_idx").on(table.relatedType, table.relatedId),
    index("tasks_completion_event_idx").on(table.completionEvent, table.relatedId),
  ]
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
