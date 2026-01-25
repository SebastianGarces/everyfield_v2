# F3: Vision Meeting Management
## Feature Requirements Document (FRD)

**Version:** 1.1  
**Date:** January 25, 2026  
**Feature Code:** F3

---

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services
- [Core Data Contracts](../../core-data-contracts.md) - Shared entity contracts (Church, User, Person, Phase)

---

## Overview

Vision Meeting Management enables planters to plan, execute, and track Vision Meetings as the primary engine for Core Group growth. Vision Meetings are gatherings where the Senior Pastor and key leaders cast compelling vision that transforms interested individuals into committed members.

This feature covers the full lifecycle: scheduling, logistics planning, attendance capture, follow-up generation, and effectiveness analysis.

---

## Vision Meeting Success Factors

Every Vision Meeting should aim to achieve these 8 critical success factors:

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
| VM-001 | Meeting scheduling | Create Vision Meetings with date, time, and location |
| VM-002 | Meeting list view | View all upcoming and past Vision Meetings |
| VM-003 | Attendance capture | Record who attended each meeting |
| VM-004 | New vs returning tracking | Distinguish first-time from returning attendees |
| VM-005 | Attendee-to-person linking | Create Person records for new attendees (F2 integration) |
| VM-006 | Invited-by tracking | Record which Core Group member invited each attendee |
| VM-007 | Follow-up task generation | Auto-create follow-up tasks for new attendees (F5 integration) |
| VM-008 | Meeting detail view | Full view of meeting details, attendance, and outcomes |
| VM-009 | Location management | Save and reuse venue information |
| VM-010 | Basic analytics | Track attendance counts and trends |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| VM-011 | Invitation tracking | Track how many people each Core Group member invited |
| VM-012 | Materials checklist | Checklist of required materials (Vision Meeting kit) |
| VM-013 | Agenda builder | Create and customize meeting agendas |
| VM-014 | Response card capture | Record response card data (interested, ready to commit, etc.) |
| VM-015 | Meeting evaluation | Self-assess 8 success factors after each meeting |
| VM-016 | Success score tracking | Calculate and trend success scores over time |
| VM-017 | Invitation leaderboard | Show Core Group invitation activity rankings |
| VM-018 | Meeting reminders | Automated reminders to Core Group before meetings |
| VM-019 | Calendar integration | Create calendar events for meetings |
| VM-020 | Follow-up completion tracking | Show follow-up completion percentage per meeting |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| VM-021 | Digital check-in | QR code or tablet-based self-service check-in |
| VM-022 | Recurring scheduling | Automatically schedule recurring Vision Meetings |
| VM-023 | Virtual meeting support | Support for hybrid or fully virtual meetings |
| VM-024 | SMS confirmations | Text confirmation requests to invited guests |
| VM-025 | Attendance predictions | AI-based attendance forecasting |

---

## Screens

### 1. Vision Meetings List

Primary view for all Vision Meetings.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Vision Meetings                                    [+ Schedule Meeting]     │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  View: [Upcoming] [Past] [All]                              Filter: [All ▼] │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  UPCOMING                                                                    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Jan 28, 2026 • 7:00 PM                                                │  │
│  │ Vision Meeting #12                                                     │  │
│  │ 📍 Community Center, Room B                                            │  │
│  │                                                                        │  │
│  │ Invitations Tracking: 45 invited • 28 confirmed • 12 maybe            │  │
│  │ Materials: ✓ Ready                                                    │  │
│  │                                                      [View] [Edit]    │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  PAST (Recent)                                                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Jan 14, 2026 • 7:00 PM                               Completed ✓      │  │
│  │ Vision Meeting #11                                                     │  │
│  │ 📍 Community Center, Room B                                            │  │
│  │                                                                        │  │
│  │ Attended: 32 (18 new, 14 returning)                                   │  │
│  │ Follow-up: 16/18 complete (89%)                                       │  │
│  │ Success Score: 4.2/5                                                  │  │
│  │                                                      [View] [Report]  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Vision Meeting Detail (Planning Mode)

For upcoming meetings.

**Header:**
- Meeting date, time, number
- Location with map link
- Days until meeting countdown
- Status: Planning / Ready / In Progress / Completed

**Tabs:**

#### Tab: Details
- Date/time with calendar integration
- Location selection (from saved venues)
- Estimated attendance
- Notes and special instructions

#### Tab: Invitations
- Core Group member invitation tracking:
  - Member name
  - # invited this meeting
  - # confirmed attending
  - Invitation activity history
- Overall invitation metrics
- "Send reminder to invite" action

#### Tab: Logistics
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
- Default template sections:
  - Welcome & Introductions (10 min)
  - Worship/Prayer (10 min)
  - Vision Presentation (30 min)
  - Q&A (15 min)
  - Response/Next Steps (10 min)
  - Fellowship/Refreshments (15 min)
- Customizable timing and content

---

### 3. Vision Meeting Detail (Completed)

For past meetings.

**Tabs:**

#### Tab: Attendance
- Full attendee list with status:
  - First-time (new)
  - Returning
  - Core Group Member
- Digital sign-in integration
- Manual attendance entry
- Attendance comparison to previous meetings

#### Tab: Follow-Up
- Auto-generated follow-up tasks for new attendees
- Task status tracking:
  - Pending
  - In Progress
  - Completed
  - Overdue
- Bulk actions for follow-up
- 48-hour deadline indicator

#### Tab: Outcomes
- Response card summary:
  - Interested in learning more
  - Ready to commit
  - Has questions
  - Not interested
- Conversion tracking (who moved to next pipeline stage)

#### Tab: Evaluation
- Self-assessment of 8 success factors (1-5 scale each)
- Notes for improvement
- Comparison to previous meetings
- Overall success score

---

### 4. Attendance Capture Screen

Simplified view for during/after meeting.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Vision Meeting #12 - Attendance                               Jan 28, 2026 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  🔍 Search or add attendee...                                               │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  QUICK ADD                                                                   │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ First Name: [          ]  Last Name: [          ]                     │  │
│  │ Email: [                    ]  Phone: [              ]                │  │
│  │ Invited by: [Select Core Group Member ▼]            [Add Attendee]   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  ATTENDEES (32)                                          New: 18 | Return: 14│
│                                                                              │
│  ☑ John Smith          Core Group        Invited 3, brought 2               │
│  ☑ Sarah Johnson       First Time        Invited by: John Smith             │
│  ☑ Mike Williams       First Time        Invited by: John Smith             │
│  ☑ Lisa Davis          Returning         2nd visit                          │
│  ☑ Amy Chen            Core Group        Invited 5, brought 1               │
│  ☑ Tom Brown           First Time        Invited by: Amy Chen               │
│  ...                                                                        │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│                                            [Generate Follow-Up Tasks]       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Invitation Tracking Dashboard

Track Core Group invitation activity.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Invitation Activity - Vision Meeting #12                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Target: 5 invitations per member    Meeting Date: Jan 28, 2026             │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  INVITATION LEADERBOARD                                                      │
│                                                                              │
│  Member              Invited    Confirmed    Brought (previous)              │
│  ─────────────────────────────────────────────────────────────────────────   │
│  🏆 John Smith           8          4            3                          │
│  🥈 Amy Chen             6          2            2                          │
│  🥉 Tom White            5          3            1                          │
│     Sarah Brown          4          1            0                          │
│     Mike Jones           3          2            1                          │
│  ⚠️ Lisa Davis           1          0            0                          │
│  ⚠️ James Wilson         0          0            0                          │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  SUMMARY                                                                     │
│  Total Invited: 45  |  Avg per Member: 3.5  |  Below Target: 8 members     │
│                                                                              │
│                                      [Send Encouragement to Below Target]   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 6. Analytics Dashboard

Vision Meeting effectiveness over time.

**Metrics Displayed:**

- Attendance trend chart (line graph over time)
- New vs. returning attendees (stacked bar)
- Invitation effectiveness:
  - Invites sent per meeting
  - Invite-to-attend conversion rate
- Follow-up metrics:
  - 48-hour completion rate
  - Follow-up-to-commitment conversion
- Success factor trends (radar chart)
- Source effectiveness (where attendees come from)

---

## Workflows

### Workflow 1: Schedule New Vision Meeting

**Trigger:** User clicks "+ Schedule Meeting"

**Steps:**

```
[+ Schedule Meeting]
    ↓
[Meeting Form]:
├── Select date and time
├── Select location (from saved or add new)
├── Set estimated attendance
└── Add notes
    ↓
[Save]
    ↓
Meeting created
    ↓
System actions:
├── Calendar event created
├── Notification sent to Core Group
├── Invitation tracking initialized
└── Materials checklist populated from template
```

---

### Workflow 2: Pre-Meeting Preparation

**Trigger:** Meeting is 1 week away

**Steps:**

```
[Automated reminder: Meeting in 7 days]
    ↓
Send reminder to Core Group: "Invitation check-in"
    ↓
[Day -3]: Materials checklist reminder to logistics owner
    ↓
[Day -1]: Final invitation count email to planter
    ↓
[Day of]: Meeting status set to "Ready"
```

---

### Workflow 3: Capture Attendance

**Trigger:** During or after meeting

**Steps:**

```
[Open Attendance Capture screen]
    ↓
For each attendee:
├── Search existing contacts OR quick add new
├── Mark attendance type (First-time, Returning, Core Group)
├── Record invited-by relationship
└── Capture response card data (optional)
    ↓
[Finalize Attendance]
    ↓
System actions:
├── Create Person records for new contacts
├── Update Person status (Prospect → Attendee)
├── Update invitation credit for Core Group members
└── Generate follow-up tasks (48-hour deadline)
```

---

### Workflow 4: Post-Meeting Follow-Up

**Trigger:** Meeting attendance finalized

**Steps:**

```
[Generate Follow-Up Tasks clicked]
    ↓
For each new attendee:
    ↓
    Create follow-up task:
    ├── Task: "Follow up with [Name]"
    ├── Assigned to: Senior Pastor (default) or customize
    ├── Due date: Meeting date + 48 hours
    ├── Priority: High
    └── Link to Person record
    ↓
Tasks appear in Task Management (F5)
    ↓
As follow-up completed:
├── Mark task complete
├── Update Person status
└── Log communication in Person timeline
    ↓
Follow-up completion % updates on meeting detail
```

---

### Workflow 5: Meeting Evaluation

**Trigger:** Meeting completed, attendance captured

**Steps:**

```
[Vision Meeting Detail] → [Evaluation Tab]
    ↓
Rate each of 8 success factors (1-5):
├── Great Attendance
├── Acceptable Location
├── Great Logistics
├── Clear Agenda
├── Great Vibe
├── Compelling Message
├── Strong Close
└── Clear Next Steps
    ↓
Add improvement notes
    ↓
[Save Evaluation]
    ↓
Success score calculated
    ↓
Comparison to previous meetings shown
    ↓
Insights generated:
├── "Attendance up 15% from last meeting"
├── "Follow-up completion below target"
└── "Location rated lower - consider change"
```

---

## Data Model

### VisionMeeting

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| meeting_number | Integer | Yes | Sequential meeting number |
| datetime | Timestamp | Yes | Meeting date and time |
| location_id | UUID (FK) | No | Reference to saved Location |
| location_name | String | No | Location name (if not using saved) |
| location_address | String | No | Full address |
| estimated_attendance | Integer | No | Projected attendance |
| actual_attendance | Integer | No | Final attendance count |
| status | Enum | Yes | `planning` / `ready` / `completed` / `cancelled` |
| notes | Text | No | General notes |
| agenda | JSON | No | Structured agenda data |
| created_by | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### VisionMeetingAttendance

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| meeting_id | UUID (FK) | Yes | Reference to VisionMeeting |
| person_id | UUID (FK) | Yes | Reference to Person |
| attendance_type | Enum | Yes | `first_time` / `returning` / `core_group` |
| invited_by_id | UUID (FK) | No | Reference to Person who invited |
| response_status | Enum | No | `interested` / `ready_commit` / `questions` / `not_interested` |
| notes | Text | No | Notes from response card |
| created_at | Timestamp | Yes | Creation timestamp |

**Constraints:**
- Unique constraint on (meeting_id, person_id)

---

### Invitation

Track invitation activity per meeting.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| meeting_id | UUID (FK) | Yes | Reference to VisionMeeting |
| inviter_id | UUID (FK) | Yes | Reference to Person (Core Group member) |
| invitee_name | String | No | Name of person invited (if not in system) |
| invitee_id | UUID (FK) | No | Reference to Person (if in system) |
| status | Enum | Yes | `invited` / `confirmed` / `maybe` / `declined` / `attended` / `no_show` |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### Location

Saved venue information for reuse.

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

---

### MeetingEvaluation

Self-assessment of meeting effectiveness.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| meeting_id | UUID (FK) | Yes | Reference to VisionMeeting |
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

---

## Vision Meeting Kit Checklist

Standard materials tracked per meeting:

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

This feature integrates with cross-cutting services defined in [System Architecture](../../system-architecture.md). For shared entity contracts, see [Core Data Contracts](../../core-data-contracts.md).

### Inbound (This Feature Consumes)

| Data | Contract | Source |
|------|----------|--------|
| **Person lookup** | Read `Person.id`, `first_name`, `last_name` for attendance and invitation tracking | People/CRM (via [Core Data Contracts](../../core-data-contracts.md)) |
| **Template access** | Read template list by category `vision_meeting` for materials checklist | Document Templates API |

### Outbound (This Feature Provides)

| Event/Data | Contract | Consumers May |
|------------|----------|---------------|
| **`meeting.attendance.recorded`** | Emits `{ meeting_id, person_id, attendance_type, church_id }` | Create follow-up tasks, update person status |
| **`meeting.completed`** | Emits `{ meeting_id, attendance_count, new_attendee_count, church_id }` | Update dashboard metrics |
| **Meeting metrics** | Exposes attendance counts and trends by `church_id` | Dashboard aggregation |

---

## Success Metrics

### Meeting Effectiveness
- Average attendance per meeting
- New attendee percentage
- Attendance growth trend

### Invitation Activity
- Average invitations per Core Group member
- Invitation-to-attendance conversion rate
- Core Group members meeting invitation target (5+)

### Follow-Up
- 48-hour follow-up completion rate (target: 100%)
- Follow-up-to-commitment conversion rate
- Average time to follow-up

### Overall
- Success factor score trends
- Meeting-to-commitment pipeline conversion

---

## Open Questions

1. **Digital check-in:** Should there be a self-service digital check-in option (QR code, tablet)?

2. **Calendar sync:** Bidirectional calendar sync or one-way push to Google/Outlook?

3. **Recurring meetings:** Support for automatically scheduling recurring Vision Meetings?

4. **Virtual meetings:** Support for hybrid or fully virtual Vision Meetings?

5. **Response card digitization:** Should response cards be captured digitally during meeting or paper then entered?
