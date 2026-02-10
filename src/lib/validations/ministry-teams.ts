import { z } from "zod";
import {
  teamStatuses,
  timeCommitments,
} from "@/db/schema/ministry-teams";

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
  isLeadershipRole: z.boolean().optional(),
  timeCommitment: z.enum(timeCommitments).optional(),
  desiredSkills: z.string().max(1000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  isLeadershipRole: z.boolean().optional(),
  timeCommitment: z.enum(timeCommitments).optional(),
  desiredSkills: z.string().max(1000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

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
  isRequired: z.boolean().optional(),
});

export type TrainingProgramCreateInput = z.infer<
  typeof trainingProgramCreateSchema
>;

export const trainingCompleteSchema = z.object({
  personId: z.string().uuid("Invalid person ID"),
  programId: z.string().uuid("Invalid program ID"),
});

export type TrainingCompleteInput = z.infer<typeof trainingCompleteSchema>;
