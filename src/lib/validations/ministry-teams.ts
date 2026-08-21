import { z } from "zod";
import { teamStatuses, timeCommitments } from "@/db/schema/ministry-teams";

/**
 * A checkbox in a FormData post: "true" when ticked, absent when not. The
 * preprocess keeps the exact truthiness the actions used to hand-roll
 * (`value === "true"` — any other string is false) while still accepting a
 * real boolean from a non-form caller.
 */
const checkboxBoolean = z.preprocess(
  (value) => (typeof value === "string" ? value === "true" : value),
  z.boolean().optional()
);

/** A number posted as a string; an absent field stays undefined. */
const formSortOrder = z.coerce.number().int().min(0).optional();

// ============================================================================
// Team Validations
// ============================================================================

export const teamCreateSchema = z.object({
  name: z.string().min(1, "Team name is required").max(255),
  description: z.string().max(2000).optional(),
  icon: z.string().max(50).optional(),
});

export type TeamCreateInput = z.infer<typeof teamCreateSchema>;

export const teamUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(50).optional(),
  status: z.enum(teamStatuses).optional(),
});

export type TeamUpdateInput = z.infer<typeof teamUpdateSchema>;

// ============================================================================
// Role Validations
// ============================================================================

export const roleCreateSchema = z.object({
  name: z.string().min(1, "Role name is required").max(255),
  description: z.string().max(2000).optional(),
  isLeadershipRole: checkboxBoolean,
  timeCommitment: z.enum(timeCommitments).optional(),
  desiredSkills: z.string().max(1000).optional(),
  sortOrder: formSortOrder,
});

export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

/**
 * An EDIT can say "clear this"; a CREATE cannot, and `formEntries` speaks only
 * the second language — it drops empty strings so an untouched optional field
 * stays undefined rather than becoming "". That is right for creation and wrong
 * the moment a form is pre-filled: emptying a role's description would post
 * nothing, read as "not mentioned", and the old text would reappear on the next
 * paint with no message. So the empty string reaches this schema (the action
 * passes the raw value) and becomes an explicit NULL here.
 */
const clearableText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => (value === "" ? null : value));

export const roleUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: clearableText(2000),
  isLeadershipRole: checkboxBoolean,
  timeCommitment: z.enum(timeCommitments).optional(),
  desiredSkills: z.string().max(1000).optional(),
  sortOrder: formSortOrder,
});

export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

// ============================================================================
// Responsibility Validations
// ============================================================================

/**
 * A checklist item is a LINE OF TEXT and nothing else (#311 WS1). Completion is
 * not here: it arrives as an argument from a checkbox, never as a form field,
 * so there is no shape in which a title and a tick can be posted together and
 * disagree.
 */
export const responsibilitySchema = z.object({
  title: z.string().min(1, "Responsibility is required").max(255),
});

export type ResponsibilityInput = z.infer<typeof responsibilitySchema>;

// ============================================================================
// Membership Validations
// ============================================================================

export const memberAssignSchema = z.object({
  personId: z.string().uuid("Invalid person ID"),
  startDate: z.string().optional(),
});

export type MemberAssignInput = z.infer<typeof memberAssignSchema>;

// ============================================================================
// Training Validations
// ============================================================================

export const trainingProgramCreateSchema = z.object({
  name: z.string().min(1, "Program name is required").max(255),
  description: z.string().max(2000).optional(),
  teamId: z.string().uuid().optional(),
  isRequired: checkboxBoolean,
});

export type TrainingProgramCreateInput = z.infer<
  typeof trainingProgramCreateSchema
>;

export const trainingCompleteSchema = z.object({
  personId: z.string().uuid("Invalid person ID"),
  programId: z.string().uuid("Invalid program ID"),
});

export type TrainingCompleteInput = z.infer<typeof trainingCompleteSchema>;
