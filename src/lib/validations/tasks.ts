import {
  taskCategories,
  taskPriorities,
  taskRelatedTypes,
  taskStatuses,
} from "@/db/schema";
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
  completionEvent: z.string().max(100).optional(),
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
  completionEvent: z.string().max(100).nullish(),
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
