import {
  commitmentTypes,
  householdRoles,
  interviewResults,
  interviewStatuses,
  personSources,
  personStatuses,
  skillCategories,
  skillProficiencies,
} from "@/db/schema";
import { z } from "zod";

// ============================================================================
// Base Schemas
// ============================================================================

export const personStatusSchema = z.enum(personStatuses);
export const personSourceSchema = z.enum(personSources);
export const householdRoleSchema = z.enum(householdRoles);
export const interviewStatusSchema = z.enum(interviewStatuses);
export const interviewResultSchema = z.enum(interviewResults);
export const commitmentTypeSchema = z.enum(commitmentTypes);
export const skillCategorySchema = z.enum(skillCategories);
export const skillProficiencySchema = z.enum(skillProficiencies);

// ============================================================================
// Person Schemas
// ============================================================================

export const personCreateSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(255)
    .transform((v) => v.trim()),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(255)
    .transform((v) => v.trim()),
  email: z
    .string()
    .email("Invalid email address")
    .max(255)
    .optional()
    .or(z.literal("")),
  phone: z.string().max(50).optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).optional().default("US"),
  status: personStatusSchema.optional().default("prospect"),
  source: personSourceSchema.optional(),
  sourceDetails: z.string().optional(),
  notes: z.string().optional(),
  householdId: z.string().uuid().optional(),
  householdRole: householdRoleSchema.optional(),
});

export type PersonCreateInput = z.infer<typeof personCreateSchema>;

export const personUpdateSchema = personCreateSchema.partial().extend({
  photoUrl: z.string().url().max(500).optional(),
  status: personStatusSchema.optional(), // no default for updates
  country: z.string().max(100).optional(), // no default for updates
});

export type PersonUpdateInput = z.infer<typeof personUpdateSchema>;

export const personQuickAddSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(255)
    .transform((v) => v.trim()),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(255)
    .transform((v) => v.trim()),
  email: z
    .string()
    .email("Invalid email address")
    .max(255)
    .optional()
    .or(z.literal("")),
  phone: z.string().max(50).optional(),
  source: personSourceSchema.optional().default("other"),
});

export type PersonQuickAddInput = z.infer<typeof personQuickAddSchema>;

// ============================================================================
// Search & Filter Schemas
// ============================================================================

export const personSearchParamsSchema = z.object({
  query: z.string().optional(),
  status: z.array(personStatusSchema).optional(),
  source: z.array(personSourceSchema).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(25),
});

export type PersonSearchParams = z.infer<typeof personSearchParamsSchema>;

// ============================================================================
// Household Schemas
// ============================================================================

export const householdCreateSchema = z.object({
  name: z
    .string()
    .min(1, "Household name is required")
    .max(255)
    .transform((v) => v.trim()),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).optional().default("US"),
});

export type HouseholdCreateInput = z.infer<typeof householdCreateSchema>;

export const householdUpdateSchema = householdCreateSchema.partial();

export type HouseholdUpdateInput = z.infer<typeof householdUpdateSchema>;

// ============================================================================
// Tag Schemas
// ============================================================================

// Named colors supported by the tag picker UI
const tagColorNames = [
  "gray",
  "blue",
  "green",
  "red",
  "yellow",
  "purple",
  "pink",
  "orange",
] as const;

// Color can be either a named color or a hex color
const tagColorSchema = z
  .string()
  .refine(
    (val) =>
      tagColorNames.includes(val as (typeof tagColorNames)[number]) ||
      /^#[0-9A-Fa-f]{6}$/.test(val),
    "Color must be a valid color name or hex color (e.g., 'blue' or '#0000FF')"
  );

export const tagCreateSchema = z.object({
  name: z
    .string()
    .min(1, "Tag name is required")
    .max(100)
    .transform((v) => v.trim()),
  color: tagColorSchema.optional(),
});

export type TagCreateInput = z.infer<typeof tagCreateSchema>;

export const tagUpdateSchema = z.object({
  name: z
    .string()
    .min(1, "Tag name is required")
    .max(100)
    .transform((v) => v.trim())
    .optional(),
  color: tagColorSchema.nullish(),
});

export type TagUpdateInput = z.infer<typeof tagUpdateSchema>;

// ============================================================================
// Assessment Schemas (4 C's)
// ============================================================================

const scoreSchema = z.number().int().min(1).max(5);

export const assessmentCreateSchema = z.object({
  personId: z.string().uuid(),
  committedScore: scoreSchema,
  committedNotes: z.string().optional(),
  compelledScore: scoreSchema,
  compelledNotes: z.string().optional(),
  contagiousScore: scoreSchema,
  contagiousNotes: z.string().optional(),
  courageousScore: scoreSchema,
  courageousNotes: z.string().optional(),
  assessmentDate: z.coerce.date(),
});

export type AssessmentCreateInput = z.infer<typeof assessmentCreateSchema>;

// ============================================================================
// Interview Schemas
// ============================================================================

export const interviewCreateSchema = z.object({
  personId: z.string().uuid(),
  interviewDate: z.coerce.date(),
  maturityStatus: interviewStatusSchema,
  maturityNotes: z.string().optional(),
  giftedStatus: interviewStatusSchema,
  giftedNotes: z.string().optional(),
  chemistryStatus: interviewStatusSchema,
  chemistryNotes: z.string().optional(),
  rightReasonsStatus: interviewStatusSchema,
  rightReasonsNotes: z.string().optional(),
  seasonStatus: interviewStatusSchema,
  seasonNotes: z.string().optional(),
  overallResult: interviewResultSchema,
  nextSteps: z.string().optional(),
});

export type InterviewCreateInput = z.infer<typeof interviewCreateSchema>;

// ============================================================================
// Commitment Schemas
// ============================================================================

export const commitmentCreateSchema = z.object({
  personId: z.string().uuid(),
  commitmentType: commitmentTypeSchema,
  signedDate: z.coerce.date(),
  witnessedBy: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export type CommitmentCreateInput = z.infer<typeof commitmentCreateSchema>;

// ============================================================================
// Skills Schemas
// ============================================================================

export const skillCreateSchema = z.object({
  personId: z.string().uuid(),
  skillCategory: skillCategorySchema,
  skillName: z
    .string()
    .min(1, "Skill name is required")
    .max(100)
    .transform((v) => v.trim()),
  proficiency: skillProficiencySchema.optional(),
  notes: z.string().optional(),
});

export type SkillCreateInput = z.infer<typeof skillCreateSchema>;

// ============================================================================
// Activity / Note Schemas
// ============================================================================

export const noteCreateSchema = z.object({
  personId: z.string().uuid(),
  content: z.string().min(1, "Note content is required"),
});

export type NoteCreateInput = z.infer<typeof noteCreateSchema>;

// ============================================================================
// Status Change Schema
// ============================================================================

export const statusChangeSchema = z.object({
  personId: z.string().uuid(),
  newStatus: personStatusSchema,
  reason: z.string().optional(),
});

export type StatusChangeInput = z.infer<typeof statusChangeSchema>;
