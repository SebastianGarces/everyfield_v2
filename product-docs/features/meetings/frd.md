# F3: Meetings
## Feature Requirements Document (FRD)

**Version:** 2.0  
**Date:** February 9, 2026  
**Feature Code:** F3

---

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services

---

## Overview

Meetings provides a unified system for planters to plan, execute, and track all recurring gatherings throughout the church plant journey. The platform supports three meeting types through a single entity with a `type` discriminator:

| Type | Purpose | Phase Focus |
|------|---------|-------------|
| **Vision Meeting** | Cast compelling vision to grow the Core Group. Numbered sequentially per church. | Phase 1 (Core Group Development) |
| **Orientation** | Onboard new members, explain expectations and ministry structure. | Phase 2+ |
| **Team Meeting** | Coordinate ministry team activities, training, and planning. Linked to a specific ministry team. | Phase 2+ |

All meeting types share: scheduling, attendance capture, guest list management, email invitations (via Communication Hub), and analytics. Vision meetings additionally support evaluation scoring, materials checklists, and logistics tracking.

---

## Access Prerequisites

- Requires a paid subscription and an active church plant. Free-tier users have access to the Wiki (F1) only.
- User flow: sign up -> subscribe (paid) -> create church plant -> this feature becomes available.
- Once a church plant exists, this feature is available regardless of current phase.

---

## User-Visible Behavior

Users can:

- Schedule and manage meetings of any type with date, location, status, and notes
- Filter the meeting list by type (All, Vision Meetings, Orientations, Team Meetings)
- Capture attendance during or after meetings, including new vs returning attendee status
- Manage a guest list for each meeting and send email invitations via the Communication Hub (F9)
- Track RSVP status (pending, confirmed, declined, no response) for guest list members
- Auto-populate team meeting guest lists from the ministry team roster
- Link attendees to Person records and create new Person records inline
- Generate and monitor 48-hour follow-up tasks for new attendees at vision meetings
- View meeting-level outcomes and trends (attendance, follow-up, and conversion indicators)
- Evaluate completed vision meetings using a consistent eight-factor quality rubric
- Create team meetings from within the Ministry Teams feature (F8) or from the Meetings list

---

## Vision Meeting Quality Factors

Every Vision Meeting should aim to achieve these 8 meeting-level quality factors:

1. **Great Attendance** - Core Group actively inviting
2. **Acceptable Location** - Easy to find, welcoming, distraction-free
3. **Great Logistics** - Room ready, AV tested, materials prepared
4. **Clear Agenda** - Planned in detail, starts and ends on time
5. **Great Vibe** - Warm, inviting, enthusiastic
6. **Compelling Message** - Clear vision presented effectively
7. **Strong Close** - Non-manipulative call to action
8. **Clear Next Steps** - Dates and details communicated

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement | Description |
|----|-------------|-------------|
| VM-001 | Meeting scheduling | Create meetings with date, time, location, and type |
| VM-002 | Meeting list view | View all upcoming and past meetings with type filter tabs |
| VM-003 | Attendance capture | Record who attended each meeting |
| VM-004 | New vs returning tracking | Distinguish first-time from returning attendees |
| VM-005 | Attendee-to-person linking | Create Person records for new attendees (F2 integration) |
| VM-006 | Guest list management | Add people from CRM to a meeting's guest list; auto-populate from team roster for team meetings |
| VM-007 | Follow-up task generation | Emit event that triggers follow-up task creation for new vision meeting attendees (F5 integration) |
| VM-008 | Meeting detail view | Full view of meeting details, attendance, and outcomes |
| VM-009 | Location management | Save and reuse venue information across meeting types |
| VM-010 | Basic analytics | Track attendance counts and trends, filterable by meeting type |
| VM-026 | Meeting types | Support vision_meeting, orientation, and team_meeting types with type-specific behavior |
| VM-028 | RSVP tracking | Track invited / confirmed / declined / no_response status per guest list member |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| VM-011 | Email invitation sending | Trigger email invitations to guest list members via Communication Hub (F9) using meeting templates |
| VM-012 | Materials checklist | Checklist of required materials (Vision Meeting kit) — vision meetings only |
| VM-013 | Agenda builder | Create and customize meeting agendas |
| VM-014 | Response card capture | Record response card data (interested, ready to commit, etc.) — vision meetings only |
| VM-015 | Meeting evaluation | Self-assess 8 meeting quality factors after each vision meeting |
| VM-016 | Success score tracking | Calculate and trend success scores over time — vision meetings only |
| VM-018 | Meeting reminders | Automated reminders to guest list before meetings, delivered via Communication Hub (F9) |
| VM-019 | Calendar integration | Create calendar events for meetings |
| VM-020 | Follow-up completion tracking | Show follow-up completion percentage per vision meeting |
| VM-027 | Team meeting auto-roster | Auto-populate guest list from team roster when creating a team meeting |
| VM-029 | Meeting subtypes | Team meetings support subtypes: regular, training, planning, special, rehearsal |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| VM-021 | Digital check-in | QR code or tablet-based self-service check-in |
| VM-022 | Recurring scheduling | Automatically schedule recurring meetings |
| VM-023 | Virtual meeting support | Support for hybrid or fully virtual meetings |
| VM-024 | SMS confirmations | Text confirmation requests to guest list members |
| VM-025 | Attendance predictions | AI-based attendance forecasting |

---

## Acceptance Criteria

1. User can create a meeting with date/time, type, and either a saved venue or ad-hoc location details, and the record appears in the list view.
2. List view supports upcoming and past meetings with type filter tabs (All, Vision Meetings, Orientations, Team Meetings), and each row links to a meeting detail page.
3. User can record attendance for a meeting and mark each attendee as `first_time`, `returning`, or `core_group`.
4. For first-time attendees, user can create or link a Person record from the attendance workflow.
5. User can add people from the CRM to a meeting's guest list and track RSVP status per invitee.
6. For team meetings, guest list auto-populates from the ministry team roster.
7. Finalizing attendance for new vision meeting attendees creates follow-up tasks with due date at meeting date + 48 hours.
8. Meeting detail view shows core meeting data, attendance totals, and follow-up completion status.
9. Venue records can be saved and reused across multiple meetings within the same `church_id`.
10. Analytics view provides at minimum attendance count trend and new-vs-returning split over time, filterable by meeting type.
11. Vision meeting numbers are auto-assigned sequentially per church and displayed as "Vision Meeting #N".
12. Team meetings display their linked ministry team name.
13. All reads/writes enforce tenant scoping by `church_id`.

### Should Have

14. [VM-015] User can rate each of the 8 meeting quality factors on a 1-5 scale after a vision meeting is completed.
15. [VM-016] Meeting detail view shows calculated success score (average of 8 factors) and comparison to previous meetings.
16. [VM-012] When creating a vision meeting, a materials checklist is auto-populated from the standard kit template; items can be checked off, assigned, and annotated.
17. [VM-020] Meeting detail view shows follow-up completion percentage for new vision meeting attendees.
18. [VM-011] User can send email invitations to all guest list members via the Communication Hub, using meeting-specific templates with auto-filled merge fields.

---

## Screens

Screen mockups may include Should Have elements when those capabilities are enabled.

### 1. Meetings List

Primary view for all meetings.

**Layout:**

```
+------------------------------------------------------------------------------+
|  Meetings                                           [+ Schedule Meeting]     |
+------------------------------------------------------------------------------+
|                                                                              |
|  Type: [All] [Vision Meetings] [Orientations] [Team Meetings]               |
|  View: [Upcoming] [Past] [All]                             Filter: [All v]  |
|                                                                              |
|  -------------------------------------------------------------------------   |
|                                                                              |
|  UPCOMING                                                                    |
|                                                                              |
|  +------------------------------------------------------------------------+  |
|  | Jan 28, 2026 * 7:00 PM                          [Vision Meeting]       |  |
|  | Vision Meeting #12                                                     |  |
|  | Location: Community Center, Room B                                     |  |
|  |                                                                        |  |
|  | Guest List: 45 invited * 28 confirmed * 12 pending                     |  |
|  | Materials: Ready                                                       |  |
|  |                                                     [View] [Edit]      |  |
|  +------------------------------------------------------------------------+  |
|                                                                              |
|  +------------------------------------------------------------------------+  |
|  | Feb 1, 2026 * 10:00 AM                          [Orientation]          |  |
|  | New Member Orientation                                                 |  |
|  | Location: Main Office                                                  |  |
|  |                                                                        |  |
|  | Guest List: 8 invited * 6 confirmed                                    |  |
|  |                                                     [View] [Edit]      |  |
|  +------------------------------------------------------------------------+  |
|                                                                              |
|  +------------------------------------------------------------------------+  |
|  | Feb 3, 2026 * 6:30 PM                           [Team Meeting]         |  |
|  | Worship Team - Training Session                                        |  |
|  | Location: Rehearsal Room                                                |  |
|  |                                                                        |  |
|  | Guest List: 10 (auto-roster) * 8 confirmed                             |  |
|  |                                                     [View] [Edit]      |  |
|  +------------------------------------------------------------------------+  |
|                                                                              |
|  -------------------------------------------------------------------------   |
|                                                                              |
|  PAST (Recent)                                                               |
|                                                                              |
|  +------------------------------------------------------------------------+  |
|  | Jan 14, 2026 * 7:00 PM                          [Vision Meeting]       |  |
|  | Vision Meeting #11                               Completed              |  |
|  | Location: Community Center, Room B                                     |  |
|  |                                                                        |  |
|  | Attended: 32 (18 new, 14 returning)                                    |  |
|  | Follow-up: 16/18 complete (89%)                                        |  |
|  | Success Score: 4.2/5                                                   |  |
|  |                                                     [View] [Report]    |  |
|  +------------------------------------------------------------------------+  |
|                                                                              |
+------------------------------------------------------------------------------+
```

---

### 2. Meeting Detail (Planning Mode)

For upcoming meetings. Tabs vary by meeting type.

**Header:**
- Meeting title (auto-generated for vision meetings: "Vision Meeting #N"; user-provided for others)
- Type badge (Vision Meeting, Orientation, Team Meeting)
- Date, time, location
- Days until meeting countdown
- Status: Planning / Ready / In Progress / Completed

**Tabs:**

#### Tab: Details
- Date/time with calendar integration
- Location selection (from saved venues)
- Meeting type and subtype (team meetings only)
- Linked ministry team (team meetings only)
- Estimated attendance
- Notes and special instructions

#### Tab: Guest List
- Add people from CRM search or by group (Core Group, team roster, etc.)
- For team meetings: auto-populated from team roster with option to add/remove
- RSVP status per invitee (pending, confirmed, declined, no response)
- "Send Invitations" button: triggers email via Communication Hub (F9) using meeting templates
- Overall guest list metrics (total, confirmed, declined, pending)

#### Tab: Logistics (vision meetings only)
- Materials checklist (from kit):
  - Guest Sign-in Sheet
  - Name Tags
  - Welcome Brochure
  - Response Cards
  - Business Cards
  - Banners (4 Pillars, Worship/Walk/Work, Mission)
  - AV Equipment
  - Refreshments
- Each item: checkbox + notes + assigned owner

#### Tab: Agenda
- Meeting agenda builder
- Default template sections (vision meetings):
  - Welcome & Introductions (10 min)
  - Worship/Prayer (10 min)
  - Vision Presentation (30 min)
  - Q&A (15 min)
  - Response/Next Steps (10 min)
  - Fellowship/Refreshments (15 min)
- Customizable timing and content

---

### 3. Meeting Detail (Completed)

For past meetings.

**Tabs:**

#### Tab: Attendance
- Full attendee list with status:
  - First-time (new)
  - Returning
  - Core Group Member
- Manual attendance entry
- Attendance comparison to previous meetings

#### Tab: Follow-Up (vision meetings only)
- Auto-generated follow-up tasks for new attendees
- Task status tracking:
  - Pending
  - In Progress
  - Completed
  - Overdue
- 48-hour deadline indicator

#### Tab: Outcomes (vision meetings only)
- Response card summary:
  - Interested in learning more
  - Ready to commit
  - Has questions
  - Not interested
- Conversion tracking (who moved to next pipeline stage)

#### Tab: Evaluation (vision meetings only)
- Self-assessment of 8 meeting quality factors (1-5 scale each)
- Notes for improvement
- Comparison to previous meetings
- Overall success score

---

### 4. Attendance Capture Screen

Simplified view for during/after meeting.

**Layout:**

```
+------------------------------------------------------------------------------+
|  Vision Meeting #12 - Attendance                              Jan 28, 2026   |
+------------------------------------------------------------------------------+
|                                                                              |
|  Search or add attendee...                                                   |
|                                                                              |
|  -------------------------------------------------------------------------   |
|                                                                              |
|  QUICK ADD                                                                   |
|  +------------------------------------------------------------------------+  |
|  | First Name: [          ]  Last Name: [          ]                      |  |
|  | Email: [                    ]  Phone: [              ]                  |  |
|  |                                                       [Add Attendee]   |  |
|  +------------------------------------------------------------------------+  |
|                                                                              |
|  -------------------------------------------------------------------------   |
|                                                                              |
|  ATTENDEES (32)                                         New: 18 | Return: 14 |
|                                                                              |
|  [x] John Smith          Core Group                                          |
|  [x] Sarah Johnson       First Time                                          |
|  [x] Mike Williams       First Time                                          |
|  [x] Lisa Davis          Returning         2nd visit                         |
|  [x] Amy Chen            Core Group                                          |
|  [x] Tom Brown           First Time                                          |
|  ...                                                                         |
|                                                                              |
|  -------------------------------------------------------------------------   |
|                                                                              |
|                                            [Generate Follow-Up Tasks]        |
|                                                                              |
+------------------------------------------------------------------------------+
```

---

### 5. Guest List Management

Manage who is invited to a meeting and send email invitations.

**Layout:**

```
+------------------------------------------------------------------------------+
|  Guest List - Vision Meeting #12                               Jan 28, 2026  |
+------------------------------------------------------------------------------+
|                                                                              |
|  SUMMARY                                                                     |
|  +------------+  +------------+  +------------+  +------------+              |
|  |     45     |  |     28     |  |      5     |  |     12     |              |
|  |   Total    |  | Confirmed  |  |  Declined  |  |  Pending   |              |
|  +------------+  +------------+  +------------+  +------------+              |
|                                                                              |
|  -------------------------------------------------------------------------   |
|                                                                              |
|  ADD PEOPLE                                                                  |
|  [Search people or select group...]                                          |
|  Quick Add: [All Core Group] [Worship Team] [Custom...]                      |
|                                                                              |
|                                                    [Send Invitations]        |
|                                                                              |
|  -------------------------------------------------------------------------   |
|                                                                              |
|  GUEST LIST                                                                  |
|                                                                              |
|  Name                 Email                RSVP Status    Invited             |
|  -------------------------------------------------------------------------   |
|  John Smith           john@email.com       Confirmed      Jan 20             |
|  Sarah Johnson        sarah@email.com      Confirmed      Jan 20             |
|  Mike Williams        mike@email.com       Pending        Jan 22             |
|  Lisa Davis           lisa@email.com       Declined       Jan 20             |
|  Tom Brown            tom@email.com        No Response    Jan 22             |
|  ...                                                                         |
|                                                                              |
|  -------------------------------------------------------------------------   |
|                                                                              |
|  [Resend to Pending]                              Showing 1-20 of 45        |
|                                                                              |
+------------------------------------------------------------------------------+
```

---

### 6. Analytics Dashboard

Meeting effectiveness over time.

**Requirement tier:** Must Have baseline (VM-010) with expanded Should Have metrics (VM-016, VM-020)

**Metrics Displayed:**

- Attendance trend chart (line graph over time), filterable by meeting type
- New vs. returning attendees (stacked bar)
- Guest list effectiveness:
  - RSVP response rate
  - Confirmation-to-attendance rate
- Follow-up metrics (vision meetings):
  - 48-hour completion rate
  - Follow-up-to-commitment conversion
- Meeting quality factor trends (radar chart) — vision meetings only
- Source effectiveness (where attendees come from)

---

## Workflows

### Workflow 1: Schedule New Meeting

**Trigger:** User clicks "+ Schedule Meeting"

**Steps:**

```
[+ Schedule Meeting]
    |
[Meeting Form]:
+-- Select meeting type (Vision Meeting, Orientation, Team Meeting)
+-- If team meeting: select ministry team + optional subtype
+-- Select date and time
+-- Select location (from saved or add new)
+-- Set estimated attendance
+-- Add notes
    |
[Save]
    |
Meeting created
    |
System actions:
+-- Meeting status set to "planning" (Must Have)
+-- If vision meeting: meeting_number auto-assigned
+-- If team meeting: guest list auto-populated from team roster (VM-027)
+-- [Should Have: VM-019] Calendar event created
+-- [Should Have: VM-018] Reminder scheduled via Communication Hub (F9)
+-- [Should Have: VM-012] Materials checklist populated from template (vision meetings only)
```

---

### Workflow 2: Pre-Meeting Preparation (Should Have: VM-018)

**Trigger:** Meeting is 1 week away and reminders are enabled

**Steps:**

```
[Automated reminder: Meeting in 7 days]
    |
Send reminder to guest list via Communication Hub (F9)
    |
[Day -3]: Materials checklist reminder to logistics owner (vision meetings)
    |
[Day -1]: Final guest list count email to planter
    |
[Day of]: Meeting status set to "Ready"
```

---

### Workflow 3: Capture Attendance

**Trigger:** During or after meeting

**Steps:**

```
[Open Attendance Capture screen]
    |
For each attendee:
+-- Search existing contacts OR quick add new
+-- Mark attendance type (First-time, Returning, Core Group)
+-- Capture response card data (optional, vision meetings)
    |
[Finalize Attendance]
    |
System actions:
+-- Create Person records for new contacts
+-- Emit `meeting.attendance.recorded` per attendee (F2 handles status progression for vision meetings)
+-- Emit `meeting.attendance.finalized` (F5 handles follow-up task creation for vision meetings)
```

---

### Workflow 4: Post-Meeting Follow-Up (Vision Meetings)

**Trigger:** Vision meeting attendance finalized

**Steps:**

```
[Finalize Attendance]
    |
F3 emits `meeting.attendance.finalized` event:
+-- Payload: { meeting_id, new_attendee_ids[], church_id, meetingType }
    |
F5 subscribes and creates follow-up tasks:
+-- One task per new attendee: "Follow up with [Name]"
+-- Assigned to: Senior Pastor (default) or customize
+-- Due date: Meeting date + 48 hours
+-- Priority: High
+-- Link to Person record
    |
Tasks appear in Task Management (F5)
    |
As follow-up completed:
+-- Mark task complete
+-- Update Person status
+-- Log communication in Person timeline
    |
Follow-up completion % updates on meeting detail
```

---

### Workflow 5: Meeting Evaluation (Should Have: VM-015, VM-016)

**Trigger:** Vision meeting completed, attendance captured

**Steps:**

```
[Meeting Detail] -> [Evaluation Tab]
    |
Rate each of 8 meeting quality factors (1-5):
+-- Great Attendance
+-- Acceptable Location
+-- Great Logistics
+-- Clear Agenda
+-- Great Vibe
+-- Compelling Message
+-- Strong Close
+-- Clear Next Steps
    |
Add improvement notes
    |
[Save Evaluation]
    |
Success score calculated
    |
Comparison to previous meetings shown
    |
Insights generated:
+-- "Attendance up 15% from last meeting"
+-- "Follow-up completion below target"
+-- "Location rated lower - consider change"
```

---

### Workflow 6: Guest List and Email Invitations

**Trigger:** User opens Guest List tab for a meeting

**Steps:**

```
[Meeting Detail] -> [Guest List Tab]
    |
Add people to guest list:
+-- Search CRM for individuals
+-- Quick add groups (Core Group, specific team, etc.)
+-- For team meetings: auto-populated from team roster
    |
Review guest list, manage RSVP status
    |
[Send Invitations] button
    |
Communication Hub (F9):
+-- Auto-select meeting invitation template by meeting type
+-- Auto-fill merge fields (meeting title, date, location, type)
+-- Optional: preview before sending
+-- Send emails to all pending/unsent invitees
    |
Emails delivered, delivery status tracked in F9
    |
Guest list updated:
+-- invited_at timestamp set
+-- RSVP responses update rsvp_status as they come in
    |
[Resend to Pending] action available for follow-up
```

---

## Data Model

### ChurchMeeting

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| type | Enum | Yes | `vision_meeting` / `orientation` / `team_meeting` |
| team_id | UUID (FK) | No | Reference to MinistryTeam (required for team_meeting) |
| meeting_number | Integer | No | Sequential meeting number (vision meetings only) |
| title | String | No | Meeting title (auto-generated for vision meetings) |
| meeting_subtype | Enum | No | `regular` / `training` / `planning` / `special` / `rehearsal` (team meetings only) |
| datetime | Timestamp | Yes | Meeting date and time |
| duration_minutes | Integer | No | Expected duration |
| location_id | UUID (FK) | No | Reference to saved Location |
| location_name | String | No | Location name (if not using saved) |
| location_address | String | No | Full address |
| estimated_attendance | Integer | No | Projected attendance |
| actual_attendance | Integer | No | Final attendance count |
| status | Enum | Yes | `planning` / `ready` / `in_progress` / `completed` / `cancelled` |
| notes | Text | No | General notes |
| agenda | JSON | No | Structured agenda data |
| created_by | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

**Auto-numbering:** For vision meetings, `meeting_number` is automatically assigned as the next sequential integer per `church_id` on creation. Not user-editable.

**Team meeting constraint:** When `type` is `team_meeting`, `team_id` must be set.

---

### MeetingAttendance

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| meeting_id | UUID (FK) | Yes | Reference to ChurchMeeting |
| person_id | UUID (FK) | Yes | Reference to Person |
| attendance_type | Enum | Yes | `first_time` / `returning` / `core_group` |
| response_status | Enum | No | `interested` / `ready_commit` / `questions` / `not_interested` (vision meetings only) |
| notes | Text | No | Notes from response card |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

**Constraints:**
- Unique constraint on (meeting_id, person_id)

---

### MeetingInvitee

Guest list for meeting invitations.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| meeting_id | UUID (FK) | Yes | Reference to ChurchMeeting |
| person_id | UUID (FK) | Yes | Reference to Person |
| rsvp_status | Enum | Yes | `pending` / `confirmed` / `declined` / `no_response` |
| invited_at | Timestamp | No | When invitation email was sent |
| responded_at | Timestamp | No | When person responded |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

**Constraints:**
- Unique constraint on (meeting_id, person_id)

---

### Location

Saved venue information for reuse across all meeting types.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| name | String | Yes | Venue name |
| address | String | Yes | Full address |
| contact_name | String | No | Venue contact person |
| contact_phone | String | No | Contact phone |
| contact_email | String | No | Contact email |
| cost | Decimal | No | Cost per use |
| capacity | Integer | No | Maximum capacity |
| notes | Text | No | Notes about venue |
| is_active | Boolean | Yes | Default: true |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### MeetingEvaluation

Self-assessment of vision meeting effectiveness.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| meeting_id | UUID (FK) | Yes | Reference to ChurchMeeting |
| attendance_score | Integer | Yes | 1-5 rating |
| location_score | Integer | Yes | 1-5 rating |
| logistics_score | Integer | Yes | 1-5 rating |
| agenda_score | Integer | Yes | 1-5 rating |
| vibe_score | Integer | Yes | 1-5 rating |
| message_score | Integer | Yes | 1-5 rating |
| close_score | Integer | Yes | 1-5 rating |
| next_steps_score | Integer | Yes | 1-5 rating |
| total_score | Decimal | Yes | Average of all scores |
| notes | Text | No | Improvement notes |
| evaluated_by | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### MeetingChecklistItem

Track materials preparation per vision meeting (Should Have: VM-012).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| meeting_id | UUID (FK) | Yes | Reference to ChurchMeeting |
| item_name | String | Yes | Name of checklist item |
| category | Enum | Yes | `essential` / `materials` / `setup` / `av` / `organization` |
| is_checked | Boolean | Yes | Default: false |
| notes | Text | No | Item-specific notes |
| assigned_to | UUID (FK) | No | Reference to Person responsible |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

## Vision Meeting Kit Checklist

Standard materials tracked per vision meeting:

| Item | Category | Notes |
|------|----------|-------|
| Guest Sign-in Sheet | Essential | Download template from F6 |
| Name Tags | Essential | Include markers |
| Welcome Brochure | Materials | Church-specific content |
| Constitution/Doctrinal Brochure | Materials | If available |
| Response Card | Essential | Track interest level |
| Business Cards | Materials | Senior Pastor cards |
| Yard Signs | Setup | Directional signage |
| 4 Pillars Banner w/Stand | Setup | Visual display |
| Worship/Walk/Work Banner w/Stand | Setup | Visual display |
| Mission Statement Banner w/Stand | Setup | Visual display |
| Branded Pens | Materials | For response cards |
| Content Boxes & Labels | Organization | Storage containers |
| Flash drive | AV | Presentation, videos |
| Portable Suitcase/Kit | Organization | All-in-one transport |
| Extension Cord | AV | Power extension |
| Clipboards | Materials | For sign-in |
| Markers | Materials | For name tags |
| Laptop Speakers | AV | Audio backup |

---

## Integration Contracts

This feature integrates with cross-cutting services and shared canonical models defined in [System Architecture](../../system-architecture.md).

### Inbound (This Feature Consumes)

| Data | Contract | Source |
|------|----------|--------|
| **Person lookup** | Read `Person.id`, `first_name`, `last_name`, `email` for attendance, guest list, and invitation sending | People/CRM (F2) |
| **Team roster lookup** | Read team membership by `team_id` to auto-populate guest list for team meetings | Ministry Teams (F8) |
| **Template access** | Read template list by category `meeting_invitation` for materials checklist and email templates | Communication Hub (F9) |

### Outbound (This Feature Provides)

| Event/Data | Contract | Consumers May |
|------------|----------|---------------|
| **`meeting.attendance.recorded`** | Emits `{ meeting_id, person_id, attendance_type, church_id, meetingType }` per attendee | F2 subscribes to auto-advance person status (Prospect to Attendee) for vision meetings |
| **`meeting.attendance.finalized`** | Emits `{ meeting_id, new_attendee_ids[], church_id, meetingType }` when attendance is finalized | F5 subscribes to create follow-up tasks (due date = meeting date + 48 hours) for vision meetings |
| **`meeting.completed`** | Emits `{ meeting_id, attendance_count, new_attendee_count, church_id, meetingType }` | Update dashboard metrics |
| **Meeting invitation requests** | Expose meeting details (title, datetime, location, type) and guest list (person IDs) to Communication Hub for email delivery | F9 sends invitation emails using meeting templates |
| **Meeting metrics** | Exposes attendance counts and trends by `church_id`, filterable by meeting type | Dashboard aggregation |

---

## Non-Functional Requirements

- **Tenant isolation:** All feature entities and emitted events must carry `church_id` and enforce church-scoped access.
- **Performance:** Meeting list and detail pages should load in under 2 seconds for typical church datasets.
- **Reliability:** Attendance finalization and follow-up task generation must be atomic to avoid partial post-meeting state.
- **Auditability:** Meeting creation, attendance finalization, status changes, and evaluation saves must be audit logged with `user_id` and timestamp.
- **Security:** Only authorized users for the active church can create, update, or view meeting data.

---

## Success Metrics

### Meeting Effectiveness
- Average attendance per meeting (by type)
- New attendee percentage (vision meetings)
- Attendance growth trend

### Guest List and RSVP
- RSVP response rate (percentage of invitees who respond)
- Confirmation-to-attendance rate (confirmed invitees who actually attend)
- Guest list utilization (percentage of meetings using guest lists)

### Follow-Up (Vision Meetings)
- 48-hour follow-up completion rate (target: 100%)
- Follow-up-to-commitment conversion rate
- Average time to follow-up

### Overall
- Meeting quality factor score trends (vision meetings)
- Meeting-to-commitment pipeline conversion

---

## Oversight Access Patterns

### Coach Access
Coaches can view the meeting list, attendance records (including new vs. returning breakdowns), follow-up completion status, and meeting evaluations for their assigned churches. Access is read-only.

### Sending Church Admin Access
Sending church admins can see aggregate meeting metrics: total meetings held, average attendance, new attendee trends, and follow-up completion rates. No individual attendee records are visible. Subject to the planter's `share_meetings` privacy toggle.

### Network Admin Access
Network admins can see aggregate meeting metrics across all plants in their network -- meeting frequency, average attendance, and follow-up performance benchmarks. Subject to each planter's `share_meetings` privacy toggle.

### Privacy Controls
- Planter controls visibility via per-feature privacy toggle in church privacy settings
- Privacy toggle for this feature: `share_meetings`
- Default: `false` (not shared until planter opts in)
- When `share_meetings` is `false`, sending church admins and network admins see no data for this feature

---

## Open Questions

1. **Digital check-in:** Should there be a self-service digital check-in option (QR code, tablet)?

2. **Calendar sync:** Bidirectional calendar sync or one-way push to Google/Outlook?

3. **Recurring meetings:** Support for automatically scheduling recurring meetings?

4. **Virtual meetings:** Support for hybrid or fully virtual meetings?

5. **Response card digitization:** Should response cards be captured digitally during meeting or paper then entered?

6. **Orientation completion tracking:** Should completing an orientation trigger any pipeline advancement or is it purely informational?
