import {
  taskCategories,
  taskPriorities,
  taskRelatedTypes,
  taskStatuses,
} from "@/db/schema";
import { MAX_BULK_TASKS } from "@/lib/tasks/types";
import { z } from "zod";

// ============================================================================
// Base Schemas
// ============================================================================

export const taskStatusSchema = z.enum(taskStatuses);
export const taskPrioritySchema = z.enum(taskPriorities);
export const taskCategorySchema = z.enum(taskCategories);
export const taskRelatedTypeSchema = z.enum(taskRelatedTypes);

// ============================================================================
// Task Schemas
// ============================================================================
//
// `completionEvent` IS ABSENT FROM BOTH SCHEMAS, AND ITS ABSENCE IS THE FIX
// (#323 WS1, from #162). The column exists and `tasks/events.ts` writes it —
// on the ONE row it owns, the meeting evaluation task. Neither `createTask`
// nor `updateTask` ever read the parsed field, so accepting it from a form was
// dead weight with a live edge: `tasks_meeting_evaluation_unique_idx` is
// partial on `completion_event = 'meeting.evaluation.completed'` and keyed on
// (church_id, related_id) ALONE, while the guard that reads it also demands
// `related_type = 'meeting'`. A task posted with that completion event, a
// meeting's id as `relatedId` and `relatedType: 'person'` therefore occupied
// the index slot while remaining invisible to the guard — the real INSERT then
// failed on that index, was classified as a benign lost race, and the meeting
// finalized with zero follow-up tasks, permanently.
//
// So the field the form could not use is the field the form no longer has. Do
// not re-add it to reach the column: an auto-completion hook is a decision the
// generator makes, never a value a client posts. `tasks.test.ts` fails if it
// comes back.

export const taskCreateSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(500)
    .transform((v) => v.trim()),
  description: z.string().optional(),
  status: taskStatusSchema.optional().default("not_started"),
  priority: taskPrioritySchema.optional().default("medium"),
  dueDate: z.string().optional(), // ISO date string "YYYY-MM-DD"
  dueTime: z.string().optional(), // "HH:MM" format
  assignedToId: z.string().uuid().optional().or(z.literal("")),
  category: taskCategorySchema.optional(),
  relatedType: taskRelatedTypeSchema.optional(),
  relatedId: z.string().uuid().optional().or(z.literal("")),
  parentTaskId: z.string().uuid().optional().or(z.literal("")),
});

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(500)
    .transform((v) => v.trim())
    .optional(),
  description: z.string().nullish(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: z.string().nullish(), // allow clearing the due date
  dueTime: z.string().nullish(),
  assignedToId: z.string().uuid().nullish(),
  category: taskCategorySchema.nullish(),
  relatedType: taskRelatedTypeSchema.nullish(),
  relatedId: z.string().uuid().nullish(),
  parentTaskId: z.string().uuid().nullish(),
});

export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

// ============================================================================
// Search & Filter Schemas
// ============================================================================

export const taskSearchParamsSchema = z.object({
  query: z.string().optional(),
  status: z.array(taskStatusSchema).optional(),
  priority: z.array(taskPrioritySchema).optional(),
  category: z.array(taskCategorySchema).optional(),
  assignedToId: z.string().uuid().optional(),
  dueDateFrom: z.string().optional(), // ISO date
  dueDateTo: z.string().optional(), // ISO date
  view: z.enum(["all", "my_tasks"]).optional().default("my_tasks"),
  sortBy: z
    .enum(["due_date", "priority", "status", "created_at", "title"])
    .optional()
    .default("due_date"),
  sortDir: z.enum(["asc", "desc"]).optional().default("asc"),
  includeCompleted: z.boolean().optional().default(false),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export type TaskSearchParams = z.infer<typeof taskSearchParamsSchema>;

// ============================================================================
// Quick Add Schema
// ============================================================================

export const taskQuickAddSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(500)
    .transform((v) => v.trim()),
  dueDate: z.string().optional(),
  priority: taskPrioritySchema.optional().default("medium"),
});

export type TaskQuickAddInput = z.infer<typeof taskQuickAddSchema>;

// ============================================================================
// Bulk Operation Schemas (T-019)
// ============================================================================

/**
 * True only for a date string naming a day that actually exists.
 *
 * `Date.parse` is not sufficient on its own: it does not reject impossible
 * calendar days, it *rolls them over*. `Date.parse("2026-02-31T00:00:00Z")`
 * returns a number (Mar 3), so a regex-plus-parse check happily accepts
 * 2026-02-31 and the user's reschedule silently lands on the wrong day — or
 * surfaces later as a generic write failure. Round-tripping the parsed date
 * back to Y-M-D and comparing is what actually catches it.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;

  return parsed.toISOString().slice(0, 10) === value;
}

export const bulkTaskIdsSchema = z
  .array(z.string().uuid())
  .min(1, "Select at least one task")
  .max(MAX_BULK_TASKS, `You can only update ${MAX_BULK_TASKS} tasks at once`);

export const bulkRescheduleSchema = z.object({
  taskIds: bulkTaskIdsSchema,
  // Date-only ISO string, matching `tasks.due_date`.
  dueDate: z.string().refine(isCalendarDate, {
    message: "Choose a valid date",
  }),
});

export type BulkRescheduleInput = z.infer<typeof bulkRescheduleSchema>;

/**
 * Comma-separated prerequisite ids from the task form's hidden input.
 *
 * The form posts one field so `formDataToObject` cannot collapse a repeated
 * name. Empty or absent means "wait on nothing".
 */
export const prerequisiteTaskIdsSchema = z
  .string()
  .optional()
  .transform((value) => {
    if (!value) return [];
    return [
      ...new Set(
        value
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      ),
    ];
  })
  .pipe(z.array(z.string().uuid()));
