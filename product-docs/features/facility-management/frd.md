# F10: Facility Management
## Feature Requirements Document (FRD)

**Version:** 1.1  
**Date:** January 25, 2026  
**Feature Code:** F10

---

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services
- [Core Data Contracts](../../core-data-contracts.md) - Shared entity contracts (Church, User, Person, Phase)

---

## Overview

Facility Management tracks and organizes the facility search process, evaluates venues against requirements, and manages the ongoing venue relationship once secured. This feature supports planters from initial research through securing a worship site and maintaining that relationship.

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement | Description |
|----|-------------|-------------|
| FAC-001 | Venue record creation | Add potential venues with basic information |
| FAC-002 | Venue list view | View all venues in search pipeline |
| FAC-003 | Status tracking | Track venue status (Researching through Secured/Rejected) |
| FAC-004 | Contact information | Store venue manager/owner contact details |
| FAC-005 | Basic venue details | Name, address, type, capacity, estimated cost |
| FAC-006 | Venue detail view | Full view of venue information and history |
| FAC-007 | Note adding | Add notes and observations to venue records |
| FAC-008 | Status filtering | Filter venues by pipeline status |
| FAC-009 | Secured venue marking | Designate a venue as secured |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| FAC-010 | Requirements checklist | Structured evaluation against facility requirements |
| FAC-011 | Site visit scheduling | Schedule and track site visits |
| FAC-012 | Site visit notes | Record observations from site visits |
| FAC-013 | Photo attachments | Attach photos from site visits |
| FAC-014 | Checklist scoring | Calculate completion percentage of requirements |
| FAC-015 | Venue comparison | Side-by-side comparison of venues |
| FAC-016 | Contract tracking | Store contract dates and documents |
| FAC-017 | Task generation | Create follow-up tasks from site visits |
| FAC-018 | Document storage | Attach contracts, insurance certs to venue |
| FAC-019 | Rejection tracking | Record reason when rejecting a venue |
| FAC-020 | Contract renewal reminders | Alert when venue contract is expiring |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| FAC-021 | Map view | Display venues on a map |
| FAC-022 | Venue database integration | Search external venue listings |
| FAC-023 | Network venue sharing | Share venue information across network |
| FAC-024 | Multi-venue support | Track multiple venues for multi-site |
| FAC-025 | Cost tracking history | Track cost changes over time |
| FAC-026 | Calendar integration | Site visits create calendar events |

---

## Screens

### 1. Facility List View

Track all potential and secured venues.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Facilities                                                [+ Add Venue]     │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  View: [All] [Active Search] [Secured] [Rejected]       Sort: [Status ▼]   │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  SECURED                                                                     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ✓ Lincoln Elementary School                              SECURED       │  │
│  │   1234 Main Street, Springfield                                        │  │
│  │   Capacity: 250 | Cost: $400/Sunday                                    │  │
│  │   Contract expires: August 2027                                        │  │
│  │                                                         [View Details] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  ACTIVE SEARCH (3)                                                           │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Springfield Community Center                            EVALUATING     │  │
│  │ 567 Oak Avenue, Springfield                                            │  │
│  │ Capacity: 180 | Est. Cost: $350/Sunday                                 │  │
│  │ Site visit scheduled: Jan 28                                           │  │
│  │ Checklist: 8/12 requirements met                                       │  │
│  │                                                         [View Details] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Riverside Hotel Conference Center                       CONTACTED      │  │
│  │ 890 River Road, Springfield                                            │  │
│  │ Capacity: 300 | Est. Cost: $600/Sunday                                 │  │
│  │ Awaiting response from venue manager                                   │  │
│  │                                                         [View Details] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ First Baptist Church (Shared Space)                     RESEARCHING    │  │
│  │ 123 Church Lane, Springfield                                           │  │
│  │ Capacity: 400 | Est. Cost: TBD                                         │  │
│  │ Initial research phase                                                 │  │
│  │                                                         [View Details] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  REJECTED (2)                                                    [Show ▼]   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Facility Detail View

Complete information about a venue.

**Header:**
- Venue name, address, type
- Status badge (pipeline stage)
- Primary contact info
- Quick actions: Edit, Schedule Visit, Add Note

**Tabs:**

#### Tab: Overview
- All venue fields
- Location map
- Primary contact details
- Cost information
- Capacity and availability

#### Tab: Requirements Checklist
- Structured evaluation checklist
- Each item: Pass / Fail / Concern
- Completion percentage
- Notes per requirement

#### Tab: Site Visits
- Timeline of all visits
- Visit details: date, attendees, notes
- Photos attached to visits
- Follow-up items

#### Tab: Documents
- Contracts and agreements
- Insurance certificates
- Floor plans
- Photos
- Communication records

#### Tab: Notes & History
- All notes and communication
- Status change history
- Activity timeline

---

### 3. Facility Add/Edit Form

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Name | Text | Yes | Venue name |
| Address | Address | Yes | Full address |
| Type | Dropdown | Yes | School, Theater, Community Center, Hotel, Storefront, Church (shared), Other |
| Status | Dropdown | Yes | Researching → Contacted → Site Visit Scheduled → Evaluating → Negotiating → Secured → Rejected |
| Primary Contact Name | Text | No | Venue manager/owner name |
| Primary Contact Phone | Phone | No | Contact phone |
| Primary Contact Email | Email | No | Contact email |
| Estimated Cost | Currency | No | Per Sunday or monthly cost |
| Cost Frequency | Dropdown | No | Per Sunday / Monthly / Annual |
| Capacity | Number | No | Main worship space seating |
| Notes | Rich Text | No | General notes |

---

### 4. Requirements Checklist

Structured evaluation during/after site visits.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Requirements Checklist: Springfield Community Center                        │
│  Completion: 8/12 (67%)                                            [Save]   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  WORSHIP SPACE                                                               │
│                                                                              │
│  Capacity meets needs (50+ now, 200+ at launch)                             │
│  Current: [180    ] seats                        ● Pass  ○ Fail  ○ Concern  │
│  Notes: [Good for launch, may need to expand               ]                │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  CHILDREN'S MINISTRY                                                         │
│                                                                              │
│  Nursery room suitable                                                       │
│  ○ Yes  ● No  ○ N/A                              ○ Pass  ● Fail  ○ Concern  │
│  Notes: [No dedicated nursery, would need to use hallway   ]                │
│                                                                              │
│  Preschool room suitable                                                     │
│  ● Yes  ○ No  ○ N/A                              ● Pass  ○ Fail  ○ Concern  │
│  Notes: [Room 101 is perfect                               ]                │
│                                                                              │
│  Elementary room suitable                                                    │
│  ● Yes  ○ No  ○ N/A                              ● Pass  ○ Fail  ○ Concern  │
│  Notes: [Room 102-103 can be combined                      ]                │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  ACCESSIBILITY & LOGISTICS                                                   │
│                                                                              │
│  ADA compliant                                                               │
│  ● Yes  ○ No                                     ● Pass  ○ Fail  ○ Concern  │
│  Notes: [Ramp at main entrance, accessible restrooms       ]                │
│                                                                              │
│  Adequate parking                                                            │
│  Spaces: [75     ]                               ● Pass  ○ Fail  ○ Concern  │
│  Notes: [Plus street parking available                     ]                │
│                                                                              │
│  Storage available                                                           │
│  ● Yes  ○ No                                     ○ Pass  ○ Fail  ● Concern  │
│  Notes: [Small closet only, would need off-site storage    ]                │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  AVAILABILITY                                                                │
│                                                                              │
│  Available on Sundays                                                        │
│  ● Yes  ○ No                                     ● Pass  ○ Fail  ○ Concern  │
│                                                                              │
│  Setup time: [2     ] hours before service       ● Pass  ○ Fail  ○ Concern  │
│                                                                              │
│  Teardown deadline: [1:00 PM ]                   ● Pass  ○ Fail  ○ Concern  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  REQUIREMENTS                                                                │
│                                                                              │
│  Insurance certificate required                                              │
│  ● Yes  ○ No                                                                │
│                                                                              │
│  Restrictions/limitations                                                    │
│  [No food in main room. Must use their AV system.                     ]     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Site Visit Log

Track all site visits.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Site Visits: Springfield Community Center              [+ Schedule Visit]   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  UPCOMING                                                                    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ January 28, 2026 at 10:00 AM                                          │  │
│  │ Attendees: Pastor John, Sarah (Facilities Lead)                       │  │
│  │ Purpose: Second visit - review children's rooms                       │  │
│  │                                                      [Edit] [Cancel]  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  COMPLETED                                                                   │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ January 15, 2026 at 2:00 PM                              ✓ Completed  │  │
│  │ Attendees: Pastor John, Mike (Launch Coordinator)                     │  │
│  │                                                                        │  │
│  │ Notes:                                                                 │  │
│  │ Met with facility manager Janet. Main room is great - high ceilings,  │  │
│  │ good acoustics. Concern about nursery space. Parking is adequate.     │  │
│  │ Janet mentioned they're flexible on setup time.                       │  │
│  │                                                                        │  │
│  │ Follow-up items:                                                       │  │
│  │ • Get insurance requirements in writing                               │  │
│  │ • Ask about storage options nearby                                    │  │
│  │ • Schedule second visit to see children's wing                        │  │
│  │                                                                        │  │
│  │ 📷 4 photos attached                                          [View]  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 6. Comparison View

Side-by-side venue comparison.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Compare Venues                                         [+ Add to Compare]   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                    │ Lincoln Elementary │ Community Center │ Riverside Hotel │
│  ──────────────────┼────────────────────┼──────────────────┼─────────────────│
│  Type              │ School             │ Community Center │ Hotel           │
│  Capacity          │ 250                │ 180              │ 300             │
│  Cost/Sunday       │ $400               │ $350             │ $600            │
│  Status            │ Secured            │ Evaluating       │ Contacted       │
│  ──────────────────┼────────────────────┼──────────────────┼─────────────────│
│  REQUIREMENTS      │                    │                  │                 │
│  ──────────────────┼────────────────────┼──────────────────┼─────────────────│
│  Worship space     │ ✓ Pass             │ ✓ Pass           │ ✓ Pass          │
│  Nursery           │ ✓ Pass             │ ✗ Fail           │ ✓ Pass          │
│  Preschool         │ ✓ Pass             │ ✓ Pass           │ ✓ Pass          │
│  Elementary        │ ✓ Pass             │ ✓ Pass           │ ⚠ Concern       │
│  ADA compliant     │ ✓ Pass             │ ✓ Pass           │ ✓ Pass          │
│  Parking           │ ⚠ Concern (60)     │ ✓ Pass (75)      │ ✓ Pass (200)    │
│  Storage           │ ✓ Pass             │ ⚠ Concern        │ ✗ Fail          │
│  Setup time        │ 2 hours            │ 2 hours          │ 1 hour          │
│  ──────────────────┼────────────────────┼──────────────────┼─────────────────│
│  Checklist Score   │ 11/12 (92%)        │ 8/12 (67%)       │ 6/12 (50%)      │
│  ──────────────────┼────────────────────┼──────────────────┼─────────────────│
│                    │ [View Details]     │ [View Details]   │ [View Details]  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Workflows

### Workflow 1: Adding a New Venue

**Trigger:** User clicks "+ Add Venue"

**Steps:**

```
[+ Add Venue]
    ↓
[Venue Form]:
├── Enter basic info (name, address, type)
├── Add contact information
├── Set initial status (typically "Researching")
└── Add notes
    ↓
[Save]
    ↓
Venue created
    ↓
Redirect to venue detail
    ↓
Prompt: "Schedule a site visit?"
```

---

### Workflow 2: Site Visit Process

**Trigger:** User schedules site visit

**Steps:**

```
[Facility Detail] → [+ Schedule Visit]
    ↓
[Site Visit Form]:
├── Date and time
├── Attendees
└── Purpose/agenda
    ↓
[Save]
    ↓
Calendar event created
    ↓
Task created: "Site visit - [Venue]"
    ↓
Reminder sent 1 day before
    ↓
[After visit]:
    ↓
    Open site visit record
    ↓
    Add notes and observations
    ↓
    Upload photos
    ↓
    Add follow-up items
    ↓
    Update requirements checklist
    ↓
    Update venue status if appropriate
```

---

### Workflow 3: Venue Evaluation

**Trigger:** After site visit(s) completed

**Steps:**

```
[Facility Detail] → [Requirements Checklist Tab]
    ↓
Complete checklist:
├── Mark each requirement Pass/Fail/Concern
├── Add notes for context
└── Enter specific values (capacity, setup time, etc.)
    ↓
[Save Checklist]
    ↓
Completion percentage calculated
    ↓
[If evaluating multiple venues]:
    ↓
    [Compare Venues] view
    ↓
    Side-by-side comparison
    ↓
    Select preferred venue
```

---

### Workflow 4: Securing a Venue

**Trigger:** User marks venue as "Secured"

**Steps:**

```
[Facility Detail] → [Change Status to Secured]
    ↓
Confirmation prompt:
"Mark Lincoln Elementary as your secured venue?"
    ↓
[Confirm]
    ↓
Status updated to "Secured"
    ↓
Prompt to add:
├── Contract document
├── Contract dates (start, renewal)
├── Final cost details
└── Key contact information
    ↓
Contract renewal reminder created
    ↓
Dashboard updated: "Facility: Secured ✓"
    ↓
[Optional]: Reject other venues in consideration
```

---

### Workflow 5: Managing Secured Venue

**Trigger:** Venue is secured, ongoing management

**Steps:**

```
[Facility Detail] (Secured venue)
    ↓
Ongoing tracking:
├── Contract renewal reminders
├── Relationship notes
├── Issue logging
├── Cost history
└── Communication with venue contact
    ↓
[Contract renewal approaching]:
    ↓
    Reminder notification
    ↓
    Task created: "Renew venue contract"
    ↓
    Update contract documents and dates
```

---

## Data Model

### Facility

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| name | String | Yes | Venue name |
| address | String | Yes | Full address |
| latitude | Decimal | No | For mapping |
| longitude | Decimal | No | For mapping |
| type | Enum | Yes | `school` / `theater` / `community_center` / `hotel` / `storefront` / `church_shared` / `other` |
| status | Enum | Yes | `researching` / `contacted` / `site_visit_scheduled` / `evaluating` / `negotiating` / `secured` / `rejected` |
| primary_contact_name | String | No | Contact name |
| primary_contact_phone | String | No | Contact phone |
| primary_contact_email | String | No | Contact email |
| estimated_cost | Decimal | No | Cost amount |
| cost_frequency | Enum | No | `per_sunday` / `monthly` / `annual` |
| capacity | Integer | No | Seating capacity |
| contract_start_date | Date | No | Contract start |
| contract_end_date | Date | No | Contract end/renewal |
| notes | Text | No | General notes |
| rejected_reason | Text | No | Reason if rejected |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### FacilityChecklist

Evaluation checklist for a facility.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| facility_id | UUID (FK) | Yes | Reference to Facility |
| worship_capacity | Integer | No | Reported capacity |
| worship_capacity_status | Enum | No | `pass` / `fail` / `concern` |
| worship_capacity_notes | Text | No | Notes |
| nursery_available | Boolean | No | Has nursery room |
| nursery_status | Enum | No | `pass` / `fail` / `concern` |
| nursery_notes | Text | No | Notes |
| preschool_available | Boolean | No | Has preschool room |
| preschool_status | Enum | No | `pass` / `fail` / `concern` |
| preschool_notes | Text | No | Notes |
| elementary_available | Boolean | No | Has elementary room |
| elementary_status | Enum | No | `pass` / `fail` / `concern` |
| elementary_notes | Text | No | Notes |
| ada_compliant | Boolean | No | ADA accessible |
| ada_status | Enum | No | `pass` / `fail` / `concern` |
| ada_notes | Text | No | Notes |
| parking_spaces | Integer | No | Number of spaces |
| parking_status | Enum | No | `pass` / `fail` / `concern` |
| parking_notes | Text | No | Notes |
| storage_available | Boolean | No | Storage on-site |
| storage_status | Enum | No | `pass` / `fail` / `concern` |
| storage_notes | Text | No | Notes |
| sunday_available | Boolean | No | Available Sundays |
| setup_hours | Decimal | No | Hours for setup |
| setup_status | Enum | No | `pass` / `fail` / `concern` |
| teardown_deadline | Time | No | When must vacate |
| teardown_status | Enum | No | `pass` / `fail` / `concern` |
| insurance_required | Boolean | No | Needs insurance cert |
| restrictions | Text | No | Limitations/restrictions |
| completion_percentage | Decimal | No | Calculated completion |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### SiteVisit

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| facility_id | UUID (FK) | Yes | Reference to Facility |
| visit_date | Timestamp | Yes | Visit date and time |
| attendees | String[] | No | Names of attendees |
| purpose | Text | No | Purpose of visit |
| status | Enum | Yes | `scheduled` / `completed` / `cancelled` |
| notes | Text | No | Visit notes |
| follow_up_items | JSON | No | Array of follow-up tasks |
| created_by_id | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### FacilityPhoto

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| facility_id | UUID (FK) | Yes | Reference to Facility |
| site_visit_id | UUID (FK) | No | Reference to SiteVisit |
| file_url | String | Yes | URL to photo |
| caption | String | No | Photo caption |
| room_type | Enum | No | `worship` / `nursery` / `preschool` / `elementary` / `exterior` / `parking` / `other` |
| created_at | Timestamp | Yes | Creation timestamp |

---

## Integration Contracts

This feature integrates with cross-cutting services defined in [System Architecture](../../system-architecture.md).

**Emits:**
- `facility.status.changed` — when venue status transitions (e.g., Researching → Secured)
- `facility.visit.scheduled` — when a site visit is created; triggers task creation via Task Service
- `facility.contract.expiring` — when contract renewal is approaching; triggers reminder task

**Consumes:**
- Task Service — for creating follow-up tasks from site visits and contract renewals
- Document Storage — for attaching contracts, insurance certificates, and photos
- Calendar Service — for creating site visit calendar events

---

## Success Metrics

### Facility Search Efficiency
- Average time from research to secured
- Number of venues evaluated
- Site visits per venue

### Checklist Usage
- Checklist completion rate
- Requirements most frequently failed

### Feature Adoption
- % of churches using facility management
- Comparison view usage

---

## Oversight Access Patterns

### Coach Access
- Can view facility search status, site visits, and venue evaluations for assigned churches

### Sending Church Admin Access
- Aggregate facility metrics only: venues evaluated count, venue status
- Subject to `share_facilities` privacy toggle

### Network Admin Access
- Aggregate facility metrics across all plants in the network
- Network venue sharing (sharing venue information across network) is a future enhancement
- Subject to `share_facilities` privacy toggle

### Privacy Controls
- Planter controls visibility via per-feature privacy toggle in church privacy settings
- Privacy toggle for this feature: `share_facilities`
- Default: `false` (not shared until planter opts in)

---

## Open Questions

1. **Venue discovery:** Should the platform integrate with venue databases or listing services?

2. **Network sharing:** Should venues be shareable within a church planting network?

3. **Map integration:** Should there be a map view showing all potential venues?

4. **Contract management:** How sophisticated should contract tracking be?

5. **Multi-venue:** Should the platform support churches that use multiple venues (multi-site)?
