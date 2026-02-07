# People / CRM Management – Implementation Checklist

## Phase 1: Foundation (Schema & Types)

### Database Schema
- [x] P-001a: Create `src/db/schema/people.ts` with Person table
- [x] P-001b: Create enums (personStatuses, personSources, householdRoles)
- [x] P-001c: Create Household table
- [x] P-001d: Create Tag table
- [x] P-001e: Create PersonTag junction table
- [x] P-001f: Create Assessment table (4 C's)
- [x] P-001g: Create Interview table
- [x] P-001h: Create Commitment table
- [x] P-001i: Create SkillsInventory table
- [x] P-001j: Export all tables from `src/db/schema/index.ts`
- [x] P-001k: Generate and run migration

### Validation Schemas
- [x] P-002a: Create `src/lib/validations/people.ts` with Zod schemas
- [x] P-002b: Create personCreateSchema
- [x] P-002c: Create personUpdateSchema
- [x] P-002d: Create personSearchParamsSchema

### Types
- [x] P-002e: Create `src/lib/people/types.ts` with TypeScript types
- [x] P-002f: Export Person, Household, Tag types from Drizzle inference

---

## Phase 2: Core CRUD Operations

### Service Layer
- [x] P-001: Create `src/lib/people/service.ts`
  - [x] createPerson()
  - [x] getPerson()
  - [x] updatePerson()
  - [x] deletePerson() (soft delete)
  - [x] listPeople() with pagination
  - [x] restorePerson() (bonus)

### Server Actions
- [x] P-001: Create `src/app/(dashboard)/people/actions.ts`
  - [x] createPersonAction
  - [x] updatePersonAction
  - [x] deletePersonAction

---

## Phase 3: List View (P-005, P-006)

### Page & Layout
- [x] P-006a: Create `src/app/(dashboard)/people/page.tsx` (People List)
- [x] P-006b: Create `src/app/(dashboard)/people/layout.tsx`

### Components
- [x] P-006c: Create `src/components/people/people-list.tsx`
- [x] P-006d: Create `src/components/people/person-card.tsx`
- [x] P-006e: Create `src/components/people/people-filters.tsx`
- [x] P-006f: Create `src/components/people/people-search.tsx`

### Search & Filter (P-005)
- [x] P-005a: Implement name search (first/last name)
- [x] P-005b: Implement email search
- [x] P-005c: Implement phone search
- [x] P-005d: Implement status filter
- [ ] P-005e: Implement tag filter (Phase 7)
- [x] P-005f: Implement source filter
- [x] P-005g: Create `src/lib/people/search.ts` service

### Pagination
- [x] P-006f: Implement cursor-based pagination
- [x] P-006g: Display total count

### Navigation
- [x] Enable People & CRM nav item in sidebar

---

## Phase 4: Pipeline View (P-007)

### Components
- [x] P-007a: Create `src/components/people/pipeline-view.tsx` (Kanban board)
- [x] P-007b: Create `src/components/people/pipeline-column.tsx`
- [x] P-007c: Create `src/components/people/pipeline-card.tsx`

### Functionality
- [x] P-007d: Implement drag-and-drop between columns
- [x] P-007e: Implement status count per column
- [x] P-007f: Create status change action for drag-drop

### View Toggle
- [x] P-007g: Add List/Pipeline view toggle to people page

---

## Phase 5: Person Detail View (P-008)

### Page
- [x] P-008a: Create `src/app/(dashboard)/people/[id]/page.tsx`
- [x] P-008b: Create `src/app/(dashboard)/people/[id]/layout.tsx` (with tabs)

### Components
- [x] P-008c: Create `src/components/people/person-header.tsx`
- [x] P-008d: Create `src/components/people/person-overview.tsx`
- [x] P-008e: Create `src/components/people/person-tabs.tsx`

### Contact Information (P-002)
- [x] P-002: Display all contact fields (name, email, phone, address)
- [x] P-002: Edit contact information inline or via modal

### Status Display (P-003)
- [x] P-003: Display current status with badge
- [x] P-003: Show status progression timeline

### Source Tracking (P-004)
- [x] P-004: Display source and source details
- [x] P-004: Allow source editing

---

## Phase 6: Activity Timeline & Notes (P-009, P-010)

### Activity Timeline (P-009)
- [x] P-009a: Create `src/components/people/activity-timeline.tsx`
- [x] P-009b: Create `src/lib/people/activity.ts` service
- [x] P-009c: Define activity types (status_change, note_added, interview_completed, etc.)
- [x] P-009d: Store activities in database (PersonActivity table)
- [x] P-009e: Display chronological activity list

### Note Adding (P-010)
- [x] P-010a: Create `src/components/people/note-form.tsx`
- [x] P-010b: Create addNoteAction server action
- [x] P-010c: Display notes in activity timeline
- [x] P-010d: Support note editing/deletion

---

## Phase 7: Tags System (P-011)

### Tag CRUD
- [x] P-011a: Create `src/lib/people/tags.ts` service
  - [x] createTag()
  - [x] listTags()
  - [x] deleteTag()
- [x] P-011b: Create tag management actions

### Tag Assignment
- [x] P-011c: Create `src/components/people/tag-picker.tsx`
- [x] P-011d: Create assignTagAction / removeTagAction
- [x] P-011e: Display tags on person card and detail view

### Tag Filtering
- [x] P-011f: Integrate tag filter into people list
- [x] P-011g: Support multi-tag filtering (AND logic)

---

## Phase 8: Status Progression (P-012)

### Status Change Logic
- [x] P-012a: Create `src/lib/people/status.ts` service
- [x] P-012b: Implement validateStatusTransition()
- [x] P-012c: Implement changeStatus() with activity logging
- [x] P-012d: Implement soft validation warnings (non-blocking)

### Manual Override
- [x] P-012e: Create status change modal with confirmation
- [x] P-012f: Log manual status changes with reason

### Automatic Progression (PARTIAL - F3/F8 dependent)
- [x] P-012g: Create event handler stubs for external events
- [ ] P-012h: DEFERRED: `vision_meeting.attendance.recorded` handler (depends on F3)
- [ ] P-012i: DEFERRED: `team.member.assigned` handler (depends on F8)
- [ ] P-012j: DEFERRED: `team.leader.assigned` handler (depends on F8)

### Status Events Emission
- [x] P-012k: Emit `person.created` event (stubbed)
- [x] P-012l: Emit `person.status.changed` event (stubbed)

---

## Phase 9: Assessments (P-013, P-014)

### 4 C's Assessment (P-013)
- [x] P-013a: Create `src/components/people/assessment-form.tsx`
- [x] P-013b: Create createAssessmentAction
- [x] P-013c: Display assessment history
- [x] P-013d: Show overall score and trend

### Interview Tracking (P-014)
- [x] P-014a: Create `src/components/people/interview-form.tsx`
- [x] P-014b: Create createInterviewAction
- [x] P-014c: Auto-advance to `interviewed` status on save
- [x] P-014d: Display interview history

### Assessments Tab
- [x] P-014e: Create `src/app/(dashboard)/people/[id]/assessments/page.tsx`

---

## Phase 10: Commitments (P-015)

### Commitment Recording
- [x] P-015a: Create `src/components/people/commitment-form.tsx`
- [x] P-015b: Create recordCommitmentAction
- [x] P-015c: Auto-advance to `committed` status on save
- [x] P-015d: Display commitment history

### Document Upload (Optional)
- [x] P-015e: Support document upload for signed commitment card

---

## Phase 11: Household & Skills (P-016, P-023)

### Household Grouping (P-023)
- [x] P-023a: Create `src/lib/people/household.ts` service
- [x] P-023b: Create `src/components/people/household-manager.tsx`
- [x] P-023c: Create/link household actions
- [x] P-023d: Display household members on person detail
- [x] P-023e: Support address propagation to household members

### Skills Inventory (P-016)
- [x] P-016a: Create `src/components/people/skills-form.tsx`
- [x] P-016b: Create skills CRUD actions
- [x] P-016c: Display skills on person profile
- [ ] P-016d: Filter by skills in list view (future)

---

## Phase 12: Advanced Features (P-017, P-018, P-019, P-020)

### Quick Add (P-019)
- [x] P-019a: Create `src/components/people/quick-add-form.tsx`
- [x] P-019b: Implement "Save & Add Another" flow
- [x] P-019c: Add Quick Add button to people list header

### Duplicate Detection (P-018)
- [x] P-018a: Implement email duplicate check on create
- [x] P-018b: Implement fuzzy name+phone duplicate detection
- [x] P-018c: Create `src/components/people/duplicate-warning.tsx`
- [ ] P-018d: DEFERRED (P-025): Potential duplicates view for batch review

### Bulk Import (P-017)
- [x] P-017a: Create CSV template download
- [x] P-017b: Create `src/components/people/import-wizard.tsx`
- [x] P-017c: Implement CSV parsing and validation
- [x] P-017d: Implement preview with duplicate detection
- [x] P-017e: Create bulk import action

### Conversion Metrics (P-020) — DEFERRED
- [x] P-020a: Create `src/lib/people/metrics.ts` service (exists, not wired up)
- [x] P-020b: Calculate conversion rates between statuses (exists, not wired up)
- [ ] P-020c: DEFERRED: Display metrics in pipeline view footer — needs design revisit (all-time rates become misleading over time; consider time-windowed or cohort-based approach)

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

- [x] Update `memory/contracts/db.md` with Person schema
- [x] Update `memory/entrypoints.md` with people routes and actions (after Phase 2-3)
- [x] Create `memory/flows/person-status.mmd` for status progression flow (after Phase 8)

---

## Testing Checkpoints

After each phase, verify:
- [ ] TypeScript compiles without errors
- [ ] Linter passes
- [ ] Database migrations run successfully
- [ ] UI renders correctly
- [ ] Server actions work with proper auth
