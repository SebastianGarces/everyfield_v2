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

import type { Person, PersonActivity, Tag } from "@/db/schema";

import { personPhotoSrc } from "@/lib/profile-photo";

/**
 * A person as ANY CLIENT SURFACE may receive them — the shape the people
 * domain hands out.
 *
 * TWO COLUMNS ARE WITHHELD, for one reason. In the App Router a person row
 * handed to a `"use client"` component crosses to the browser WHOLE in the RSC
 * payload — every column, drawn or not — and so does a Server Action's RETURN
 * VALUE. So the rule is never "don't render it", it is "don't send it".
 *
 *  - `user_id` (#378) is an account identifier. Nothing any surface draws needs
 *    it, so it would ride along on every row, every profile and every mutation
 *    response for no reason at all.
 *  - `photo_url` (#654) is a PRIVATE-BUCKET STORAGE KEY despite its name. The
 *    photo route trusts the key it reads precisely because no client-supplied
 *    value can reach it, and no signed URL is ever minted because a signed URL
 *    is a bearer token anybody who copied it out of the markup could use.
 *
 * `photoSrc` REPLACES IT, and replacing is what makes this safe rather than
 * merely narrower. Every surface that drew a face needed one fact from that
 * column — where to fetch the picture — so handing over the resolved route
 * leaves nothing for a caller to miss and no reason to reach for the row again.
 * `undefined` means no picture, which is the second fact those surfaces need; a
 * boolean beside it would be a prop that can disagree with the route.
 *
 * WITHHELD RATHER THAN MERELY UNTYPED, and that distinction used to be the
 * whole point: `Person` was STRUCTURALLY ASSIGNABLE to `Omit<Person, "userId">`,
 * so a full row passed for the narrow type at every call site and `tsc` said
 * nothing. That is exactly how it shipped once — `checkForDuplicates` SPREAD a
 * full row into a value typed `PersonWithTags` and carried the column into the
 * quick-add dialog while the signature swore it was gone. `photoSrc` closes
 * that hole as a side effect: it is a key `Person` does not have, so a raw row
 * no longer satisfies this type and the compiler says so. The runtime strip is
 * still what makes the claim TRUE — an excess property survives structural
 * assignment — which is why the ratchets below it stay.
 *
 * `user_id` stays a SQL-level concern: `person-user.ts` asks about it in a
 * predicate, `create-church.ts` writes it in an upsert target, and
 * `leadership-fill.ts` joins through it. `photo_url` likewise — the writer in
 * `service.ts` and the reader in the photo route. No caller reads either off a
 * fetched row, which is why the domain reads below can decline them outright.
 */
export type PersonForClient = Omit<Person, "userId" | "photoUrl"> & {
  /** The ROUTE the photo is served from, or `undefined` for a person with none. */
  photoSrc: string | undefined;
};

/**
 * Drop the account link, trade the storage key for its route — the ONE spelling
 * of the strip (#378, #654).
 *
 * Generic over the row so a decorated person keeps its decorations:
 * `toPersonForClient({ ...person, tags })` is a `PersonWithTags`, which is what
 * the duplicate check and the pipeline hand their consumers.
 *
 * ONE FUNCTION FOR BOTH COLUMNS rather than a second pass for the photo,
 * because there is exactly one moment a person row stops being a database row
 * and becomes something a browser may hold, and every rule about that crossing
 * belongs at it. A `resolvePhotoSrc` beside this would be a second thing to
 * remember at every call site — and the call site that forgot it would be the
 * leak.
 *
 * It removes the KEYS rather than blanking the values, because the RSC
 * serializer carries a key that exists — `{ userId: undefined }` still ships
 * the column name. It also copies rather than mutates: `createPerson` emits
 * `person.created` from the full row it just wrote and strips only what it
 * RETURNS.
 */
export function toPersonForClient<T extends Person>(
  row: T
): Omit<T, "userId" | "photoUrl"> & { photoSrc: string | undefined } {
  const { userId: _accountLink, photoUrl, ...forClient } = row;
  return { ...forClient, photoSrc: personPhotoSrc(row.id, photoUrl) };
}

/**
 * Person with related data for list views
 */
export type PersonWithTags = PersonForClient & {
  tags: Tag[];
  lastActivityAt?: Date | null;
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
  merged: number;
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
