# F9: Communication Hub
## Feature Requirements Document (FRD)

**Version:** 1.1  
**Date:** February 9, 2026  
**Feature Code:** F9

---

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services
- [Core Data Contracts](../../core-data-contracts.md) - Shared entity contracts (Church, User, Person, Phase)

---

## Overview

The Communication Hub provides centralized communication capabilities with team members and prospects. It combines message templates, communication history tracking, and delivery through integrated services (email, SMS).

The Communication Hub also serves as a **delivery service** for other features. Features like Meetings (F3) can request email delivery through the Communication Hub using templates and merge fields, rather than implementing their own email infrastructure. This keeps all communication centralized with unified delivery tracking and per-person communication history.

**Important:** The platform provides the workflow and templates; actual message delivery leverages integrated external services.

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement | Description |
|----|-------------|-------------|
| COM-001 | Message composition | Create and send messages to recipients |
| COM-002 | Email delivery | Send emails via integrated service (Resend) |
| COM-003 | Recipient selection | Select individuals or groups as recipients |
| COM-004 | Message templates | Pre-built templates for common communications |
| COM-005 | Merge fields | Personalize messages with recipient data |
| COM-006 | Message history | View all sent messages |
| COM-007 | Person communication log | View all messages sent to a specific person |
| COM-008 | Basic delivery tracking | Track sent/delivered status |
| COM-009 | Quick select groups | Select Core Group, pipeline status groups, **and ministry-team rosters** as recipients. Team rosters confirmed in scope 2026-07-26 (decision #17). Status groups already ship in `src/components/communication/recipient-picker.tsx`; the remaining work is resolving `team:<id>` in `getRecipientsByGroup` — tracked in issue #18. |
| COM-010 | Template categorization | Organize templates by purpose |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| COM-011 | SMS delivery | Send text messages via integrated service (Twilio). **POST-BETA** (decision #7) — kept, not cut; a second provider plus number compliance is out of beta scope. |
| COM-012 | Open tracking | Track email opens |
| COM-013 | Click tracking | Track link clicks in emails |
| COM-014 | Scheduled sending | Schedule messages for future delivery. **POST-BETA** (decision #7) — kept; a send queue on top of Resend, useful for batching, but not beta scope. |
| COM-015 | Message preview | Preview message with sample merge data |
| COM-016 | Custom templates | Create church-specific message templates |
| COM-017 | Rich text editor | Format messages with bold, italic, links |
| COM-018 | Resend to non-openers | Re-send to recipients who didn't open |
| COM-019 | Delivery stats dashboard | Overview of communication performance |
| COM-020 | Task integration | Log communication when completing follow-up tasks |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| COM-021 | Reply handling | Route replies to sender's email |
| COM-022 | Unsubscribe management | Handle opt-outs properly |
| COM-023 | A/B testing | Test different subject lines/content |
| COM-024 | Drip campaigns | Automated message sequences |
| COM-025 | In-app messaging | Message center for team members with logins |
| COM-026 | Push notifications | Mobile push for urgent messages |

---

## Screens

### 1. Communication Dashboard

Overview of communication activity.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Communication Hub                                        [+ New Message]    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐   │
│  │  RECENT ACTIVITY        │  │  QUICK ACTIONS                          │   │
│  │                         │  │                                         │   │
│  │  Today: 12 messages     │  │  [Vision Meeting Reminder]              │   │
│  │  This Week: 45 messages │  │  [Follow-Up Email]                      │   │
│  │  Response Rate: 68%     │  │  [Team Announcement]                    │   │
│  │                         │  │  [Welcome New Member]                   │   │
│  └─────────────────────────┘  └─────────────────────────────────────────┘   │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  RECENT MESSAGES                                                             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Vision Meeting Reminder                              Today, 10:30 AM   │  │
│  │ To: 45 Core Group Members                                              │  │
│  │ Channel: Email + SMS                                                   │  │
│  │ Status: ✓ Delivered: 45 | Opened: 32 | Clicked: 18                    │  │
│  │                                                              [View]   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Follow-Up: Sarah Johnson                             Yesterday, 3:15 PM│  │
│  │ To: Sarah Johnson                                                      │  │
│  │ Channel: Email                                                         │  │
│  │ Status: ✓ Delivered | ✓ Opened                                        │  │
│  │                                                              [View]   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Welcome to Core Group                                Yesterday, 9:00 AM│  │
│  │ To: Tom Brown, Lisa Davis                                              │  │
│  │ Channel: Email                                                         │  │
│  │ Status: ✓ Delivered: 2 | Opened: 2                                    │  │
│  │                                                              [View]   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│                                                      [View All Messages →]  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Compose Message

Create and send new message.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  New Message                                                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  TEMPLATE (Optional)                                                         │
│  [Select a template...                                              ▼]      │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  RECIPIENTS                                                                  │
│                                                                              │
│  To: [Search people or select group...                              ]       │
│                                                                              │
│  Quick Select:                                                               │
│  [All Core Group] [All Prospects] [Worship Team] [Custom...]                │
│                                                                              │
│  Selected: 45 recipients                                    [View List]     │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  CHANNEL                                                                     │
│                                                                              │
│  ☑ Email                           ☐ SMS (Text Message)                    │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  MESSAGE                                                                     │
│                                                                              │
│  Subject: [Vision Meeting This Tuesday!                              ]      │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Hi {{first_name}},                                                     │  │
│  │                                                                        │  │
│  │ Just a reminder that our next Vision Meeting is this Tuesday,         │  │
│  │ January 28th at 7:00 PM at the Community Center.                      │  │
│  │                                                                        │  │
│  │ Remember to bring at least one person you've been inviting!           │  │
│  │                                                                        │  │
│  │ See you there,                                                         │  │
│  │ Pastor John                                                            │  │
│  │                                                                        │  │
│  │ [B] [I] [U] [Link] [Image]                                            │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Merge Fields: {{first_name}}, {{last_name}}, {{church_name}}               │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  DELIVERY                                                                    │
│                                                                              │
│  ○ Send immediately                                                         │
│  ● Schedule for: [Jan 27, 2026  ▼] [9:00 AM  ▼]                            │
│                                                                              │
│                                [Cancel]  [Preview]  [Send / Schedule]       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Message Templates

Browse and manage templates.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Message Templates                                      [+ Create Template]  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Filter: [All Categories ▼]  [All Channels ▼]                               │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  VISION MEETING                                                              │
│                                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                   │
│  │ 📧 Vision Meeting       │  │ 📧 Vision Meeting       │                   │
│  │    Invitation           │  │    Reminder             │                   │
│  │                         │  │                         │                   │
│  │ Email template for      │  │ Email/SMS reminder      │                   │
│  │ inviting new prospects  │  │ 1-2 days before meeting │                   │
│  │                         │  │                         │                   │
│  │ [Preview] [Use]         │  │ [Preview] [Use]         │                   │
│  └─────────────────────────┘  └─────────────────────────┘                   │
│                                                                              │
│  FOLLOW-UP                                                                   │
│                                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────┐  │
│  │ 📧 Follow-Up:           │  │ 📧 Follow-Up:           │  │ 📧 Follow-Up│  │
│  │    Interested           │  │    Committed            │  │    Questions│  │
│  │                         │  │                         │  │             │  │
│  │ For attendees who       │  │ For attendees ready     │  │ For those   │  │
│  │ expressed interest      │  │ to commit               │  │ with        │  │
│  │                         │  │                         │  │ questions   │  │
│  │ [Preview] [Use]         │  │ [Preview] [Use]         │  │ [Preview]   │  │
│  └─────────────────────────┘  └─────────────────────────┘  └─────────────┘  │
│                                                                              │
│  CORE GROUP                                                                  │
│                                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                   │
│  │ 📧 Welcome to           │  │ 📧 Meeting              │                   │
│  │    Core Group           │  │    Announcement         │                   │
│  │                         │  │                         │                   │
│  │ Welcome email for new   │  │ General announcement    │                   │
│  │ Core Group members      │  │ to Core Group           │                   │
│  │                         │  │                         │                   │
│  │ [Preview] [Use]         │  │ [Preview] [Use]         │                   │
│  └─────────────────────────┘  └─────────────────────────┘                   │
│                                                                              │
│  [... more categories ...]                                                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 4. Message History

View all sent messages.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Message History                                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Filter: [All Time ▼]  [All Channels ▼]  [All Status ▼]                    │
│  🔍 Search messages...                                                       │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  Date          Subject/Preview             Recipients    Channel   Status   │
│  ─────────────────────────────────────────────────────────────────────────   │
│  Jan 25        Vision Meeting Reminder     45            📧 + 📱   ✓ Sent   │
│  Jan 24        Follow-Up: Sarah Johnson    1             📧        ✓ Opened │
│  Jan 24        Welcome to Core Group       2             📧        ✓ Opened │
│  Jan 22        Team Meeting Reminder       8             📧        ✓ Sent   │
│  Jan 20        Vision Meeting Recap        38            📧        ✓ Sent   │
│  Jan 18        Invitation Card Template    12            📧        ✓ Sent   │
│  ...                                                                        │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  Showing 1-20 of 156 messages                           [← Prev] [Next →]   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Message Detail

View single message with analytics.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ← Back to Messages                                                          │
│                                                                              │
│  Vision Meeting Reminder                                                     │
│  Sent: January 25, 2026 at 10:30 AM                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  DELIVERY STATS                                                              │
│                                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐                │
│  │    45     │  │    45     │  │    32     │  │    18     │                │
│  │   Sent    │  │ Delivered │  │  Opened   │  │  Clicked  │                │
│  │   100%    │  │   100%    │  │    71%    │  │    40%    │                │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘                │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  RECIPIENTS                                                                  │
│                                                                              │
│  Name                 Email                      Status                      │
│  ─────────────────────────────────────────────────────────────────────────   │
│  John Smith           john@email.com             ✓ Opened, Clicked          │
│  Sarah Johnson        sarah@email.com            ✓ Opened                   │
│  Mike Williams        mike@email.com             ✓ Delivered                │
│  Lisa Davis           lisa@email.com             ✓ Opened, Clicked          │
│  ...                                                                        │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  MESSAGE CONTENT                                                             │
│                                                                              │
│  Subject: Vision Meeting This Tuesday!                                       │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Hi {{first_name}},                                                     │  │
│  │                                                                        │  │
│  │ Just a reminder that our next Vision Meeting is this Tuesday...        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│                                              [Resend to Non-Openers]        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 6. Person Communication History

View all communication with a specific person (accessed from Person detail view).

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Communication History: Sarah Johnson                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Total: 8 messages | Last Contact: January 24, 2026                         │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  Jan 24    📧 Follow-Up Email                                  You → Sarah  │
│            "Thanks for attending the Vision Meeting..."                      │
│            Status: ✓ Opened                                                 │
│                                                                              │
│  Jan 20    📧 Vision Meeting Reminder                          You → Sarah  │
│            "Just a reminder about Tuesday's meeting..."                      │
│            Status: ✓ Opened                                                 │
│                                                                              │
│  Jan 15    📧 Vision Meeting Invitation                        You → Sarah  │
│            "You're invited to learn about New Life Church..."                │
│            Status: ✓ Opened, Clicked                                        │
│                                                                              │
│  Jan 10    📱 Initial Contact (SMS)                            You → Sarah  │
│            "Hi Sarah, great meeting you at..."                               │
│            Status: ✓ Delivered                                              │
│                                                                              │
│  [... earlier messages ...]                                                  │
│                                                                              │
│                                              [+ Send New Message to Sarah]  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Workflows

### Workflow 1: Send Message with Template

**Trigger:** User clicks "New Message" and selects template

**Steps:**

```
[+ New Message]
    ↓
[Select Template] (optional)
    ↓
Template content loaded into editor
    ↓
[Select Recipients]:
├── Quick select (Core Group, Team, etc.)
├── Search individuals
└── View selected list
    ↓
[Select Channel]: Email and/or SMS
    ↓
[Customize Message]:
├── Edit subject (email)
├── Edit body
└── Merge fields auto-populated
    ↓
[Preview] → See rendered message with sample recipient
    ↓
[Send / Schedule]
    ↓
Message queued for delivery
    ↓
Integration service delivers (Resend for email; SMS not yet integrated)
    ↓
Delivery status tracked and updated
```

---

### Workflow 2: Follow-Up from Task

**Trigger:** User completing a follow-up task

**Steps:**

```
[Task: Follow up with Sarah Johnson] → [Complete Task]
    ↓
Prompt: "Log communication?"
    ↓
[Yes] → Communication form opens pre-filled:
├── Recipient: Sarah Johnson
├── Template suggestions based on task type
└── Notes field for logging outcome
    ↓
Choose:
├── [Send Message] → Compose and send
└── [Log Only] → Just record the contact was made
    ↓
Communication logged to Sarah's history
    ↓
Task marked complete
```

---

### Workflow 3: Scheduled Campaign

**Trigger:** User schedules message for future delivery

**Steps:**

```
[Compose Message] → [Schedule for later]
    ↓
Select date and time
    ↓
[Schedule]
    ↓
Message saved as scheduled
    ↓
Appears in "Scheduled" tab
    ↓
[At scheduled time]:
    ↓
    System initiates delivery
    ↓
    Status updates to "Sent"
    ↓
    Delivery tracking begins
```

---

### Workflow 4: Team Communication

**Trigger:** User sends message to ministry team

**Steps:**

```
[Ministry Team Detail] → [Communication Tab] → [New Message]
    ↓
Recipients pre-selected: All team members
    ↓
Team-specific templates suggested
    ↓
[Compose and Send]
    ↓
Message logged against:
├── Each recipient's communication history
└── Team communication log
```

---

### Workflow 5: Feature-Triggered Communication

**Trigger:** Another feature (e.g., Meetings) requests email delivery for a list of recipients

**Steps:**

```
[Feature context] → [Send Invitations / Send Reminder]
    ↓
Feature provides:
├── Recipient list (person IDs from guest list, team roster, etc.)
├── Template category hint (e.g., meeting_invitation, meeting_reminder)
├── Merge field data (meeting title, date, location, type, etc.)
    ↓
Communication Hub:
├── Auto-select template by category (or allow user to pick)
├── Pre-fill merge fields from feature context
├── Render personalized message per recipient
├── Optional: user previews before sending
    ↓
[Send]
    ↓
Emails delivered via integration service
    ↓
Delivery status tracked per recipient
    ↓
Communication logged to each recipient's history
    ↓
Calling feature notified of send completion (e.g., update invited_at timestamp)
```

**RSVP extension (meeting invitations):** For meeting-triggered sends, a per-recipient confirmation token (MeetingConfirmationToken) is generated at send time. The `{{confirm_link}}` and `{{decline_link}}` merge fields render recipient-specific RSVP links pointing at the public `/rsvp/[token]` page, which records the response (`confirmed` / `declined`) against the token.

**Key principle:** The calling feature owns the "who" and "why" (guest list, meeting context). The Communication Hub owns the "how" (templates, rendering, delivery, tracking). This keeps email delivery centralized while allowing any feature to trigger sends.

---

## Data Model

### Communication

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| subject | String | No | Email subject (null for SMS) |
| body | Text | Yes | Message content |
| body_html | Text | No | HTML version (email) |
| channel | Enum | Yes | `email` / `sms` / `both` |
| template_id | UUID (FK) | No | Reference to MessageTemplate |
| meeting_id | UUID (FK) | No | Reference to ChurchMeeting (set for meeting-triggered sends) |
| status | Enum | Yes | `draft` / `scheduled` / `sending` / `sent` / `failed` |
| scheduled_at | Timestamp | No | Scheduled send time |
| sent_at | Timestamp | No | Actual send time |
| recipient_count | Integer | No | Total recipients |
| created_by_id | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### CommunicationRecipient

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| communication_id | UUID (FK) | Yes | Reference to Communication |
| church_id | UUID (FK) | Yes | Reference to Church (tenant isolation) |
| person_id | UUID (FK) | Yes | Reference to Person |
| email | String | No | Email address used |
| phone | String | No | Phone number used |
| channel | Enum | Yes | `email` / `sms` |
| status | Enum | Yes | `pending` / `sent` / `delivered` / `opened` / `clicked` / `bounced` / `failed` |
| delivered_at | Timestamp | No | Delivery timestamp |
| opened_at | Timestamp | No | Open timestamp |
| clicked_at | Timestamp | No | Click timestamp |
| external_id | String | No | ID from delivery service |
| error_message | Text | No | Error details if failed |

---

### MessageTemplate

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | No | Reference to Church (null for system templates) |
| name | String | Yes | Template name |
| description | Text | No | Template description |
| category | Enum | Yes | `meeting_invitation` / `meeting_reminder` / `follow_up` / `core_group` / `team` / `announcement` / `launch` / `other` |
| channel | Enum | Yes | `email` / `sms` / `both` |
| subject | String | No | Email subject template |
| body | Text | Yes | Message body template |
| body_html | Text | No | HTML body template |
| merge_fields | JSON | No | Available merge fields |
| is_system | Boolean | Yes | System-provided vs custom |
| source_template_id | UUID | No | For church forks of system templates, the original system template |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

**Copy-on-write semantics:** System templates (`is_system=true`, `church_id=null`) are immutable. When a church edits a system template, it is forked into a church-owned copy with `source_template_id` pointing at the original; template listings return the church's fork in place of its system original.

---

### MeetingConfirmationToken

Per-recipient RSVP tokens for meeting-triggered invitations.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| token | String | Yes | Unique token embedded in confirm/decline links |
| church_id | UUID (FK) | Yes | Reference to Church |
| meeting_id | UUID (FK) | Yes | Reference to ChurchMeeting |
| person_id | UUID (FK) | Yes | Reference to Person |
| status | Enum | Yes | `pending` / `confirmed` / `declined` |
| responded_at | Timestamp | No | Response timestamp |
| expires_at | Timestamp | Yes | Token expiry |
| created_at | Timestamp | Yes | Creation timestamp |

---

### Note

General notes attached to any entity.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| related_type | Enum | Yes | `person` / `meeting` / `team` / `facility` / etc. |
| related_id | UUID | Yes | Reference to related entity |
| content | Text | Yes | Note content |
| created_by_id | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |

---

## Template Categories

| Category | Purpose | Examples |
|----------|---------|----------|
| Meeting Invitation | Invitation to any meeting type | Vision meeting invite, Orientation invite, Team meeting invite |
| Meeting Reminder | Pre-meeting reminders for guest list | Day-before reminder, Same-day reminder |
| Follow-Up | Post-meeting contact | Interested, Committed, Questions, Not Interested |
| Core Group | Member communication | Welcome, Announcements, Reminders |
| Team | Ministry team messages | Training reminder, Team announcement |
| Launch | Pre-launch and launch | Countdown, Launch invitation |
| Announcement | General announcements | News, Updates, Events |

---

## Merge Fields

### Person Fields

| Field | Description | Source |
|-------|-------------|--------|
| `{{first_name}}` | Recipient's first name | Person.first_name |
| `{{last_name}}` | Recipient's last name | Person.last_name |
| `{{full_name}}` | Full name | Person.first_name + last_name |

### Church Fields

| Field | Description | Source |
|-------|-------------|--------|
| `{{church_name}}` | Church name | Church.name |
| `{{pastor_name}}` | Senior Pastor name | Church profile |
| `{{launch_date}}` | Launch Sunday date | Church.launch_date |

> **Note:** `{{pastor_name}}` and `{{launch_date}}` are registered in the merge engine but currently render empty — the backing church profile fields are not yet sourced.

### Meeting Fields (available when triggered from Meetings feature)

| Field | Description | Source |
|-------|-------------|--------|
| `{{meeting_title}}` | Meeting title or auto-generated name (e.g., "Vision Meeting #12") | ChurchMeeting.title |
| `{{meeting_type}}` | Meeting type label (Vision Meeting, Orientation, Team Meeting) | ChurchMeeting.type |
| `{{meeting_date}}` | Meeting date and time | ChurchMeeting.datetime |
| `{{meeting_location}}` | Meeting location name and address | ChurchMeeting.location_name |
| `{{confirm_link}}` | Recipient-specific RSVP confirm link (`/rsvp/[token]`) | MeetingConfirmationToken |
| `{{decline_link}}` | Recipient-specific RSVP decline link (`/rsvp/[token]`) | MeetingConfirmationToken |

---

## Integration Contracts

### Inbound (this feature consumes)

| Data | Contract | Source |
|------|----------|--------|
| **Person records** | Read `Person.id`, `first_name`, `last_name`, email, phone for recipient selection and merge fields | People/CRM (F2) |
| **Team membership** | Read team roster by `team_id` -> list of `person_id` for group messaging | Ministry Teams (F8) |
| **Task completion events** | Receive `task.completed` event with `person_id` to prompt follow-up communication | Task Management (F5) |
| **Meeting invitation requests** | Receive meeting details (title, datetime, location, type) and guest list (person IDs) to compose and send invitation emails using meeting templates | Meetings (F3) |

### Outbound (this feature provides)

| Data | Contract | Consumers |
|------|----------|-----------|
| **Communication log** | Expose communication history by `person_id` for display on Person detail | People/CRM |
| **Message sent events** | Emit `communication.sent` with `person_id`, `channel`, `timestamp` | Dashboard, Task Management |

### External Services

| Function | Purpose | Integration |
|----------|---------|-------------|
| **Email** | Bulk/transactional delivery | API (Resend — single + batch send, webhook delivery tracking) |
| **SMS** | Text messaging | Not yet integrated (Twilio planned, pending COM-011 decision) |

---

## Success Metrics

### Delivery Performance
- Delivery rate
- Open rate (email)
- Click rate (email)
- Response rate

### Template Usage
- Most used templates
- Template effectiveness (open/click rates by template)

### Engagement
- Messages sent per user per week
- Communication frequency per contact

---

## Oversight Access Patterns

### Coach Access
- Can view communication logs and notes for assigned churches (read-only)

### Sending Church Admin Access
- No access to communication content
- Communication is considered private by nature and is not subject to privacy toggles

### Network Admin Access
- No access to communication content
- Not subject to privacy toggles

### Privacy Controls
- Communication content (messages, notes) is inherently private and is never shared with oversight users, regardless of privacy settings

---

## Open Questions

1. **Reply handling:** Should the platform handle replies, or direct to personal email/phone?

2. **Unsubscribe:** How should unsubscribe requests be handled?

3. **A/B testing:** Should template A/B testing be supported?

4. **Automation:** Should there be automated communication sequences (drip campaigns)?

5. **In-app messaging:** Should there be an in-app message center for team members with platform logins?
