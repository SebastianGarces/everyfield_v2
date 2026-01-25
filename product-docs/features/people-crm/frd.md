# F2: People / CRM Management
## Feature Requirements Document (FRD)

**Version:** 1.1  
**Date:** January 25, 2026  
**Feature Code:** F2

---

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services
- [Core Data Contracts](../../core-data-contracts.md) - Shared entity contracts (Church, User, Person, Phase)

---

## Overview

People / CRM Management tracks all individuals from initial contact through committed team member and beyond. This feature serves as the central repository for relationship data, enabling planters to manage prospects, qualify potential members, and track the journey of each person toward full engagement.

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement | Description |
|----|-------------|-------------|
| P-001 | Person record management | Create, read, update, delete person records |
| P-002 | Contact information | Store name, email, phone, address for each person |
| P-003 | Status tracking | Track person's status in the pipeline (prospect through leader) |
| P-004 | Source tracking | Record how each person was reached (referral, social media, etc.) |
| P-005 | Search and filter | Search by name, email, phone; filter by status, tags, source |
| P-006 | List view | Display all contacts in a searchable, filterable list |
| P-007 | Pipeline view | Visual kanban-style view of contacts by status |
| P-008 | Person detail view | Full profile page with all contact information |
| P-009 | Activity timeline | Chronological log of all interactions per person |
| P-010 | Note adding | Add timestamped notes to person records |
| P-011 | Tagging | Apply and filter by custom tags |
| P-012 | Status progression | Move people through pipeline stages with validation |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| P-013 | 4 C's assessment | Assessment form to rate Committed, Compelled, Contagious, Courageous |
| P-014 | Interview tracking | Capture 5 criteria interview results (Maturity, Gifted, Chemistry, Right Reasons, Season) |
| P-015 | Commitment tracking | Record signed commitments with dates |
| P-016 | Skills inventory | Track skills and gifts for team matching |
| P-017 | Bulk import | Import contacts from CSV/spreadsheet |
| P-018 | Duplicate detection | Identify and merge duplicate records |
| P-019 | Quick add | Simplified form for rapid contact entry |
| P-020 | Conversion metrics | Display conversion rates between pipeline stages |
| P-021 | Team assignment visibility | Show ministry team assignments on person profile |
| P-022 | Training status display | Show training completion on person profile |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| P-023 | Household grouping | Link family members together |
| P-024 | Photo support | Profile photos for contacts |
| P-025 | External ChMS sync | Bidirectional sync with Planning Center, Breeze, etc. |
| P-026 | Bulk export | Export contacts to CSV |
| P-027 | Custom fields | Church-defined additional fields |
| P-028 | Communication preferences | Track preferred contact method |
| P-029 | Birthday/anniversary tracking | Date tracking for personal outreach |

---

## Screens

### 1. People List View

The primary landing page for managing contacts.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  People                                              [+ Add Person]          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  🔍 Search...        [Status ▼] [Tags ▼] [Source ▼] [Team ▼] [More ▼]       │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  View: [List] [Pipeline] [Table]                                   245 total │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ○ John Smith                                    Core Group Member      │  │
│  │   john@email.com • 555-0123                     Worship Team          │  │
│  │   Source: Personal Referral                     ●●●● 4 C's: Strong    │  │
│  │   Added: Jan 15, 2026                           [View]                │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ○ Sarah Johnson                                 Following Up           │  │
│  │   sarah@email.com • 555-0456                    No team assigned       │  │
│  │   Source: Vision Meeting                        ○○○○ 4 C's: Pending   │  │
│  │   Added: Jan 20, 2026                           [View]                │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Quick search by name, email, phone
- Multi-filter capability (status, tags, source, team assignment)
- Toggle between List, Pipeline, and Table views
- Bulk actions (tag, export, message)
- Quick status indicator showing position in journey

---

### 2. Pipeline View

Visual pipeline showing members at each stage.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  People Pipeline                                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Prospect    Attendee    Following Up   Interviewed   Committed   Core Group │
│  ────────    ────────    ────────────   ───────────   ─────────   ────────── │
│     12          8            15              5            23          42     │
│                                                                              │
│  ┌──────┐   ┌──────┐      ┌──────┐      ┌──────┐     ┌──────┐     ┌──────┐  │
│  │ John │   │Sarah │      │ Mike │      │ Lisa │     │ Tom  │     │ Amy  │  │
│  │Smith │   │Brown │      │Jones │      │Davis │     │White │     │Lee   │  │
│  └──────┘   └──────┘      └──────┘      └──────┘     └──────┘     └──────┘  │
│  ┌──────┐   ┌──────┐      ┌──────┐      ┌──────┐     ┌──────┐     ┌──────┐  │
│  │ Jane │   │ ...  │      │ ...  │      │ ...  │     │ ...  │     │ ...  │  │
│  │ Doe  │   │      │      │      │      │      │     │      │     │      │  │
│  └──────┘   └──────┘      └──────┘      └──────┘     └──────┘     └──────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│  Conversion Rates:  Prospect→Attendee: 67%  |  Attendee→Committed: 45%      │
│                     Committed→Core Group: 92%                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Drag-and-drop between stages
- Count per stage with visual sizing
- Conversion rate display between stages
- Click card to view person detail
- Filter pipeline by source or date range

---

### 3. Person Detail View

Complete profile for an individual.

**Header Section:**
- Name, photo/avatar
- Contact info (email, phone, address)
- Current status badge
- Quick actions: Edit, Message, Schedule, Assign

**Tabs:**

#### Tab: Overview
- Status progression timeline
- 4 C's assessment visual (if Core Group)
- Current team assignments
- Tags
- Source information
- Key dates (added, first attended, committed, etc.)

#### Tab: Activity Timeline
- Chronological list of all interactions:
  - Vision Meeting attendance
  - Follow-up calls/messages
  - Interview conducted
  - Commitment signed
  - Training completed
  - Team assigned
- Add note capability

#### Tab: Assessments
- 4 C's Assessment form and history
- Interview notes (5 criteria)
- Skills/gifts inventory
- Qualification status

#### Tab: Teams & Training
- Current team assignments with roles
- Training completion status
- Small group membership (if applicable)

---

### 4. Person Add/Edit Form

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| First Name | Text | Yes | First name |
| Last Name | Text | Yes | Last name |
| Email | Email | No | Email address |
| Phone | Phone | No | Phone number |
| Address | Address | No | Full address |
| Source | Dropdown | No | How they were reached |
| Source Details | Text | No | Referrer name or specifics |
| Status | Dropdown | Yes | Current stage in journey |
| Tags | Multi-select | No | Classification tags |
| Notes | Rich text | No | General notes |

**Source Options:**
- Personal Referral
- Social Media
- Vision Meeting
- Website
- Event
- Partner Church
- Other

---

### 5. 4 C's Assessment Screen

Assessment form for Core Group member qualities.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  4 C's Assessment: John Smith                                                │
│  Core Group Member since Jan 15, 2026                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  COMMITTED                                                          4/5     │
│  Signed commitment, consistent attendance, faithful giving                   │
│  ──────────────────────────────────────────────────────────────────────────  │
│  ○ 1 - Rarely demonstrates    ● 4 - Consistently demonstrates               │
│  ○ 2 - Sometimes demonstrates ○ 5 - Exemplary                               │
│  ○ 3 - Often demonstrates                                                   │
│  Notes: [Attends every meeting, signed card Jan 15]                         │
│                                                                              │
│  ──────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  COMPELLED                                                          5/5     │
│  Internally motivated by the vision, can articulate the why                 │
│  ──────────────────────────────────────────────────────────────────────────  │
│  ○ 1   ○ 2   ○ 3   ○ 4   ● 5                                                │
│  Notes: [Passionate advocate, shares vision clearly]                        │
│                                                                              │
│  ──────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  CONTAGIOUS                                                         3/5     │
│  Actively inviting others, growing their sphere of influence               │
│  ──────────────────────────────────────────────────────────────────────────  │
│  ○ 1   ○ 2   ● 3   ○ 4   ○ 5                                                │
│  Notes: [Has invited 2 people, could be more active]                        │
│                                                                              │
│  ──────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  COURAGEOUS                                                         4/5     │
│  Bold in action despite uncertainty, willing to sacrifice                   │
│  ──────────────────────────────────────────────────────────────────────────  │
│  ○ 1   ○ 2   ○ 3   ● 4   ○ 5                                                │
│  Notes: [Stepped up to lead setup team]                                     │
│                                                                              │
│  ──────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  Overall Score: 16/20 (Strong)                       [Cancel] [Save]        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 6. Interview Screen

Capture interview using the 5 criteria.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Member Interview: Sarah Johnson                                             │
│  Date: January 22, 2026                                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. MATURITY                                                    [✓ Pass]    │
│     Are they spiritually and emotionally mature?                            │
│     ─────────────────────────────────────────────────────────────────────   │
│     Notes: [Shows evidence of spiritual growth, handles conflict well]      │
│                                                                              │
│  2. GIFTED                                                      [✓ Pass]    │
│     Do they bring a needed skill set?                                       │
│     ─────────────────────────────────────────────────────────────────────   │
│     Notes: [Professional musician, could lead worship team]                 │
│                                                                              │
│  3. CHEMISTRY                                                   [✓ Pass]    │
│     Is there good chemistry with leadership?                                │
│     ─────────────────────────────────────────────────────────────────────   │
│     Notes: [Great conversations, aligns with vision]                        │
│                                                                              │
│  4. RIGHT REASONS                                               [✓ Pass]    │
│     Are they coming for the right reasons?                                  │
│     ─────────────────────────────────────────────────────────────────────   │
│     Notes: [Genuinely called to plant, not running from problems]           │
│                                                                              │
│  5. SEASON OF LIFE                                              [⚠ Concern] │
│     Are they in a stable season of life?                                    │
│     ─────────────────────────────────────────────────────────────────────   │
│     Notes: [New baby, may have limited availability initially]              │
│                                                                              │
│  ──────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  Overall Assessment: [Qualified with notes ▼]                               │
│  Next Steps: [Proceed to commitment conversation]                           │
│                                                          [Cancel] [Save]    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Workflows

### Workflow 1: Adding a New Contact

**Trigger:** User clicks "+ Add Person"

**Steps:**

```
[+ Add Person button clicked]
    ↓
[Add Person form opens]
    ↓
Enter basic info (name, contact, source)
    ↓
Set initial status (typically "Prospect")
    ↓
Add optional tags
    ↓
[Save]
    ↓
Person created in database
    ↓
Redirect to Person Detail View
    ↓
[Optional]: Create follow-up task
```

---

### Workflow 2: Progressing a Person Through Pipeline

**Trigger:** Person attends Vision Meeting / completes follow-up / etc.

**Steps:**

```
[Status change event]
    ↓
[Person Detail View] OR [Pipeline drag-drop]
    ↓
Change status to next stage
    ↓
System prompts for stage-specific actions:
├── Prospect → Attendee: Log attendance
├── Attendee → Following Up: Create follow-up task
├── Following Up → Interviewed: Complete interview form
├── Interviewed → Qualified: Interview passes criteria
├── Qualified → Committed: Commitment card signed
└── Committed → Core Group: Orientation complete
    ↓
Save status change
    ↓
Activity logged in timeline
    ↓
Metrics updated (dashboard, pipeline counts)
```

---

### Workflow 3: Conducting 4 C's Assessment

**Trigger:** Core Group member needs assessment

**Steps:**

```
[Person Detail View] → [Assessments Tab]
    ↓
Click "New 4 C's Assessment"
    ↓
[Assessment form opens]
    ↓
Rate each C (1-5 scale):
├── Committed
├── Compelled
├── Contagious
└── Courageous
    ↓
Add notes for each rating
    ↓
[Save Assessment]
    ↓
Overall score calculated
    ↓
Assessment saved to history
    ↓
Trend comparison available (if previous assessments exist)
```

---

### Workflow 4: Member Interview Process

**Trigger:** Person ready for qualification interview

**Steps:**

```
[Person Detail View] → [Assessments Tab]
    ↓
Click "Conduct Interview"
    ↓
[Interview form opens with 5 criteria]
    ↓
For each criterion:
├── Mark Pass / Fail / Concern
└── Add notes
    ↓
Set overall assessment:
├── Qualified
├── Qualified with Notes
├── Not Qualified
└── Follow-up Needed
    ↓
[Save Interview]
    ↓
If Qualified:
    ↓
    System suggests: "Proceed to commitment conversation?"
        ↓
    [If Yes]: Create task for commitment meeting
```

---

### Workflow 5: Bulk Import

**Trigger:** User has existing contacts to import

**Steps:**

```
[People List View] → [Import button]
    ↓
Download template CSV
    ↓
User fills template with existing data
    ↓
Upload completed CSV
    ↓
[Preview screen shows]:
├── Valid records count
├── Records with issues
└── Duplicate detection
    ↓
Resolve duplicates (skip, merge, create new)
    ↓
[Confirm Import]
    ↓
Records created
    ↓
Import summary displayed
```

---

## Data Model

> **Note:** This feature owns the `Person` entity and the entities below. The `Person` entity's stable contract (fields other features may depend on) is defined in [Core Data Contracts](../../core-data-contracts.md). All tables include `church_id` for tenant scoping per architectural requirements.

### Assessment

4 C's assessment records.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| person_id | UUID (FK) | Yes | Reference to Person |
| assessed_by | UUID (FK) | Yes | Reference to User |
| committed_score | Integer | Yes | 1-5 rating |
| committed_notes | Text | No | Notes for this C |
| compelled_score | Integer | Yes | 1-5 rating |
| compelled_notes | Text | No | Notes for this C |
| contagious_score | Integer | Yes | 1-5 rating |
| contagious_notes | Text | No | Notes for this C |
| courageous_score | Integer | Yes | 1-5 rating |
| courageous_notes | Text | No | Notes for this C |
| total_score | Integer | Yes | Sum of all scores (4-20) |
| assessment_date | Date | Yes | Date of assessment |
| created_at | Timestamp | Yes | Creation timestamp |

---

### Interview

Member qualification interview records.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| person_id | UUID (FK) | Yes | Reference to Person |
| interviewed_by | UUID (FK) | Yes | Reference to User |
| interview_date | Date | Yes | Date of interview |
| maturity_status | Enum | Yes | `pass` / `fail` / `concern` |
| maturity_notes | Text | No | Notes |
| gifted_status | Enum | Yes | `pass` / `fail` / `concern` |
| gifted_notes | Text | No | Notes |
| chemistry_status | Enum | Yes | `pass` / `fail` / `concern` |
| chemistry_notes | Text | No | Notes |
| right_reasons_status | Enum | Yes | `pass` / `fail` / `concern` |
| right_reasons_notes | Text | No | Notes |
| season_status | Enum | Yes | `pass` / `fail` / `concern` |
| season_notes | Text | No | Notes |
| overall_result | Enum | Yes | `qualified` / `qualified_with_notes` / `not_qualified` / `follow_up` |
| next_steps | Text | No | Recommended next steps |
| created_at | Timestamp | Yes | Creation timestamp |

---

### Commitment

Signed commitment records.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| person_id | UUID (FK) | Yes | Reference to Person |
| commitment_type | Enum | Yes | `core_group` / `launch_team` |
| signed_date | Date | Yes | Date commitment signed |
| witnessed_by | UUID (FK) | No | Reference to User |
| document_id | UUID (FK) | No | Reference to scanned/uploaded document |
| notes | Text | No | Notes |
| created_at | Timestamp | Yes | Creation timestamp |

---

### SkillsInventory

Track skills and gifts for matching to team roles.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| person_id | UUID (FK) | Yes | Reference to Person |
| skill_category | Enum | Yes | `worship` / `tech` / `admin` / `teaching` / `hospitality` / `leadership` / `other` |
| skill_name | String | Yes | Specific skill |
| proficiency | Enum | No | `beginner` / `intermediate` / `advanced` / `expert` |
| notes | Text | No | Details |
| created_at | Timestamp | Yes | Creation timestamp |

---

## Integration Contracts

This feature integrates with cross-cutting services defined in [System Architecture](../../system-architecture.md). For shared entity contracts, see [Core Data Contracts](../../core-data-contracts.md).

### Inbound (This Feature Consumes)

| Data | Contract | Source |
|------|----------|--------|
| **User identity** | Read `user.id` for audit trails (`created_by`, `assessed_by`) | Auth Service |

### Outbound (This Feature Provides)

| Event/Data | Contract | Consumers May |
|------------|----------|---------------|
| **`person.created`** | Emits `{ person_id, church_id, status }` when a new person is added | Sync person data, trigger welcome workflows |
| **`person.status.changed`** | Emits `{ person_id, old_status, new_status, church_id }` on pipeline progression | Update dashboards, trigger follow-up tasks |
| **Person lookup** | Exposes `Person` by `id`; fields per [Core Data Contracts](../../core-data-contracts.md) | Display name/contact in other features |

---

## Status Progression Rules

| From Status | To Status | Requirements |
|-------------|-----------|--------------|
| Prospect | Attendee | Attended at least one Vision Meeting |
| Attendee | Following Up | Follow-up initiated (call, text, email) |
| Following Up | Interviewed | Interview completed |
| Interviewed | Qualified | Interview result is "qualified" |
| Qualified | Committed | Commitment card signed |
| Committed | Core Group | Orientation complete, active participation |
| Core Group | Launch Team | Phase 2 entered, assigned to ministry team |
| Launch Team | Leader | Assigned leadership role on ministry team |

---

## Success Metrics

### Feature Adoption
- % of planters actively using CRM
- Average contacts per church
- Pipeline view usage frequency

### Data Quality
- % of contacts with complete profiles
- % of Core Group with 4 C's assessments
- Interview completion rate for committed members

### Pipeline Health
- Average time in each stage
- Conversion rates between stages
- Stalled contact identification

---

## Open Questions

1. **Duplicate handling:** How aggressive should duplicate detection be? Match on email only, or fuzzy match on name + phone?

2. **External sync:** Should People sync bidirectionally with external ChMS tools, or one-way export only?

3. **Privacy:** What data retention policies apply? Can contacts request deletion?

4. **Household grouping:** Should family members be linked/grouped together?

5. **Photo storage:** Should profile photos be supported? What size/format constraints?
