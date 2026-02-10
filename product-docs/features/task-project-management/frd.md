# F5: Task & Project Management
## Feature Requirements Document (FRD)

**Version:** 1.1  
**Date:** January 25, 2026  
**Feature Code:** F5

---

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services
- [Core Data Contracts](../../core-data-contracts.md) - Shared entity contracts (Church, User, Person, Phase)

---

## Overview

Task & Project Management tracks all tasks required for successful launch with templates and timeline visualization. This feature combines personal task management with project-level tracking, providing both individual to-do lists and overall launch timeline visibility.

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement | Description |
|----|-------------|-------------|
| T-001 | Task creation | Create tasks with title, due date, and priority |
| T-002 | Task list view | Display tasks in a filterable, sortable list |
| T-003 | Task status tracking | Track status: Not Started, In Progress, Blocked, Complete |
| T-004 | Task assignment | Assign tasks to users |
| T-005 | Due date management | Set and track due dates with overdue indicators |
| T-006 | Priority levels | Assign priority: Low, Medium, High, Urgent |
| T-007 | Task categorization | Categorize tasks (Vision Meeting, Follow-up, etc.) |
| T-008 | Task completion | Mark tasks complete with timestamp |
| T-009 | My Tasks view | Filter to show only assigned tasks |
| T-010 | Related entity linking | Link tasks to Person, Meeting, Team, etc. |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| T-011 | Checklist templates | Pre-built task templates by phase and category |
| T-012 | Template import | Import checklist templates with relative dates |
| T-013 | GANTT timeline view | Visual timeline of tasks and milestones |
| T-014 | Milestone tracking | Track key dates and achievements separately |
| T-015 | Task dependencies | Define prerequisite tasks |
| T-016 | Subtasks/checklists | Nested items within a task |
| T-017 | Recurring tasks | Tasks that repeat on a schedule |
| T-018 | Task notifications | Alerts for due and overdue tasks |
| T-019 | Bulk operations | Complete or reschedule multiple tasks at once |
| T-020 | Phase-triggered templates | Prompt to import templates on phase change |
| T-021 | Task descriptions | Rich text descriptions for tasks |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| T-022 | Calendar sync | Bidirectional sync with Google/Outlook calendar |
| T-023 | Team assignment | Assign tasks to ministry teams vs individuals |
| T-024 | Time tracking | Track effort spent on tasks |
| T-025 | Task comments | Threaded comments for collaboration |
| T-026 | Mobile optimization | Touch-friendly task management |
| T-027 | Drag-and-drop timeline | Adjust task dates by dragging on GANTT |

---

## Screens

### 1. Task List View

Primary view for managing individual tasks.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Tasks                                                    [+ Add Task]       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  View: [My Tasks] [All Tasks] [By Team]         Filter: [Status ▼] [Due ▼] │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  OVERDUE (3)                                                        ⚠️      │
│                                                                              │
│  ☐ Follow up with Sarah Johnson                         Due: Jan 23 (-2d)  │
│    Vision Meeting Follow-up • High Priority                                 │
│                                                                              │
│  ☐ Complete facility site visit                         Due: Jan 24 (-1d)  │
│    Facilities • Medium Priority                                             │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  TODAY (5)                                                                   │
│                                                                              │
│  ☐ Follow up with Mike Williams                         Due: Today         │
│    Vision Meeting Follow-up • High Priority                                 │
│                                                                              │
│  ☐ Send Vision Meeting reminder                         Due: Today         │
│    Vision Meeting #12 • Medium Priority                                     │
│                                                                              │
│  ☑ Review commitment card with Tom                      Completed today     │
│    Core Group • Medium Priority                         ✓                   │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  THIS WEEK (12)                                                              │
│                                                                              │
│  ☐ Prepare Vision Meeting agenda                        Due: Jan 27        │
│  ☐ Order name tags and materials                        Due: Jan 27        │
│  ☐ Confirm venue for Vision Meeting                     Due: Jan 26        │
│  ...                                                                        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Quick add task inline
- Drag-and-drop reordering
- Bulk complete/reschedule
- Filter by status, due date, priority, category, team
- Toggle between My Tasks and All Tasks

---

### 2. Task Detail/Edit

Full task view with all fields.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Title | Text | Yes | Task description |
| Description | Rich text | No | Detailed notes |
| Status | Dropdown | Yes | Not Started / In Progress / Blocked / Complete |
| Priority | Dropdown | Yes | Low / Medium / High / Urgent |
| Due Date | Date | No | When task is due |
| Assigned To | Person selector | No | Who owns this task |
| Category | Dropdown | No | Vision Meeting / Follow-up / Training / etc. |
| Related To | Link | No | Person, Meeting, Team, etc. |
| Dependencies | Task selector | No | Tasks that must complete first |
| Recurring | Toggle + settings | No | Repeat pattern |
| Checklist | Subtasks | No | Sub-items within task |

---

### 3. Project Timeline (GANTT View)

Visual timeline of all tasks and milestones.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Project Timeline                                         [+ Add Milestone] │
│  Phase 2: Launch Team Formation                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                    Feb        Mar        Apr        May        Jun          │
│                    |          |          |          |          |            │
│  Ministry Teams    ████████████████                                         │
│  ├ Assign leaders  ████                                                     │
│  ├ Import roles         ████                                                │
│  └ Fill key roles            ████████████                                   │
│                                                                              │
│  Training Plan               ████████████████████████                       │
│  ├ Schedule Peak Perf             ████                                      │
│  ├ Small Group 101                     ████████                             │
│  └ Team training                            ████████████████                │
│                                                                              │
│  Facility Search   ████████████████████████                                 │
│  ├ Site visits     ████████                                                 │
│  ├ Evaluation           ████████                                            │
│  └ Negotiation               ████████████                                   │
│                                                                              │
│  ◆ Launch Date Set (Feb 15)                                                 │
│                    ◆ Teams 80% Staffed (Apr 30)                             │
│                                        ◆ Training Complete (Jun 15)         │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  Legend: ████ Task duration  ◆ Milestone  ████ Critical path               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Zoom controls (week/month/quarter view)
- Drag to adjust task dates
- Click task to edit
- Milestone markers
- Critical path highlighting
- Dependencies shown as arrows
- Today line indicator

---

### 4. Checklist Templates

Pre-built task templates by phase and category.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Checklist Templates                                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  BY PHASE                                                                    │
│                                                                              │
│  ▼ Phase 1: Core Group Development                                          │
│    ├ Vision Meeting Preparation                    12 tasks    [Import]     │
│    ├ Post-Meeting Follow-Up                         8 tasks    [Import]     │
│    └ Core Group Onboarding                          6 tasks    [Import]     │
│                                                                              │
│  ▼ Phase 2: Launch Team Formation                                           │
│    ├ Ministry Team Setup                           15 tasks    [Import]     │
│    ├ Launch Date Planning                           8 tasks    [Import]     │
│    └ Project Timeline Creation                     10 tasks    [Import]     │
│                                                                              │
│  ▼ Phase 3: Training & Preparation                                          │
│    ├ Peak Performance Classes                      12 tasks    [Import]     │
│    ├ Ministry Team Training                        20 tasks    [Import]     │
│    └ Small Group Leader Training                    8 tasks    [Import]     │
│                                                                              │
│  ▼ Phase 4: Pre-Launch                                                      │
│    ├ Promotion Campaign                            18 tasks    [Import]     │
│    ├ Pre-Launch Services                           10 tasks    [Import]     │
│    └ Final Preparation                             15 tasks    [Import]     │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  LAUNCH SUNDAY CHECKLISTS                                                    │
│                                                                              │
│    Setup/Teardown Team                             25 items    [Import]     │
│    Signage & Parking                               12 items    [Import]     │
│    Greeters/Ushers                                 15 items    [Import]     │
│    Children's Ministry                             30 items    [Import]     │
│    Worship Team                                    20 items    [Import]     │
│    Assimilation Team                               18 items    [Import]     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Milestone View

Key dates and achievements tracker.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Milestones                                              [+ Add Milestone]   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  COMPLETED                                                                   │
│                                                                              │
│  ✓ Jan 5    First Vision Meeting                                            │
│  ✓ Jan 15   25 committed adults reached                                     │
│  ✓ Jan 20   Launch date set: Sep 7, 2026                                    │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  UPCOMING                                                                    │
│                                                                              │
│  ○ Feb 15   All ministry team leaders assigned                    22 days  │
│  ○ Mar 1    Geographic area finalized                             36 days  │
│  ○ Apr 30   Teams 80% staffed                                     96 days  │
│  ○ May 15   Facility secured                                     111 days  │
│  ○ Jun 15   Training complete                                    142 days  │
│  ○ Aug 1    Promotion campaign launch                            189 days  │
│  ○ Aug 17   Pre-launch service #1                                205 days  │
│  ○ Aug 24   Pre-launch service #2                                212 days  │
│  ○ Aug 31   Pre-launch service #3                                219 days  │
│  ★ Sep 7    LAUNCH SUNDAY                                        226 days  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  AT RISK                                                                     │
│                                                                              │
│  ⚠️ Feb 28  50 committed adults                              Not on track   │
│             Current: 38 • Needed: +12 in 35 days                            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 6. Weekly Service Checklist (Phase 6)

Recurring checklist for post-launch weekly operations.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Weekly Service Checklist                          Sunday, January 26, 2026 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  BEFORE SERVICE                                                              │
│                                                                              │
│  Setup (6:00 AM)                                           Owner: Tom W.    │
│  ☑ Trailer loaded and on-site                                               │
│  ☑ Chairs set up (200)                                                      │
│  ☑ Stage equipment positioned                                               │
│  ☐ Signage placed outside                                                   │
│  ☐ Sound check complete                                                     │
│                                                                              │
│  Children's Ministry (7:30 AM)                             Owner: Lisa D.   │
│  ☐ Rooms set up and clean                                                   │
│  ☐ Curriculum materials ready                                               │
│  ☐ Check-in system tested                                                   │
│  ☐ Volunteer team briefed                                                   │
│                                                                              │
│  Welcome Team (8:00 AM)                                    Owner: Amy C.    │
│  ☐ Greeters stationed                                                       │
│  ☐ Guest reception area ready                                               │
│  ☐ Friendship registers in pews                                             │
│  ☐ Coffee station set up                                                    │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  AFTER SERVICE                                                               │
│                                                                              │
│  ☐ Attendance count recorded                                                │
│  ☐ Friendship registers collected                                           │
│  ☐ Guest data entered into system                                           │
│  ☐ Follow-up tasks created for new guests                                   │
│  ☐ Equipment packed and stored                                              │
│  ☐ Venue cleaned and reset                                                  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  Progress: 4/20 complete (20%)                    [Mark All Complete]       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Workflows

### Workflow 1: Creating a Task

**Trigger:** User clicks "+ Add Task"

**Steps:**

```
[+ Add Task]
    ↓
[Quick add form OR full form]
├── Quick: Title + Due Date + Priority → [Save]
└── Full: All fields → [Save]
    ↓
Task created
    ↓
If assigned to someone else:
    ↓
    Notification sent to assignee
```

---

### Workflow 2: Importing Template Checklist

**Trigger:** User imports a checklist template

**Steps:**

```
[Checklist Templates] → [Select template] → [Import]
    ↓
[Configuration modal]:
├── Select start date (for phased tasks)
├── Assign default owner(s)
└── Customize if needed
    ↓
[Confirm Import]
    ↓
Tasks created with appropriate:
├── Due dates (relative to start date)
├── Dependencies
├── Categories
└── Assignments
    ↓
Tasks appear in Task List and Timeline
```

---

### Workflow 3: Task Dependencies

**Trigger:** User sets a task dependency

**Steps:**

```
[Task Edit] → [Dependencies field]
    ↓
Search for prerequisite task(s)
    ↓
Add dependency
    ↓
[Save]
    ↓
System enforces:
├── Dependent task cannot be started until prerequisites complete
├── Timeline shows dependency arrows
└── Completing prerequisite may auto-advance dependent
```

---

### Workflow 4: Recurring Task

**Trigger:** User creates recurring task

**Steps:**

```
[Task Edit] → [Enable Recurring]
    ↓
Set recurrence pattern:
├── Frequency: Daily / Weekly / Monthly
├── Interval: Every X days/weeks/months
├── Days: (for weekly) Mon, Tue, etc.
└── End: Never / After X occurrences / By date
    ↓
[Save]
    ↓
System generates:
├── Next occurrence when current completes
└── OR all occurrences upfront (configurable)
```

---

### Workflow 5: Phase-Triggered Task Creation

**Trigger:** Church advances to new phase

**Steps:**

```
[Phase changed (e.g., Phase 1 → Phase 2)]
    ↓
System identifies phase-specific task templates
    ↓
[Prompt]: "Import Phase 2 task templates?"
├── [Yes, import all] → Create all tasks
├── [Let me choose] → Show template selector
└── [Skip] → No tasks created
    ↓
Tasks created with default dates based on:
├── Current date
├── Launch date (if set)
└── Template relative timings
```

---

## Data Model

### Task

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| title | String | Yes | Task title |
| description | Text | No | Detailed description |
| status | Enum | Yes | `not_started` / `in_progress` / `blocked` / `complete` |
| priority | Enum | Yes | `low` / `medium` / `high` / `urgent` |
| due_date | Date | No | Due date |
| due_time | Time | No | Due time (optional) |
| assigned_to_id | UUID (FK) | No | Reference to User |
| category | String | No | Task category |
| related_type | Enum | No | `person` / `meeting` / `team` / `facility` |
| related_id | UUID | No | Reference to related entity |
| parent_task_id | UUID (FK) | No | Reference to parent task (for subtasks) |
| checklist_id | UUID (FK) | No | Reference to Checklist (if from template) |
| is_recurring | Boolean | No | Default: false |
| recurrence_rule | JSON | No | RRULE-style recurrence definition |
| completed_at | Timestamp | No | When marked complete |
| completed_by_id | UUID (FK) | No | Who marked complete |
| created_by_id | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### TaskDependency

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| task_id | UUID (FK) | Yes | The dependent task |
| depends_on_id | UUID (FK) | Yes | The prerequisite task |
| created_at | Timestamp | Yes | Creation timestamp |

**Constraints:**
- Unique constraint on (task_id, depends_on_id)
- No circular dependencies (application-enforced)

---

### Checklist

Reusable checklist templates.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Checklist name |
| description | Text | No | Description |
| category | Enum | Yes | `phase` / `launch_sunday` / `weekly` / `custom` |
| phase | Enum | No | Relevant phase (0-6) |
| team | String | No | Relevant ministry team |
| is_system | Boolean | Yes | System-provided vs custom |
| created_at | Timestamp | Yes | Creation timestamp |

---

### ChecklistItem

Items within a checklist template.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| checklist_id | UUID (FK) | Yes | Reference to Checklist |
| title | String | Yes | Item title |
| description | Text | No | Item description |
| relative_due_days | Integer | No | Days from start/milestone |
| relative_to | Enum | No | `start` / `launch_date` / `phase_start` |
| priority | Enum | No | Default priority |
| default_assignee_role | String | No | Role to assign (e.g., "Facilities Lead") |
| sort_order | Integer | No | Display order |
| depends_on_item_id | UUID (FK) | No | Dependency within checklist |

---

### Milestone

Key dates and achievements.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| title | String | Yes | Milestone name |
| description | Text | No | Description |
| target_date | Date | No | Target date |
| completed_date | Date | No | Actual completion date |
| status | Enum | Yes | `upcoming` / `completed` / `at_risk` / `missed` |
| is_system | Boolean | Yes | Auto-generated vs custom |
| related_type | Enum | No | What this milestone relates to |
| related_id | UUID | No | Reference to related entity |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

## Task Categories

| Category | Description | Auto-created By |
|----------|-------------|-----------------|
| Vision Meeting | VM planning and preparation | F3 |
| Follow-up | Post-meeting follow-up | F3 |
| Training | Training scheduling and completion | F8 |
| Facilities | Site search and management | F10 |
| Promotion | Marketing and outreach | Phase 4 templates |
| Administrative | Legal, financial, operational | Phase templates |
| Ministry Team | Team-specific tasks | F8 |
| Launch Prep | Pre-launch and launch day | Phase 4-5 templates |
| Recurring | Weekly operational tasks | Phase 6 templates |

---

## Integration Contracts

This feature integrates with cross-cutting services defined in [System Architecture](../../system-architecture.md). For shared entity contracts, see [Core Data Contracts](../../core-data-contracts.md).

### Inbound (This Feature Consumes)

| Event/Data | Contract | Source |
|------------|----------|--------|
| **`phase.changed`** | Subscribe to prompt phase-specific task template import | Phase Engine |
| **`meeting.attendance.recorded`** | Subscribe to auto-create follow-up tasks for new attendees | Vision Meeting events |
| **`facility.visit.scheduled`** | Subscribe to create site visit tasks | Facility events |
| **Person reference** | Store `person_id` (FK) for task-to-person linking; read name via [Core Data Contracts](../../core-data-contracts.md) | People/CRM |

### Outbound (This Feature Provides)

| Event/Data | Contract | Consumers May |
|------------|----------|---------------|
| **`task.completed`** | Emits `{ task_id, category, related_id, church_id }` on task completion | Update dashboard metrics, trigger follow-on workflows |
| **Task completion rates** | Exposes completion % by `church_id`, `category` | Dashboard aggregation |
| **Overdue task count** | Exposes count of overdue tasks by `church_id` | Dashboard alerts |

---

## Success Metrics

### Task Management
- Task completion rate
- On-time completion rate
- Average tasks per user per week
- Overdue task count

### Template Usage
- Template import rate
- Most used templates
- Template completion rates

### Timeline Engagement
- GANTT view usage
- Milestone tracking engagement

---

## Oversight Access Patterns

### Coach Access
Coaches can view task lists, milestones, and the project timeline (GANTT view) for their assigned churches. This includes task status, due dates, overdue counts, and milestone progress. Access is read-only.

### Sending Church Admin Access
Sending church admins can see aggregate task completion rates and milestone progress — percentage of tasks completed on time, overdue task counts, and milestone achievement status. No individual task details are visible. Subject to the planter's `share_tasks` privacy toggle.

### Network Admin Access
Network admins can see aggregate task metrics across all plants in their network — completion rates, milestone progress, and on-time performance benchmarks. Subject to each planter's `share_tasks` privacy toggle.

### Privacy Controls
- Planter controls visibility via per-feature privacy toggle in church privacy settings
- Privacy toggle for this feature: `share_tasks`
- Default: `false` (not shared until planter opts in)
- When `share_tasks` is `false`, sending church admins and network admins see no data for this feature

---

## Open Questions

1. **Calendar sync:** Should tasks sync bidirectionally with Google Calendar / Outlook?

2. **Notifications:** What notification channels for task reminders (email, push, SMS)?

3. **Team assignment:** Can tasks be assigned to ministry teams rather than individuals?

4. **Time tracking:** Should tasks support time tracking for effort estimation?

5. **Comments:** Should tasks support threaded comments for collaboration?
