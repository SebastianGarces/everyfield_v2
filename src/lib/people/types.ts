// Re-export database types for convenience
export type {
  ActivityType,
  Assessment,
  Commitment,
  CommitmentType,
  Household,
  HouseholdRole,
  Interview,
  InterviewResult,
  InterviewStatus,
  NewAssessment,
  NewCommitment,
  NewHousehold,
  NewInterview,
  NewPerson,
  NewPersonActivity,
  NewPersonTag,
  NewSkillInventory,
  NewTag,
  // Tables
  Person,
  PersonActivity,
  PersonSource,
  // Enums
  PersonStatus,
  PersonTag,
  SkillCategory,
  SkillInventory,
  SkillProficiency,
  Tag,
} from "@/db/schema";

// Re-export enum arrays for use in components
export {
  activityTypes,
  commitmentTypes,
  householdRoles,
  interviewResults,
  interviewStatuses,
  personSources,
  personStatuses,
  skillCategories,
  skillProficiencies,
} from "@/db/schema";

// ============================================================================
// Extended Types
// ============================================================================

import type { Household, Person, PersonActivity, Tag } from "@/db/schema";

/**
 * Person with related data for list views
 */
export type PersonWithTags = Person & {
  tags: Tag[];
};

/**
 * Person with full related data for detail view
 */
export type PersonWithRelations = Person & {
  tags: Tag[];
  household: Household | null;
  householdMembers: Person[];
};

/**
 * Activity with metadata parsed
 */
export type ActivityWithMeta<
  T extends Record<string, unknown> = Record<string, unknown>,
> = PersonActivity & {
  metadata: T | null;
};

/**
 * Status change activity metadata
 */
export type StatusChangeMetadata = {
  oldStatus: string;
  newStatus: string;
  reason?: string;
};

/**
 * Note activity metadata
 */
export type NoteMetadata = {
  content: string;
};

// ============================================================================
// List & Search Types
// ============================================================================

/**
 * Paginated result with cursor
 */
export type PaginatedResult<T> = {
  data: T[];
  total: number;
  nextCursor: string | null;
};

/**
 * Search result for people
 */
export type PersonSearchResult = PaginatedResult<PersonWithTags>;

// ============================================================================
// Pipeline Types
// ============================================================================

import type { PersonStatus } from "@/db/schema";

/**
 * Pipeline column definition
 */
export type PipelineColumn = {
  id: string;
  title: string;
  statuses: PersonStatus[];
  count: number;
};

/**
 * Pipeline data for kanban view
 */
export type PipelineData = {
  columns: PipelineColumn[];
  people: Record<string, PersonWithTags[]>;
};

// ============================================================================
// Status Transition Types
// ============================================================================

/**
 * Result of validating a status transition
 */
export type StatusTransition = {
  from: PersonStatus;
  to: PersonStatus;
  warnings: string[];
  requiresConfirmation: boolean;
  skippedStatuses: PersonStatus[];
};

// ============================================================================
// Duplicate Detection Types
// ============================================================================

/**
 * Result of checking for duplicate persons
 */
export type DuplicateCheck = {
  exactMatch: PersonWithTags | null;
  potentialMatches: PersonWithTags[];
};

// ============================================================================
// Metrics Types
// ============================================================================

/**
 * Pipeline conversion metrics
 */
export type PipelineMetrics = {
  statusCounts: Partial<Record<PersonStatus, number>>;
  conversions: {
    from: PersonStatus;
    to: PersonStatus;
    rate: number; // 0-1
    count: number;
    total: number; // total people in source status (for display)
  }[];
};

// ============================================================================
// Import Types
// ============================================================================

/**
 * A single row from CSV import, after parsing and validation
 */
export type ImportRow = {
  rowNumber: number;
  data: Record<string, string>;
  valid: boolean;
  errors: string[];
  duplicates: DuplicateCheck;
};

/**
 * Preview of a CSV import before execution
 */
export type ImportPreview = {
  totalRows: number;
  validRows: ImportRow[];
  invalidRows: ImportRow[];
  duplicateRows: ImportRow[];
};

/**
 * Summary of completed import
 */
export type ImportSummary = {
  created: number;
  skipped: number;
  errors: number;
};

// ============================================================================
// Form State Types
// ============================================================================

/**
 * Server action result type
 */
export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };
