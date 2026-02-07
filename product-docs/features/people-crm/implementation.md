# People / CRM Management – Implementation Plan

**FRD:** `product-docs/features/people-crm/frd.md`  
**Feature Code:** F2  
**Date Created:** February 3, 2026  
**Status:** Ready for Implementation

---

## Overview

This implementation plan breaks the People/CRM feature (F2) into 12 digestible phases that can be executed sequentially by agents. Each phase is designed to be completable in a focused session (1-3 files of changes).

### Critical Context

**This is the FIRST major feature after Wiki (F1).**

- Vision Meetings (F3) and Ministry Teams (F8) do not exist yet
- Status progressions dependent on F3/F8 events require **manual fallback**
- Event handlers for external features are **stubbed** for future integration
- The implementation must be **self-contained and work standalone**

### Deferred Items (Depends on F3/F8)

| Item | Dependency | Manual Fallback |
|------|------------|-----------------|
| Auto-advance `prospect` → `attendee` | F3: `vision_meeting.attendance.recorded` | Manual status change or note-based trigger |
| Auto-advance `core_group` → `launch_team` | F8: `team.member.assigned` | Manual status change |
| Auto-advance to `leader` | F8: `team.leader.assigned` | Manual status change |
| Team assignment visibility (P-021) | F8 schema | Show "No teams assigned" placeholder |
| Training status display (P-022) | F8 schema | Show "Training not available" placeholder |

---

## Technology Patterns

| Concern | Pattern | Location |
|---------|---------|----------|
| Database Schema | Drizzle ORM tables | `src/db/schema/people.ts` |
| Validation | Zod schemas | `src/lib/validations/people.ts` |
| Service Functions | Async functions with church_id scoping | `src/lib/people/*.ts` |
| Server Actions | `"use server"` functions | `src/app/(dashboard)/people/actions.ts` |
| Pages | React Server Components | `src/app/(dashboard)/people/**/*.tsx` |
| Components | Client/Server as needed | `src/components/people/*.tsx` |

---

## Phase 1: Foundation – Schema & Types

**Goal:** Establish database schema, enums, types, and validation schemas.

**Risk Level:** HIGH (database schema)

**Requirements Covered:** P-001, P-002, P-003, P-004

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/db/schema/people.ts` | All People/CRM database tables |
| MODIFY | `src/db/schema/index.ts` | Export people schema |
| CREATE | `src/lib/validations/people.ts` | Zod validation schemas |
| CREATE | `src/lib/people/types.ts` | TypeScript types |
| CREATE | `src/lib/people/index.ts` | Barrel export |

### Database Schema

```typescript
// src/db/schema/people.ts

// Enums
export const personStatuses = [
  "prospect",
  "attendee", 
  "following_up",
  "interviewed",
  "committed",
  "core_group",
  "launch_team",
  "leader",
] as const;

export const personSources = [
  "personal_referral",
  "social_media",
  "vision_meeting",
  "website",
  "event",
  "partner_church",
  "other",
] as const;

export const householdRoles = ["head", "spouse", "child", "other"] as const;

export const interviewStatuses = ["pass", "fail", "concern"] as const;

export const interviewResults = [
  "qualified",
  "qualified_with_notes", 
  "not_qualified",
  "follow_up",
] as const;

export const commitmentTypes = ["core_group", "launch_team"] as const;

export const skillCategories = [
  "worship",
  "tech",
  "admin",
  "teaching",
  "hospitality",
  "leadership",
  "other",
] as const;

export const skillProficiencies = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
] as const;

// Tables: households, persons, tags, personTags, assessments, 
// interviews, commitments, skillsInventory, personActivities
```

### Tables Overview

| Table | Description | Key Foreign Keys |
|-------|-------------|------------------|
| `households` | Family groupings | `church_id` |
| `persons` | Main person records | `church_id`, `household_id`, `created_by` |
| `tags` | Church-defined tags | `church_id` |
| `person_tags` | Junction table | `person_id`, `tag_id` |
| `assessments` | 4 C's assessments | `person_id`, `assessed_by` |
| `interviews` | 5-criteria interviews | `person_id`, `interviewed_by` |
| `commitments` | Signed commitments | `person_id`, `witnessed_by` |
| `skills_inventory` | Skills and gifts | `person_id` |
| `person_activities` | Activity timeline | `person_id`, `performed_by` |

### Acceptance Criteria

- [ ] All tables created with proper indexes
- [ ] Foreign keys reference existing tables (churches, users)
- [ ] TypeScript types inferred from Drizzle schema
- [ ] Zod schemas validate all input forms
- [ ] Migration runs without errors

### Defer to Later

- Photo URL handling (Phase 11)
- Document upload for commitments (Phase 10)

---

## Phase 2: Core CRUD Operations

**Goal:** Implement basic person service functions and server actions.

**Risk Level:** MEDIUM (new server actions)

**Requirements Covered:** P-001

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/lib/people/service.ts` | Person CRUD service |
| CREATE | `src/app/(dashboard)/people/actions.ts` | Server actions |
| MODIFY | `src/lib/people/index.ts` | Export service |

### Service Functions

```typescript
// src/lib/people/service.ts

export async function createPerson(
  churchId: string,
  userId: string,
  data: PersonCreate
): Promise<Person>

export async function getPerson(
  churchId: string,
  personId: string
): Promise<Person | null>

export async function updatePerson(
  churchId: string,
  personId: string,
  data: PersonUpdate
): Promise<Person>

export async function deletePerson(
  churchId: string,
  personId: string
): Promise<void> // Soft delete via deleted_at

export async function listPeople(
  churchId: string,
  options: ListPeopleOptions
): Promise<{ people: Person[]; total: number; nextCursor?: string }>
```

### Server Actions

```typescript
// src/app/(dashboard)/people/actions.ts
"use server"

export async function createPersonAction(formData: FormData)
export async function updatePersonAction(personId: string, formData: FormData)
export async function deletePersonAction(personId: string)
```

### Acceptance Criteria

- [ ] Create person with all required fields
- [ ] Update person with partial data
- [ ] Soft delete sets `deleted_at` timestamp
- [ ] List excludes soft-deleted records
- [ ] All operations scoped to `church_id`
- [ ] `created_by` populated from session user

### Defer to Later

- Duplicate detection (Phase 12)
- Activity logging (Phase 6)

---

## Phase 3: List View

**Goal:** Display people in a searchable, filterable list.

**Risk Level:** LOW (UI only)

**Requirements Covered:** P-005, P-006

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/app/(dashboard)/people/page.tsx` | People list page |
| CREATE | `src/app/(dashboard)/people/layout.tsx` | Layout with header |
| CREATE | `src/components/people/people-list.tsx` | List component |
| CREATE | `src/components/people/person-card.tsx` | Card for list items |
| CREATE | `src/components/people/people-filters.tsx` | Filter controls |
| CREATE | `src/components/people/index.ts` | Barrel export |
| CREATE | `src/lib/people/search.ts` | Search service |
| MODIFY | `src/components/nav-main.tsx` | Add People nav item |

### Search Service

```typescript
// src/lib/people/search.ts

export interface SearchParams {
  query?: string;        // Name, email, or phone
  status?: PersonStatus[];
  source?: PersonSource[];
  tagIds?: string[];
  cursor?: string;
  limit?: number;
}

export async function searchPeople(
  churchId: string,
  params: SearchParams
): Promise<SearchResult<Person>>
```

### Page Structure

```
/people
├── Header: "People" + [+ Add Person] button
├── Search bar
├── Filter row: [Status ▼] [Tags ▼] [Source ▼]
├── View toggle: [List] [Pipeline] (Pipeline disabled until Phase 4)
├── Results count: "245 total"
└── Person cards (paginated)
```

### Acceptance Criteria

- [ ] Search by name (first or last)
- [ ] Search by email
- [ ] Search by phone
- [ ] Filter by status (multi-select)
- [ ] Filter by source (multi-select)
- [ ] Pagination with cursor
- [ ] Display total count
- [ ] Empty state when no results
- [ ] Loading state while fetching

### Defer to Later

- Tag filtering (Phase 7)
- Pipeline view (Phase 4)
- Team filter (depends on F8)

---

## Phase 4: Pipeline View

**Goal:** Visual kanban board showing people by status.

**Risk Level:** LOW (UI only)

**Requirements Covered:** P-007

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/components/people/pipeline-view.tsx` | Kanban board |
| CREATE | `src/components/people/pipeline-column.tsx` | Status column |
| CREATE | `src/components/people/pipeline-card.tsx` | Draggable card |
| MODIFY | `src/app/(dashboard)/people/page.tsx` | Add view toggle |
| CREATE | `src/lib/people/pipeline.ts` | Pipeline data service |

### Pipeline Columns (6)

| Column | Status Values | Description |
|--------|---------------|-------------|
| Prospect | `prospect` | Initial contacts |
| Attendee | `attendee` | Attended Vision Meeting |
| Following Up | `following_up` | Active follow-up |
| Interviewed | `interviewed` | Interview completed |
| Committed | `committed` | Signed commitment |
| Core Group | `core_group`, `launch_team`, `leader` | Active members with badges |

### Badge Display (Core Group Column)

- 🚀 **Launch Team badge** for `launch_team` status
- ⭐ **Leader badge** for `leader` status

### Drag-and-Drop Behavior

1. User drags card to new column
2. Optimistic UI update
3. Server action changes status
4. Activity logged: "Status changed from X to Y"
5. Rollback on error

### Acceptance Criteria

- [ ] 6 columns with correct statuses
- [ ] Cards display person name, email, source
- [ ] Count shown per column
- [ ] Drag-and-drop changes status
- [ ] Badges shown for launch_team/leader
- [ ] Pipeline/List view toggle works

### Defer to Later

- Conversion rate metrics (Phase 12)
- Column filtering (future)

---

## Phase 5: Person Detail View

**Goal:** Full profile page with header and tabs structure.

**Risk Level:** LOW (UI only)

**Requirements Covered:** P-002, P-003, P-004, P-008

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/app/(dashboard)/people/[id]/page.tsx` | Detail page (Overview tab) |
| CREATE | `src/app/(dashboard)/people/[id]/layout.tsx` | Layout with tabs |
| CREATE | `src/components/people/person-header.tsx` | Name, status, actions |
| CREATE | `src/components/people/person-overview.tsx` | Overview tab content |
| CREATE | `src/components/people/person-tabs.tsx` | Tab navigation |
| CREATE | `src/components/people/person-edit-form.tsx` | Edit form modal |
| CREATE | `src/components/people/status-timeline.tsx` | Status progression visual |

### Tab Structure

| Tab | Route | Content |
|-----|-------|---------|
| Overview | `/people/[id]` | Contact info, status, source, tags, key dates |
| Activity | `/people/[id]/activity` | Timeline (Phase 6) |
| Assessments | `/people/[id]/assessments` | 4 C's and Interviews (Phase 9) |
| Teams & Training | `/people/[id]/teams` | Placeholder (depends on F8) |

### Header Actions

- Edit (opens form)
- Change Status (dropdown)
- Delete (soft delete with confirmation)

### Acceptance Criteria

- [ ] Header shows name, avatar placeholder, status badge
- [ ] Contact info displayed (email, phone, address)
- [ ] Source and source details shown
- [ ] Status progression timeline visual
- [ ] Edit form updates person
- [ ] Tab navigation works
- [ ] 404 for non-existent person

### Defer to Later

- Photo display (Phase 11)
- Teams & Training content (depends on F8)

---

## Phase 6: Activity Timeline & Notes

**Goal:** Chronological activity log with note-adding capability.

**Risk Level:** MEDIUM (new table)

**Requirements Covered:** P-009, P-010

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/app/(dashboard)/people/[id]/activity/page.tsx` | Activity tab page |
| CREATE | `src/components/people/activity-timeline.tsx` | Timeline component |
| CREATE | `src/components/people/activity-item.tsx` | Single activity |
| CREATE | `src/components/people/note-form.tsx` | Add note form |
| CREATE | `src/lib/people/activity.ts` | Activity service |
| MODIFY | `src/app/(dashboard)/people/actions.ts` | Add note actions |

### Activity Types

```typescript
export const activityTypes = [
  "status_changed",      // Status progression
  "note_added",          // Manual note
  "person_created",      // Initial creation
  "person_updated",      // Profile updated
  "interview_completed", // Interview recorded
  "assessment_completed",// 4 C's assessment
  "commitment_recorded", // Commitment signed
  "tag_added",           // Tag assigned
  "tag_removed",         // Tag removed
  // Future (F3/F8):
  // "vision_meeting_attended",
  // "team_assigned",
] as const;
```

### Activity Service

```typescript
// src/lib/people/activity.ts

export async function logActivity(
  churchId: string,
  personId: string,
  userId: string,
  type: ActivityType,
  metadata?: Record<string, unknown>
): Promise<PersonActivity>

export async function getActivities(
  churchId: string,
  personId: string,
  options?: { limit?: number; cursor?: string }
): Promise<PersonActivity[]>
```

### Acceptance Criteria

- [ ] Timeline shows all activities chronologically
- [ ] Add note form in Activity tab
- [ ] Notes appear in timeline with user attribution
- [ ] Status changes logged automatically
- [ ] Metadata stored for context (old/new status, etc.)
- [ ] Pagination for long timelines

### Defer to Later

- Vision Meeting attendance logging (depends on F3)
- Team assignment logging (depends on F8)

---

## Phase 7: Tags System

**Goal:** Church-defined tags for categorizing people.

**Risk Level:** LOW (simple CRUD)

**Requirements Covered:** P-011

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/lib/people/tags.ts` | Tag service |
| CREATE | `src/components/people/tag-picker.tsx` | Multi-select tag picker |
| CREATE | `src/components/people/tag-badge.tsx` | Colored tag badge |
| CREATE | `src/app/(dashboard)/people/tags/page.tsx` | Tag management page (optional) |
| MODIFY | `src/app/(dashboard)/people/actions.ts` | Tag CRUD actions |
| MODIFY | `src/components/people/people-filters.tsx` | Add tag filter |
| MODIFY | `src/lib/people/search.ts` | Support tag filtering |

### Tag Service

```typescript
// src/lib/people/tags.ts

export async function createTag(
  churchId: string,
  name: string,
  color?: string
): Promise<Tag>

export async function listTags(churchId: string): Promise<Tag[]>

export async function deleteTag(
  churchId: string,
  tagId: string
): Promise<void>

export async function assignTag(
  churchId: string,
  personId: string,
  tagId: string
): Promise<void>

export async function removeTag(
  churchId: string,
  personId: string,
  tagId: string
): Promise<void>

export async function getPersonTags(
  churchId: string,
  personId: string
): Promise<Tag[]>
```

### Acceptance Criteria

- [ ] Create tags with name and optional color
- [ ] List all tags for church
- [ ] Delete unused tags
- [ ] Assign/remove tags on person
- [ ] Display tags on person card and detail
- [ ] Filter people list by tags
- [ ] Tag picker shows all available tags

### Defer to Later

- Bulk tag operations
- Tag usage analytics

---

## Phase 8: Status Progression Logic

**Goal:** Implement status change validation, manual override, and event emission.

**Risk Level:** MEDIUM (core business logic)

**Requirements Covered:** P-012

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/lib/people/status.ts` | Status service |
| CREATE | `src/lib/people/events.ts` | Event emission stubs |
| CREATE | `src/components/people/status-change-modal.tsx` | Status change UI |
| MODIFY | `src/app/(dashboard)/people/actions.ts` | Status change action |

### Status Service

```typescript
// src/lib/people/status.ts

export interface StatusTransition {
  from: PersonStatus;
  to: PersonStatus;
  requiresConfirmation: boolean;
  warnings?: string[];
}

export function validateStatusTransition(
  currentStatus: PersonStatus,
  newStatus: PersonStatus,
  personData: Person
): StatusTransition

export async function changeStatus(
  churchId: string,
  personId: string,
  userId: string,
  newStatus: PersonStatus,
  reason?: string
): Promise<Person>
```

### Soft Validation Warnings

| Action | Warning Condition |
|--------|-------------------|
| Record Interview | Person has not attended Vision Meeting |
| Record Commitment | Person has not been interviewed |
| 4 C's Assessment | Person is not yet `core_group` or higher |

### Event Emission (Stubs)

```typescript
// src/lib/people/events.ts

export async function emitPersonCreated(person: Person): Promise<void> {
  // Stub: Log to console in dev, no-op in prod until event system built
  console.log("[EVENT] person.created", { 
    personId: person.id, 
    churchId: person.churchId,
    status: person.status 
  });
}

export async function emitPersonStatusChanged(
  person: Person,
  oldStatus: PersonStatus,
  newStatus: PersonStatus
): Promise<void> {
  console.log("[EVENT] person.status.changed", {
    personId: person.id,
    churchId: person.churchId,
    oldStatus,
    newStatus,
  });
}

// DEFERRED: Inbound event handlers
export async function handleVisionMeetingAttendance(
  personId: string,
  meetingId: string,
  churchId: string
): Promise<void> {
  // TODO: Implement when F3 is built
  throw new Error("Not implemented - depends on F3");
}

export async function handleTeamMemberAssigned(
  personId: string,
  teamId: string,
  role: string,
  churchId: string
): Promise<void> {
  // TODO: Implement when F8 is built
  throw new Error("Not implemented - depends on F8");
}
```

### Acceptance Criteria

- [ ] Manual status change via modal
- [ ] Soft warnings shown but don't block
- [ ] Activity logged on status change
- [ ] Events emitted (stubbed)
- [ ] Out-of-order handling (skip intermediate statuses)
- [ ] Reason captured for manual overrides

### Defer to Later

- Automatic progression from F3/F8 events

---

## Phase 9: Assessments (4 C's & Interview)

**Goal:** Assessment forms for Core Group qualification.

**Risk Level:** LOW (forms and display)

**Requirements Covered:** P-013, P-014

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/app/(dashboard)/people/[id]/assessments/page.tsx` | Assessments tab |
| CREATE | `src/components/people/assessment-form.tsx` | 4 C's form |
| CREATE | `src/components/people/assessment-history.tsx` | Past assessments |
| CREATE | `src/components/people/interview-form.tsx` | Interview form |
| CREATE | `src/components/people/interview-history.tsx` | Past interviews |
| CREATE | `src/lib/people/assessments.ts` | Assessment service |
| MODIFY | `src/app/(dashboard)/people/actions.ts` | Assessment actions |

### 4 C's Assessment Form

- **Committed** (1-5 scale + notes)
- **Compelled** (1-5 scale + notes)
- **Contagious** (1-5 scale + notes)
- **Courageous** (1-5 scale + notes)
- Total score calculated (4-20)

### Interview Form (5 Criteria)

- **Maturity**: Pass / Fail / Concern + notes
- **Gifted**: Pass / Fail / Concern + notes
- **Chemistry**: Pass / Fail / Concern + notes
- **Right Reasons**: Pass / Fail / Concern + notes
- **Season of Life**: Pass / Fail / Concern + notes
- **Overall Result**: Qualified / Qualified with Notes / Not Qualified / Follow-up Needed
- **Next Steps**: Text field

### Behavior

- Completing interview auto-advances person to `interviewed` status
- Soft warning if person hasn't attended Vision Meeting
- Assessment history shows trend over time

### Acceptance Criteria

- [ ] 4 C's form with 1-5 scale for each C
- [ ] Total score calculated and displayed
- [ ] Interview form with 5 criteria
- [ ] Pass/Fail/Concern for each criterion
- [ ] Overall result selection
- [ ] Auto-advance to `interviewed` on interview save
- [ ] History displays past assessments/interviews

### Defer to Later

- Assessment scheduling/reminders
- Trend charts

---

## Phase 10: Commitments

**Goal:** Record signed commitment cards.

**Risk Level:** LOW (simple form)

**Requirements Covered:** P-015

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/components/people/commitment-form.tsx` | Commitment recording |
| CREATE | `src/components/people/commitment-display.tsx` | Show commitments |
| CREATE | `src/lib/people/commitments.ts` | Commitment service |
| MODIFY | `src/app/(dashboard)/people/actions.ts` | Commitment actions |
| MODIFY | `src/components/people/person-overview.tsx` | Show commitment status |

### Commitment Form Fields

- **Commitment Type**: Core Group / Launch Team (radio)
- **Date Signed**: Date picker (required)
- **Witnessed By**: User dropdown (optional)
- **Document Upload**: File input (optional, deferred)
- **Notes**: Text area

### Behavior

- Recording commitment auto-advances person to `committed` status
- Soft warning if person hasn't been interviewed
- Multiple commitments allowed (e.g., Core Group then Launch Team)

### Acceptance Criteria

- [ ] Commitment form with required fields
- [ ] Witness selection from church users
- [ ] Auto-advance to `committed` on save
- [ ] Display commitment on Overview tab
- [ ] Activity logged
- [ ] Multiple commitments supported

### Defer to Later

- Document upload/storage
- Commitment card scanning

---

## Phase 11: Household & Skills

**Goal:** Family grouping and skills inventory.

**Risk Level:** LOW (additional entities)

**Requirements Covered:** P-016, P-023

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/lib/people/household.ts` | Household service |
| CREATE | `src/components/people/household-manager.tsx` | Household UI |
| CREATE | `src/components/people/household-members.tsx` | Display members |
| CREATE | `src/components/people/skills-form.tsx` | Skills input |
| CREATE | `src/components/people/skills-list.tsx` | Display skills |
| CREATE | `src/lib/people/skills.ts` | Skills service |
| MODIFY | `src/app/(dashboard)/people/actions.ts` | Household/Skills actions |
| MODIFY | `src/components/people/person-overview.tsx` | Show household/skills |

### Household Service

```typescript
// src/lib/people/household.ts

export async function createHousehold(
  churchId: string,
  name: string,
  address?: Address
): Promise<Household>

export async function addToHousehold(
  churchId: string,
  householdId: string,
  personId: string,
  role: HouseholdRole
): Promise<void>

export async function removeFromHousehold(
  churchId: string,
  personId: string
): Promise<void>

export async function getHouseholdMembers(
  churchId: string,
  householdId: string
): Promise<Person[]>

export async function propagateAddress(
  churchId: string,
  householdId: string
): Promise<void> // Copy household address to all members
```

### Skills Service

```typescript
// src/lib/people/skills.ts

export async function addSkill(
  churchId: string,
  personId: string,
  skill: SkillCreate
): Promise<SkillsInventory>

export async function removeSkill(
  churchId: string,
  skillId: string
): Promise<void>

export async function getPersonSkills(
  churchId: string,
  personId: string
): Promise<SkillsInventory[]>
```

### Acceptance Criteria

- [ ] Create/edit household
- [ ] Add person to household with role
- [ ] Remove person from household
- [ ] Display household members on person detail
- [ ] Address propagation option
- [ ] Add/remove skills for person
- [ ] Display skills on profile

### Defer to Later

- Filter people by skills
- Skill matching for team roles

---

## Phase 12: Advanced Features

**Goal:** Quick add, duplicate detection, bulk import, metrics.

**Risk Level:** MEDIUM (bulk operations)

**Requirements Covered:** P-017, P-018, P-019, P-020

### Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/components/people/quick-add-form.tsx` | Quick add modal |
| CREATE | `src/components/people/duplicate-warning.tsx` | Duplicate alert |
| CREATE | `src/components/people/import-wizard.tsx` | CSV import |
| CREATE | `src/lib/people/duplicates.ts` | Duplicate detection |
| CREATE | `src/lib/people/import.ts` | CSV import service |
| CREATE | `src/lib/people/metrics.ts` | Conversion metrics |
| MODIFY | `src/components/people/pipeline-view.tsx` | Add metrics footer |
| MODIFY | `src/app/(dashboard)/people/actions.ts` | Quick add, import actions |

### Quick Add Form (P-019)

Minimal fields:
- First Name (required)
- Last Name (required)
- Email
- Phone
- Source (dropdown, default "Other")

Buttons:
- Cancel
- Save & Add Another (clears form, stays open)
- Save (closes modal)

Status defaults to `prospect`.

### Duplicate Detection (P-018)

```typescript
// src/lib/people/duplicates.ts

export interface DuplicateCheck {
  exactMatch: Person | null;     // Same email
  potentialMatches: Person[];    // Fuzzy name + phone
}

export async function checkForDuplicates(
  churchId: string,
  email?: string,
  firstName?: string,
  lastName?: string,
  phone?: string
): Promise<DuplicateCheck>
```

- **Exact match**: Same email address
- **Potential match**: Similar name AND same phone (last 4 digits)
- Show warning on create, allow user to proceed or view existing

### Bulk Import (P-017)

Import wizard steps:
1. Download CSV template
2. Upload filled CSV
3. Preview: valid records, records with issues, duplicates
4. Resolve duplicates (skip / create anyway / merge)
5. Confirm import
6. Display summary

### Conversion Metrics (P-020) — DEFERRED

> **Status:** Deferred — needs design revisit.
>
> All-time conversion rates become misleading as the pipeline grows (the denominator
> inflates while current status counts stay small, producing artificially low percentages).
> Need to determine the right metric approach: time-windowed rates (last 30/60/90 days),
> cohort-based tracking, or something else.
>
> Service layer (`src/lib/people/metrics.ts`) and component
> (`src/components/people/pipeline-metrics.tsx`) exist but are **not wired up**.

### Acceptance Criteria

- [x] Quick add modal with minimal fields
- [x] "Save & Add Another" keeps modal open
- [x] Duplicate warning on create
- [x] CSV template download
- [x] CSV import with preview
- [x] Duplicate resolution in import
- [ ] Conversion metrics in pipeline view — DEFERRED (see above)

### Defer to Later

- Potential duplicates batch review page (P-025)
- Bulk export (P-027)

---

## Memory Updates

After completing all phases, update memory files:

### `memory/contracts/db.md`

Add People/CRM schema summary:
- `persons` table with key fields
- Related tables: households, tags, assessments, interviews, commitments, skills_inventory, person_activities

### `memory/entrypoints.md`

Add:
- `/people` - People list page
- `/people/[id]` - Person detail page
- `src/app/(dashboard)/people/actions.ts` - Server actions
- `src/lib/people/` - Service functions

### `memory/flows/person-status.mmd`

Create Mermaid diagram showing:
- Status progression flow
- Event triggers (including deferred F3/F8 events)
- Manual override path

---

## Risk Summary

| Phase | Risk | Reason |
|-------|------|--------|
| 1 | HIGH | Database schema, foundational |
| 2 | MEDIUM | New server actions pattern |
| 3 | LOW | UI components only |
| 4 | LOW | UI components only |
| 5 | LOW | UI components only |
| 6 | MEDIUM | New activity table |
| 7 | LOW | Simple tag CRUD |
| 8 | MEDIUM | Core business logic |
| 9 | LOW | Forms and display |
| 10 | LOW | Simple form |
| 11 | LOW | Additional entities |
| 12 | MEDIUM | Bulk operations |

---

## Execution Notes

### For Agents

1. **Phase 1 requires approval** before execution (HIGH risk - schema)
2. Each phase should compile and pass linting before moving to next
3. Update checklist after completing each phase
4. Run `code-reviewer` agent before committing
5. Commit after each phase (atomic commits)

### Manual Testing Points

- After Phase 3: Verify list view loads with no people
- After Phase 4: Verify drag-and-drop updates status
- After Phase 5: Verify person detail shows all fields
- After Phase 8: Verify status progression and events
- After Phase 12: Test CSV import with duplicates

### Dependencies Between Phases

```
Phase 1 (Schema) ──► All subsequent phases

Phase 2 (CRUD) ──► Phase 3 (List)
              ──► Phase 5 (Detail)
              ──► All data-dependent phases

Phase 6 (Activity) ◄── Phase 8 (Status) logs activities
                   ◄── Phase 9 (Assessments) logs activities
                   ◄── Phase 10 (Commitments) logs activities

Phase 7 (Tags) ──► Phase 3 (filter integration)

Phase 8 (Status) ──► Phase 4 (drag-drop)
                 ──► Phase 9 (auto-advance)
                 ──► Phase 10 (auto-advance)
```
