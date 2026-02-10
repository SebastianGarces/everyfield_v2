# F8: Ministry Team Management
## Feature Requirements Document (FRD)

**Version:** 1.4  
**Date:** February 9, 2026  
**Parent Document:** [Product Brief](../../product-brief.md)  
**Architecture:** [System Architecture](../../system-architecture.md)  
**Shared Contracts:** [Core Data Contracts](../../core-data-contracts.md)  
**Feature Code:** F8

---

## Overview

Ministry Team Management enables church planters to organize, staff, and track the ministry teams essential for a successful church launch. This feature manages the 10 core ministry teams (plus custom teams) from formation through launch and beyond, providing visibility into team health, staffing status, and training completion. Team communication is handled via the Communication Hub (F9).

## User-Visible Behavior

- Planters can always see and manage all 10 core ministry teams in one dashboard.
- Each team has a detail workspace for members, roles, responsibilities, training, and meetings.
- Staffing progress is visible at team and aggregate levels (filled vs open roles).
- Assignment actions update both team views and related person profiles.
- Alerts surface under-staffed teams and low readiness conditions.
- Phase-aware guidance reflects launch progress:
  - Phase transition gating follows the 8 primary ministry responsibilities (per Product Brief/System Architecture).
  - Senior Pastor and Launch Coordinator remain first-class tracked teams for operational readiness, but are not additional blockers for the Phase 2 -> 3 gate.

### Core Ministry Teams

| # | Team | Primary Responsibilities |
|---|------|-------------------------|
| 1 | **Senior Pastor** | Overall leadership, vision casting, preaching calendar, shepherding, leader development |
| 2 | **Launch Coordinator** | Project management, timeline, milestones, budget tracking, meeting coordination |
| 3 | **Worship Leader** | Worship ministry development, production oversight, musician development, setup/teardown |
| 4 | **Children's Ministry** | Curriculum, volunteer screening, safety protocols, check-in systems, room setup |
| 5 | **Facilities** | Secure worship site, manage venue relationship, signage, parking, storage |
| 6 | **Assimilation** | Guest tracking, follow-up process, Friendship Registers, data management, Guest Reception, Party with the Pastor, Peak Performance classes |
| 7 | **Small Groups** | Leader identification and training, Small Group 101, group assignment, Apprentice Program, curriculum |
| 8 | **Promotion** | Marketing plan, social media, press releases, direct mail, invitation materials |
| 9 | **Prayer** | Prayer strategy, prayer teams, corporate prayer events, communication of requests |
| 10 | **Technology** | Website development, production technology, assimilation software, communication tools |

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement | Description |
|----|-------------|-------------|
| MT-001 | Ministry team list | View all 10 core ministry teams |
| MT-002 | Team detail view | Full view of team members, roles, and status |
| MT-003 | Team leader assignment | Assign team leaders from Person records |
| MT-004 | Role definition | Define roles within each team |
| MT-005 | Member assignment | Assign people to team roles |
| MT-006 | Staffing status | Track filled vs open roles per team |
| MT-007 | Role templates | Pre-built role definitions per team |
| MT-008 | Team dashboard | Overview of all teams with health indicators |
| MT-009 | Basic metrics | Staffing percentage per team |
| MT-010 | Person-team linking | Show team assignments on person profile |
| MT-019 | Custom team creation | Create additional teams beyond the 10 core |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| MT-011 | Training tracking | Track required training completion per role |
| MT-012 | Training completion matrix | Grid view of team members vs training programs |
| MT-013 | Team meeting scheduling | Schedule and track team meetings via the Meetings feature (F3) with `type = team_meeting`. Accessible from the team detail Meetings tab. |
| MT-014 | Meeting attendance | Record attendance at team meetings via the Meetings feature (F3). |
| MT-015 | Team communication | Send messages to team members via Communication Hub (F9). F8 does not own a Communication tab; users navigate to F9 for messaging. |
| MT-016 | Health scoring | Calculate team health from staffing, training, attendance |
| MT-017 | Alert thresholds | Visual alerts for understaffed teams |
| MT-018 | Org chart view | Hierarchical visualization of team structure |
| MT-020 | Role assignment warnings | Alert when person is on multiple teams |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| MT-021 | Service scheduling | Volunteer rotation and scheduling |
| MT-022 | Availability tracking | Team members can set availability |
| MT-023 | Automated scheduling | Auto-assign based on availability |
| MT-024 | Team performance analytics | Trend analysis and insights |
| MT-025 | Mobile check-in | Mobile attendance for team meetings |
| MT-026 | Team chat integration | In-app team messaging |

---

## Screens

### 1. Ministry Teams Dashboard

The primary landing page for team management.

**Layout:**
- Grid/card view of all ministry teams
- Each card displays:
  - Team name and icon
  - Team leader (with photo/avatar)
  - Staffing status: "5/8 roles filled" with visual progress bar
  - Training completion: percentage indicator
  - Health status indicator (green/yellow/red dot)
  - Quick action: "View Team"

**Additional Elements:**
- Toggle between Card view and List view
- Filter by: Health status, Staffing completion, Training completion
- "+ Create Custom Team" button
- Overall staffing summary: "32 of 45 roles filled across all teams (71%)"
- Phase indicator showing current phase context

**Sample Card Wireframe:**

```
┌─────────────────────────────────┐
│ 🎵  Worship Team               │
│─────────────────────────────────│
│ Leader: Sarah Johnson          │
│                                │
│ Staffing      ████████░░  8/10 │
│ Training      ██████░░░░  60%  │
│                                │
│ ● 2 roles need filling         │
│ ○ Next meeting: Jan 28         │
│                                │
│            [View Team]         │
└─────────────────────────────────┘
```

---

### 2. Team Detail View

Deep dive into a single ministry team.

**Header Section:**
- Team name, icon, description
- Team leader with contact info
- Reports to: (e.g., "Senior Pastor")
- Team health score with breakdown

**Tabs:**

#### Tab: Members & Roles
- Role-based roster showing:
  - Role name (e.g., "Drummer", "Sound Tech", "Vocalist")
  - Assigned person (or "OPEN" badge if unfilled)
  - Training status per person
  - Contact quick actions (email, text)
- Drag-and-drop reordering
- "+ Add Role" button
- "Assign Member" action on open roles

#### Tab: Responsibilities
- Checklist of team responsibilities from PRD/Playbook
- Toggle: Phase-specific responsibilities (e.g., Phase 3 vs Phase 4)
- Each responsibility shows:
  - Description
  - Assigned owner(s)
  - Status (Not Started / In Progress / Complete)
  - Due date if applicable

#### Tab: Training
- Required training programs for this team
- Completion matrix: rows = team members, columns = training programs
- Visual checkmarks for completed
- "Schedule Training" action

#### Tab: Meetings
- Displays meetings from the Meetings feature (F3) filtered by this team (`type = team_meeting`, `team_id` matching)
- Upcoming meetings list
- Past meetings with attendance records
- Quick add: "Schedule Meeting" (creates a team meeting in F3 with this team pre-selected)
- Meeting cards link to the unified meeting detail view in F3

> **Note:** Team meetings are managed through the Meetings feature (F3) and displayed here as a filtered view. Team communication is handled via the Communication Hub (F9). There is no Communication tab in this feature.

---

### 3. Role Definition Screen

Accessed when creating or editing a role within a team.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Role name | Text | Yes | Name of the role (e.g., "Drummer") |
| Role description | Rich text | No | Detailed responsibilities |
| Reports to | Dropdown | No | Other role within team |
| Required training | Multi-select | No | Training programs from Training Programs entity |
| Desired skills/gifts | Tags | No | Skills inventory matching |
| Time commitment | Dropdown | No | Low / Medium / High |
| Is leadership role | Toggle | No | Marks role as leadership position |
| Status | Dropdown | Yes | Open / Filled |

---

### 4. Team Member Assignment Modal

Triggered when assigning a person to a role.

**Flow:**
1. Search existing People/CRM database
2. Filter by: skills, gifts, availability, current team assignments
3. Preview person's profile:
   - Current team commitments
   - 4 C's assessment score
   - Training already completed
   - Skills/gifts inventory
4. Warning displayed if person is already on 2+ teams
5. Confirm assignment with optional start date
6. Optional: Send welcome notification to new member

---

### 5. Team Org Chart View

Visual representation of team structure.

**Features:**
- Hierarchical org chart showing:
  - Senior Pastor at top
  - Ministry team leaders below
  - Team members under each leader
- Click any node to view person details
- Toggle between: All Teams view / Single Team view
- Export as image/PDF
- Zoom and pan controls

---

### 6. Team Health Dashboard

Aggregate view of all teams' health metrics.

**Metrics Tracked per Team:**

| Metric | Description | Calculation |
|--------|-------------|-------------|
| Staffing % | Roles filled vs. needed | (filled roles / total roles) × 100 |
| Training % | Required training completed | (completed trainings / required trainings) × 100 |
| Meeting attendance | Participation rate | Average attendance last 4 meetings |
| Engagement score | Composite activity indicator | Weighted average of above metrics |
| Leader responsiveness | Assignment response time | Average time to acknowledge new assignments |

**Visualizations:**
- Radar chart comparing teams across metrics
- Trend lines showing improvement/decline over time
- Alert badges for teams needing attention
- Drill-down capability to team detail

**Alert Thresholds:**
- Staffing < 60% → Yellow alert
- Staffing < 40% → Red alert
- Training < 50% in Phase 3+ → Warning
- Meeting attendance < 50% → Yellow alert

---

### 7. Role Templates Library

Global template library of pre-built role definitions based on the Launch Playbook. Templates are code-defined (not stored in the database) and planters import them on demand into their church's team roles. Templates are not auto-seeded; planters choose which roles to import for each team.

**Organized by Team:**

**Worship Team:**
- Worship Leader
- Vocalist
- Drummer
- Bassist
- Guitarist
- Keys/Piano
- Sound Technician
- Slides/Lyrics Operator
- Stage Manager
- Setup/Teardown Lead

**Children's Ministry:**
- Children's Ministry Director
- Nursery Lead
- Preschool Lead
- Elementary Lead
- Check-in Coordinator
- Safety Coordinator
- Curriculum Coordinator

**Assimilation:**
- Assimilation Director
- Guest Reception Lead
- Follow-up Coordinator
- Data Entry Specialist
- Party with the Pastor Coordinator
- Peak Performance Coordinator

**Facilities:**
- Facilities Director
- Setup Lead
- Teardown Lead
- Parking Coordinator
- Signage Coordinator
- Storage Manager

**Small Groups:**
- Small Groups Director
- Small Group Coach
- Small Group Leader
- Apprentice Leader

**Promotion:**
- Promotion Director
- Social Media Coordinator
- Graphic Designer
- Print Materials Coordinator

**Prayer:**
- Prayer Director
- Prayer Team Lead
- Prayer Chain Coordinator

**Technology:**
- Technology Director
- Website Manager
- AV/Production Lead
- Database Administrator

**Actions:**
- Import template roles into team
- Customize role descriptions after import
- Add custom roles as needed

---

## Workflows

### Workflow 1: Initial Team Setup (Phase 2)

**Trigger:** Church enters Phase 2 (Launch Team Formation)

**Steps:**

```
[Enter Phase 2] 
    ↓
System prompts: "Time to establish Ministry Teams"
    ↓
[View Ministry Teams Dashboard]
    ↓
For each of 10 core teams:
    ↓
    [Select Team] → [Assign Team Leader]
        ↓
    [Import Role Templates] or create custom roles
        ↓
    [Assign Initial Members to Roles]
    ↓
Dashboard updates with staffing status
    ↓
[Exit Criteria Check]:
 - Required phase gate: Leaders assigned for the 8 primary ministry responsibilities
 - Operational readiness target: Leaders assigned for all 10 tracked teams
```

**Success Criteria:**
- Phase gate requirement satisfied for the 8 primary ministry responsibilities
- All 10 tracked teams have designated leaders (recommended operational target)
- Basic role structure defined for each team
- Dashboard shows accurate staffing percentages

---

### Workflow 2: Assigning a Member to a Team

**Trigger:** User clicks "Assign" on an open role

**Steps:**

```
[Team Detail View] → [Members & Roles Tab]
    ↓
Click "Assign" on open role
    ↓
[Member Assignment Modal opens]
    ↓
Search/filter People database
    ↓
Select person → Review profile
    ↓
[If person on 2+ teams]: Display warning
    ↓
Confirm assignment → Set start date (optional)
    ↓
System actions:
├── Updates Person record with team assignment
├── Emits `team.member.assigned` event (Task Management subscribes)
├── Sends notification to team leader
├── Sends welcome message to new member (optional)
└── Updates team staffing metrics
```

**Validation Rules:**
- Person must exist (valid `person_id` per [Core Data Contracts](../../core-data-contracts.md))
- Person cannot be assigned to same role twice
- Warning (not blocking) if person is on multiple teams

---

### Workflow 3: Tracking Team Training

**Trigger:** User views Training tab for a team

**Steps:**

```
[Team Detail View] → [Training Tab]
    ↓
View training completion matrix
    ↓
For incomplete training items:
    ↓
    Click "Schedule" → [Create Training Event form]
        ↓
    Set: Training program, Date/time, Location, Attendees
        ↓
    Save → Emits `training.scheduled` event
    ↓
As training completes:
    ↓
    Mark completion in TrainingCompletion entity
        ↓
    Training % auto-updates on dashboard
        ↓
    [If all required training complete]: Badge earned
```

---

### Workflow 4: Team Meeting Scheduling

**Trigger:** User clicks "Schedule Meeting" on Meetings tab

Team meetings are created through the unified Meetings feature (F3) with `type = team_meeting` and `team_id` linking to this team. The meeting form is pre-populated with the team context.

**Steps:**

```
[Team Detail View] → [Meetings Tab]
    ↓
Click "Schedule Meeting"
    ↓
[F3 Meeting Form] (pre-filled with type = team_meeting, team_id = this team):
├── Select meeting subtype (regular, training, planning, special, rehearsal)
├── Set date/time
├── Set location
├── Add notes/description
    ↓
Save meeting (created in F3 as a ChurchMeeting)
    ↓
System actions:
├── Guest list auto-populated from team roster (VM-027)
├── Meeting appears in both the team's Meetings tab and the main Meetings list
├── [Should Have] Email invitations sent to guest list via Communication Hub (F9)
├── [Should Have] Reminder scheduled via Communication Hub (F9)
```

**Meeting Subtype Templates (mapped to `meeting_subtype` enum):**
- Regular Team Meeting -> `regular`
- Training Session -> `training`
- Planning Meeting -> `planning`
- Special Event -> `special`
- Pre-Launch Rehearsal -> `rehearsal`

---

### Workflow 5: Weekly Team Health Check (Automated)

**Trigger:** Weekly scheduled process (configurable day/time)

**Steps:**

```
[Automated weekly process]
    ↓
For each ministry team:
    ↓
    Calculate metrics:
    ├── Staffing %: filled roles / total roles
    ├── Training %: completed / required
    ├── Meeting attendance: last 4 meetings average
    └── Engagement score: weighted composite
    ↓
    Apply alert rules:
    ├── Staffing < 60% → Yellow alert
    ├── Staffing < 40% → Red alert
    ├── Training < 50% (Phase 3+) → Warning
    └── Attendance < 50% → Yellow alert
    ↓
Update dashboard health indicators
    ↓
[If alerts generated]:
    ↓
    Send summary notification to Senior Pastor
    Send specific alerts to team leaders
```

---

## Acceptance Criteria

- AC-001 (MT-001, MT-008): Dashboard displays all 10 core teams with staffing status for each team.
- AC-002 (MT-002): Selecting a team opens a detail view with Members & Roles, Responsibilities, Training, and Meetings tabs.
- AC-003 (MT-003, MT-005): User can assign a person to a team role from the person directory; duplicate active assignment to the same role is blocked.
- AC-004 (MT-004, MT-007): User can add/edit roles and import predefined role templates by team.
- AC-005 (MT-006, MT-009): Staffing metrics update after assignment changes and remain visible at team and aggregate levels.
- AC-006 (MT-010): Team assignments are visible from the corresponding person profile.
- AC-007 (Phase coherence): In Phase 2, the workflow distinguishes required 8-role phase gating from the 10-team operational readiness target.
- AC-008 (Contract coherence): All feature-owned entities include `church_id`, and emitted events include `church_id`, `timestamp`, and `triggered_by`.

## Data Model

> **Note:** This feature owns the entities below. Shared entities (`Church`, `User`, `Person`, `Phase`) are defined in [Core Data Contracts](../../core-data-contracts.md). All tables include `church_id` for tenant scoping per architectural requirements.

### MinistryTeam

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| name | String | Yes | Team name |
| type | Enum | Yes | `predefined` / `custom` |
| description | Text | No | Team description |
| icon | String | No | Icon identifier |
| leader_id | UUID (FK) | No | Reference to Person |
| reports_to_team_id | UUID (FK) | No | Reference to parent MinistryTeam |
| phase_introduced | Enum | Yes | Phase 0-6 |
| status | Enum | Yes | `forming` / `active` / `paused` |
| created_by | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### TeamRole

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church (tenant scope) |
| team_id | UUID (FK) | Yes | Reference to MinistryTeam |
| name | String | Yes | Role name |
| description | Text | No | Role responsibilities |
| reports_to_role_id | UUID (FK) | No | Reference to parent TeamRole |
| is_leadership_role | Boolean | No | Default: false |
| time_commitment | Enum | No | `low` / `medium` / `high` |
| required_training_ids | UUID[] | No | Array of TrainingProgram IDs |
| desired_skills | String[] | No | Array of skill/gift tags |
| sort_order | Integer | No | Display order |
| status | Enum | Yes | `open` / `filled` |
| created_by | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### TeamMembership

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church (tenant scope) |
| team_id | UUID (FK) | Yes | Reference to MinistryTeam |
| person_id | UUID (FK) | Yes | Reference to Person |
| role_id | UUID (FK) | Yes | Reference to TeamRole |
| start_date | Date | No | When assignment began |
| end_date | Date | No | When assignment ended (if applicable) |
| status | Enum | Yes | `active` / `inactive` / `pending` |
| notes | Text | No | Assignment notes |
| created_by | UUID (FK) | Yes | Reference to User (assigner) |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

**Constraints:**
- Unique constraint on (team_id, person_id, role_id, status='active')
- Person can have multiple memberships (different teams/roles)
- `church_id` on TeamMembership must match related TeamRole, MinistryTeam, and Person

---

> **Note:** Team meetings and attendance are now managed through the unified Meetings feature (F3) using `ChurchMeeting` with `type = team_meeting` and `team_id` linking to the MinistryTeam. The `TeamMeeting` and `TeamMeetingAttendance` entities previously defined here have been superseded by `ChurchMeeting` and `MeetingAttendance` in F3.

---

### TrainingProgram

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church (tenant scope) |
| team_id | UUID (FK) | No | Reference to MinistryTeam (null = cross-team program) |
| name | String | Yes | Program name (e.g., "Child Safety Training") |
| description | Text | No | Program details |
| is_required | Boolean | Yes | Whether completion is mandatory. Default: false |
| created_by | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### TrainingCompletion

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church (tenant scope) |
| person_id | UUID (FK) | Yes | Reference to Person |
| training_program_id | UUID (FK) | Yes | Reference to TrainingProgram |
| completed_at | Timestamp | Yes | When training was completed |
| verified_by | UUID (FK) | No | Reference to User who verified completion |
| notes | Text | No | Completion notes |
| created_by | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

**Constraints:**
- Unique constraint on (person_id, training_program_id)
- `church_id` on TrainingCompletion must match related TrainingProgram and Person

---

## Integration Contracts

This feature integrates with other platform capabilities via events and shared entity references. See [Core Data Contracts](../../core-data-contracts.md) for shared entity definitions.

### Inbound (This Feature Consumes)

| Contract | Description |
|----------|-------------|
| **Person lookup** | Queries Person by `person_id`; expects `id`, `first_name`, `last_name`, `status` |
| **Skills/gifts lookup** | Queries `skillsInventory` by `person_id`; expects `skillCategory`, `skillName`, `proficiency` |
| **Assessment lookup** | Queries Assessment by `person_id`; expects 4 C's scores for Assignment Modal preview |
| **Background check status** | Reads `Person.background_check_status` (Children's Ministry). Dependency: F2 must add this field. |
| **`phase.changed` event** | Subscribes to adjust phase-aware UI and team responsibilities; expects `church_id`, `timestamp`, `triggered_by` |

### Outbound (This Feature Emits)

| Event | Payload | Subscribers May |
|-------|---------|-----------------|
| `team.member.assigned` | `{ team_id, person_id, role_id, church_id, timestamp, triggered_by }` | Create onboarding tasks, update dashboards |
| `team.staffing.changed` | `{ team_id, filled_count, total_count, church_id, timestamp, triggered_by }` | Update readiness metrics |
| `training.scheduled` | `{ team_id, person_ids[], training_type, datetime, church_id, timestamp, triggered_by }` | Create calendar events, tasks |

### Shared Entity References

Per [Core Data Contracts](../../core-data-contracts.md):
- Stores `person_id` (FK) — never duplicates Person profile fields
- Stores `church_id` (FK) — tenant scoping on all tables
- Stores `user_id` (FK) — audit and ownership

---

## Team-Specific Requirements

### Worship Team
- Service planning integration (future enhancement)
- Rehearsal scheduling with separate tracking
- Song database integration (future enhancement)
- Setup/teardown checklist assignment and ownership

### Children's Ministry
- Background check status tracking (reads `Person.background_check_status`)
- Room assignment management per service
- Curriculum selection and tracking
- Safety protocol acknowledgment tracking (required before serving)
- Child-to-volunteer ratio monitoring

### Assimilation
- Follow-up queue visibility (reads Person records with `status = 'guest'` or `'prospect'`)
- Guest Reception roster scheduling per service
- Party with the Pastor event planning integration
- Peak Performance class registration tracking

### Facilities
- Subscribes to `facility.confirmed` event for venue assignment context
- Setup/teardown checklist ownership and execution
- Storage inventory tracking (future enhancement)
- Venue contact relationship management

### Small Groups
- Small group leader assignment tracking
- Small Group 101 completion as prerequisite
- Apprentice program progress monitoring

---

## Non-Functional Requirements

### UI/UX
- Responsive design supporting desktop and mobile
- Progressive disclosure: simple view first, expand for details
- Phase awareness: show/hide content based on current phase
- Consistent iconography for all 10 teams

### Accessibility
- WCAG 2.1 AA compliance
- Keyboard navigation support
- Screen reader compatible
- Color-blind friendly status indicators (icons + colors)

### Performance
- Dashboard loads in < 2 seconds
- Team detail view loads in < 1.5 seconds
- Real-time updates for team health metrics
- Optimistic UI updates for assignments

### Mobile Considerations
- Team leaders need quick access to:
  - Member contact information
  - Attendance tracking (meeting check-in)
  - Quick messaging
- Swipe gestures for common actions
- Offline viewing of team roster (future enhancement)

---

## Authorization

| Role | Scope | Permissions |
|------|-------|-------------|
| **Planter** | All teams | Full CRUD on all teams, roles, memberships, meetings, training |
| **Team Leader** | Own team only | Assign/remove members, edit roles, schedule meetings, record attendance, manage training within the team they lead |
| **Team Member** | Own teams (read) | View team details and own assignments. No write access. |
| **Coach** | Assigned church (read) | Read-only access to team dashboards for assigned planters |

**Enforcement rules:**
- Team leader status is determined by `MinistryTeam.leader_id` matching the Person record linked to the current User.
- A user who is team leader for multiple teams has write access to each of those teams.
- Planters always have full access regardless of team leader assignment.
- Write operations validate the user's role and team leader status before proceeding.

---

## Success Metrics

### Feature Adoption
- % of planters using Ministry Team Management
- Average time to complete initial team setup
- Number of custom roles created vs. templates used

### Team Health
- Average staffing % across all churches at launch
- Training completion rates by phase
- Meeting attendance trends

### User Satisfaction
- Feature satisfaction score (NPS)
- Task completion rate for key workflows
- Support ticket volume related to team management

---

## Oversight Access Patterns

### Coach Access
- Can view team rosters, meeting records, and team health for assigned churches

### Sending Church Admin Access
- Aggregate team metrics only: teams formed count, staffing completion %, team health scores
- Subject to `share_ministry_teams` privacy toggle

### Network Admin Access
- Aggregate team metrics across all plants in the network
- Subject to `share_ministry_teams` privacy toggle

### Privacy Controls
- Planter controls visibility via per-feature privacy toggle in church privacy settings
- Privacy toggle for this feature: `share_ministry_teams`
- Default: `false` (not shared until planter opts in)

---

## Open Questions

1. **Member self-service:** Should team members have their own login to view assignments, update availability, and access team communications?

2. **Multi-team limits:** Should there be a hard limit on how many teams a person can join, or just warnings?

3. **Bench concept:** Should there be a "bench" or "interested" status for people considering a team but not yet assigned to a role?

4. ~~**Permission model:** Can team leaders edit roles and make assignments, or is this Senior Pastor only?~~ **Resolved:** Team leaders can manage their own team (assign members, edit roles). Planters have full access to all teams. See Authorization section.

5. **Historical tracking:** How long should we retain team membership history after someone leaves a role?

6. **Reporting structure:** Should teams have formal reporting hierarchies, or is the flat list sufficient?

---

## Future Enhancements

### Release 2 (Post-MVP)
- Service scheduling and rotation management
- Volunteer availability and scheduling preferences
- Automated scheduling based on availability
- Team performance analytics and insights

### Release 3 (Long-term)
- Integration with external volunteer management tools
- Advanced reporting and trend analysis
- Team communication via integrated chat
- Mobile app with push notifications
- Offline mode for meeting attendance

---

## Appendix: Launch Playbook Reference

This feature directly supports the Launch Playbook methodology for establishing the 8 primary ministry responsibilities:

> "Leadership emerges from the Core Group to comprehensively own the 8 primary responsibilities of the launch."

The platform extends this to 10 teams to provide more granular organization and tracking, adding Senior Pastor and Launch Coordinator as explicit teams for complete visibility.

### Key Playbook Principles Implemented:
- Team leaders identified during Phase 2 (Launch Team Formation)
- Training completion required before Phase 4 (Pre-Launch)
- All teams have clear responsibilities and checklists for Launch Sunday
- Ongoing team health monitoring supports the 8 Critical Success Factors
