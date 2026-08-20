// Re-export database types for convenience
export type {
  ActivityType,
  Assessment,
  BackgroundCheckStatus,
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
  backgroundCheckStatuses,
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
 * A person as a LIST SURFACE may receive them.
 *
 * `user_id` is withheld (#378). It is an account identifier, every list below
 * is rendered by a `"use client"` component, and nothing any of them draw needs
 * it — so it would cross to the browser in the RSC payload of every row for no
 * reason at all. Withheld rather than merely untyped: a type cannot stop an
 * extra property at runtime, so the READS strip it (`pipeline.ts` omits the
 * column, `listPeople` drops it) and this type is what says they must.
 *
 * A server-side caller that genuinely needs the link reads the person row
 * directly — `getPerson`, or the church-scoped lookup in
 * `ministry-teams/leadership-fill.ts` — rather than widening a list.
 */
export type PersonForList = Omit<Person, "userId">;

/**
 * Person with related data for list views
 */
export type PersonWithTags = PersonForList & {
  tags: Tag[];
  lastActivityAt?: Date | null;
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
// Creation Source
// ============================================================================

/**
 * The closed set of paths that create a person. `createPerson()` is the ONE
 * writer of the `person_created` timeline entry (ruling 410-2A), so this
 * label is the only thing that tells the paths apart in the activity
 * metadata the dashboard and timeline read. No default anywhere — every new
 * creation path must name itself here or it does not compile.
 */
export type PersonCreationSource =
  | "form"
  | "quick_add"
  | "bulk_import"
  | "meeting_attendance"
  | "meeting_guest_list";

// ============================================================================
// Duplicate Detection Types
// ============================================================================

/**
 * The raw duplicate matches — full person rows, no tags. This shape never
 * leaves the server; the import preview redacts it via
 * `toImportRowDuplicates` before anything crosses to the client.
 */
export type DuplicateMatches = {
  exactMatch: Person | null;
  potentialMatches: Person[];
};

/**
 * Result of checking for duplicate persons, decorated with tags for the
 * quick-add dialog (the one consumer that renders them).
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
 * A duplicate match as it travels to the import wizard (ruling 410-3C):
 * just enough to explain the match — never the matched contact's full
 * record. Anything server-side that needs the real record resolves it
 * by `id`.
 */
export type ImportDuplicateMatch = {
  id: string;
  displayName: string;
};

/**
 * The redacted duplicate-check shape carried on an import row.
 */
export type ImportRowDuplicates = {
  exactMatch: ImportDuplicateMatch | null;
  potentialMatches: ImportDuplicateMatch[];
};

/**
 * A single row from CSV import, after parsing and validation
 */
export type ImportRow = {
  rowNumber: number;
  data: Record<string, string>;
  valid: boolean;
  errors: string[];
  duplicates: ImportRowDuplicates;
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
