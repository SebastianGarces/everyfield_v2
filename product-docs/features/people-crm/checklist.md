# People / CRM Management – Implementation Checklist

## Phase 1: Foundation (Schema & Types)

### Database Schema
- [ ] P-001a: Create `src/db/schema/people.ts` with Person table
- [ ] P-001b: Create enums (personStatuses, personSources, householdRoles)
- [ ] P-001c: Create Household table
- [ ] P-001d: Create Tag table
- [ ] P-001e: Create PersonTag junction table
- [ ] P-001f: Create Assessment table (4 C's)
- [ ] P-001g: Create Interview table
- [ ] P-001h: Create Commitment table
- [ ] P-001i: Create SkillsInventory table
- [ ] P-001j: Export all tables from `src/db/schema/index.ts`
- [ ] P-001k: Generate and run migration

### Validation Schemas
- [ ] P-002a: Create `src/lib/validations/people.ts` with Zod schemas
- [ ] P-002b: Create personCreateSchema
- [ ] P-002c: Create personUpdateSchema
- [ ] P-002d: Create personSearchParamsSchema

### Types
- [ ] P-002e: Create `src/lib/people/types.ts` with TypeScript types
- [ ] P-002f: Export Person, Household, Tag types from Drizzle inference

---

## Phase 2: Core CRUD Operations

### Service Layer
- [ ] P-001: Create `src/lib/people/service.ts`
  - [ ] createPerson()
  - [ ] getPerson()
  - [ ] updatePerson()
  - [ ] deletePerson() (soft delete)
  - [ ] listPeople() with pagination

### Server Actions
- [ ] P-001: Create `src/app/(dashboard)/people/actions.ts`
  - [ ] createPersonAction
  - [ ] updatePersonAction
  - [ ] deletePersonAction

---

## Phase 3: List View (P-005, P-006)

### Page & Layout
- [ ] P-006a: Create `src/app/(dashboard)/people/page.tsx` (People List)
- [ ] P-006b: Create `src/app/(dashboard)/people/layout.tsx`

### Components
- [ ] P-006c: Create `src/components/people/people-list.tsx`
- [ ] P-006d: Create `src/components/people/person-card.tsx`
- [ ] P-006e: Create `src/components/people/people-filters.tsx`

### Search & Filter (P-005)
- [ ] P-005a: Implement name search (first/last name)
- [ ] P-005b: Implement email search
- [ ] P-005c: Implement phone search
- [ ] P-005d: Implement status filter
- [ ] P-005e: Implement tag filter
- [ ] P-005f: Implement source filter
- [ ] P-005g: Create `src/lib/people/search.ts` service

### Pagination
- [ ] P-006f: Implement cursor-based pagination
- [ ] P-006g: Display total count

---

## Phase 4: Pipeline View (P-007)

### Components
- [ ] P-007a: Create `src/components/people/pipeline-view.tsx` (Kanban board)
- [ ] P-007b: Create `src/components/people/pipeline-column.tsx`
- [ ] P-007c: Create `src/components/people/pipeline-card.tsx`

### Functionality
- [ ] P-007d: Implement drag-and-drop between columns
- [ ] P-007e: Implement status count per column
- [ ] P-007f: Create status change action for drag-drop

### View Toggle
- [ ] P-007g: Add List/Pipeline view toggle to people page

---

## Phase 5: Person Detail View (P-008)

### Page
- [ ] P-008a: Create `src/app/(dashboard)/people/[id]/page.tsx`
- [ ] P-008b: Create `src/app/(dashboard)/people/[id]/layout.tsx` (with tabs)

### Components
- [ ] P-008c: Create `src/components/people/person-header.tsx`
- [ ] P-008d: Create `src/components/people/person-overview.tsx`
- [ ] P-008e: Create `src/components/people/person-tabs.tsx`

### Contact Information (P-002)
- [ ] P-002: Display all contact fields (name, email, phone, address)
- [ ] P-002: Edit contact information inline or via modal

### Status Display (P-003)
- [ ] P-003: Display current status with badge
- [ ] P-003: Show status progression timeline

### Source Tracking (P-004)
- [ ] P-004: Display source and source details
- [ ] P-004: Allow source editing

---

## Phase 6: Activity Timeline & Notes (P-009, P-010)

### Activity Timeline (P-009)
- [ ] P-009a: Create `src/components/people/activity-timeline.tsx`
- [ ] P-009b: Create `src/lib/people/activity.ts` service
- [ ] P-009c: Define activity types (status_change, note_added, interview_completed, etc.)
- [ ] P-009d: Store activities in database (PersonActivity table)
- [ ] P-009e: Display chronological activity list

### Note Adding (P-010)
- [ ] P-010a: Create `src/components/people/note-form.tsx`
- [ ] P-010b: Create addNoteAction server action
- [ ] P-010c: Display notes in activity timeline
- [ ] P-010d: Support note editing/deletion

---

## Phase 7: Tags System (P-011)

### Tag CRUD
- [ ] P-011a: Create `src/lib/people/tags.ts` service
  - [ ] createTag()
  - [ ] listTags()
  - [ ] deleteTag()
- [ ] P-011b: Create tag management actions

### Tag Assignment
- [ ] P-011c: Create `src/components/people/tag-picker.tsx`
- [ ] P-011d: Create assignTagAction / removeTagAction
- [ ] P-011e: Display tags on person card and detail view

### Tag Filtering
- [ ] P-011f: Integrate tag filter into people list
- [ ] P-011g: Support multi-tag filtering (AND/OR logic)

---

## Phase 8: Status Progression (P-012)

### Status Change Logic
- [ ] P-012a: Create `src/lib/people/status.ts` service
- [ ] P-012b: Implement validateStatusTransition()
- [ ] P-012c: Implement changeStatus() with activity logging
- [ ] P-012d: Implement soft validation warnings (non-blocking)

### Manual Override
- [ ] P-012e: Create status change modal with confirmation
- [ ] P-012f: Log manual status changes with reason

### Automatic Progression (PARTIAL - F3/F8 dependent)
- [ ] P-012g: Create event handler stubs for external events
- [ ] P-012h: DEFERRED: `vision_meeting.attendance.recorded` handler (depends on F3)
- [ ] P-012i: DEFERRED: `team.member.assigned` handler (depends on F8)
- [ ] P-012j: DEFERRED: `team.leader.assigned` handler (depends on F8)

### Status Events Emission
- [ ] P-012k: Emit `person.created` event
- [ ] P-012l: Emit `person.status.changed` event

---

## Phase 9: Assessments (P-013, P-014)

### 4 C's Assessment (P-013)
- [ ] P-013a: Create `src/components/people/assessment-form.tsx`
- [ ] P-013b: Create createAssessmentAction
- [ ] P-013c: Display assessment history
- [ ] P-013d: Show overall score and trend

### Interview Tracking (P-014)
- [ ] P-014a: Create `src/components/people/interview-form.tsx`
- [ ] P-014b: Create createInterviewAction
- [ ] P-014c: Auto-advance to `interviewed` status on save
- [ ] P-014d: Display interview history

### Assessments Tab
- [ ] P-014e: Create `src/app/(dashboard)/people/[id]/assessments/page.tsx`

---

## Phase 10: Commitments (P-015)

### Commitment Recording
- [ ] P-015a: Create `src/components/people/commitment-form.tsx`
- [ ] P-015b: Create recordCommitmentAction
- [ ] P-015c: Auto-advance to `committed` status on save
- [ ] P-015d: Display commitment history

### Document Upload (Optional)
- [ ] P-015e: Support document upload for signed commitment card

---

## Phase 11: Household & Skills (P-016, P-023)

### Household Grouping (P-023)
- [ ] P-023a: Create `src/lib/people/household.ts` service
- [ ] P-023b: Create `src/components/people/household-manager.tsx`
- [ ] P-023c: Create/link household actions
- [ ] P-023d: Display household members on person detail
- [ ] P-023e: Support address propagation to household members

### Skills Inventory (P-016)
- [ ] P-016a: Create `src/components/people/skills-form.tsx`
- [ ] P-016b: Create skills CRUD actions
- [ ] P-016c: Display skills on person profile
- [ ] P-016d: Filter by skills in list view (future)

---

## Phase 12: Advanced Features (P-017, P-018, P-019, P-020)

### Quick Add (P-019)
- [ ] P-019a: Create `src/components/people/quick-add-form.tsx`
- [ ] P-019b: Implement "Save & Add Another" flow
- [ ] P-019c: Add Quick Add button to people list header

### Duplicate Detection (P-018)
- [ ] P-018a: Implement email duplicate check on create
- [ ] P-018b: Implement fuzzy name+phone duplicate detection
- [ ] P-018c: Create `src/components/people/duplicate-warning.tsx`
- [ ] P-018d: DEFERRED (P-025): Potential duplicates view for batch review

### Bulk Import (P-017)
- [ ] P-017a: Create CSV template download
- [ ] P-017b: Create `src/components/people/import-wizard.tsx`
- [ ] P-017c: Implement CSV parsing and validation
- [ ] P-017d: Implement preview with duplicate detection
- [ ] P-017e: Create bulk import action

### Conversion Metrics (P-020)
- [ ] P-020a: Create `src/lib/people/metrics.ts` service
- [ ] P-020b: Calculate conversion rates between statuses
- [ ] P-020c: Display metrics in pipeline view footer

---

## Phase 13: Profile Enhancements (P-021, P-022, P-024)

### Photo Support (P-024)
- [ ] P-024a: Add photo upload to person form
- [ ] P-024b: Display avatar in list views (48-64px)
- [ ] P-024c: Display larger photo on profile (128-256px)

### Team Assignment Visibility (P-021)
- [ ] P-021: DEFERRED - Display team assignments (depends on F8)
- [ ] P-021a: Create placeholder Teams & Training tab
- [ ] P-021b: Stub team display component

### Training Status Display (P-022)
- [ ] P-022: DEFERRED - Display training completion (depends on F8)

---

## Phase 14: Integration Event Handlers

### Event Emission
- [ ] Create event emitter utility
- [ ] Emit `person.created` on person creation
- [ ] Emit `person.status.changed` on status changes

### Inbound Event Handlers (DEFERRED)
- [ ] DEFERRED: Handle `vision_meeting.attendance.recorded` from F3
- [ ] DEFERRED: Handle `team.member.assigned` from F8
- [ ] DEFERRED: Handle `team.leader.assigned` from F8

---

## Nice to Have (Future)

- [ ] P-026: External ChMS sync (Planning Center, Breeze)
- [ ] P-027: Bulk export (CSV)
- [ ] P-028: Custom fields (church-defined)
- [ ] P-029: Communication preferences
- [ ] P-030: Birthday/anniversary tracking
- [ ] P-031: Group orientations support

---

## Memory Updates Required

- [ ] Update `memory/contracts/db.md` with Person schema
- [ ] Update `memory/entrypoints.md` with people routes and actions
- [ ] Create `memory/flows/person-status.mmd` for status progression flow

---

## Testing Checkpoints

After each phase, verify:
- [ ] TypeScript compiles without errors
- [ ] Linter passes
- [ ] Database migrations run successfully
- [ ] UI renders correctly
- [ ] Server actions work with proper auth
