# F4: Progress Dashboard
## Feature Requirements Document (FRD)

**Version:** 1.1  
**Date:** January 25, 2026  
**Feature Code:** F4

---

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services
- [Core Data Contracts](../../core-data-contracts.md) - Shared entity contracts (Church, User, Person, Phase)

---

## Overview

The Progress Dashboard provides a visual representation of launch progress and health indicators. It aggregates data from all other features to give planters (and coaches) a comprehensive view of where they stand in their church planting journey.

The dashboard is read-only, displaying metrics calculated from data entered in other features.

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement | Description |
|----|-------------|-------------|
| D-001 | Current phase display | Prominently show current phase with visual progress indicator |
| D-002 | Phase exit criteria | Display progress against phase exit criteria |
| D-003 | Core Group size metric | Show current Core Group count with target progress |
| D-004 | Launch countdown | Display days until launch (when date is set) |
| D-005 | 8 Critical Success Factors | Visual scorecard of all 8 CSF metrics |
| D-006 | Recent activity feed | Show recent actions and events |
| D-007 | Quick actions | Links to common actions (add person, schedule meeting) |
| D-008 | Data aggregation | Pull and aggregate data from all other features |
| D-009 | Read-only display | Dashboard is for viewing only, not data entry |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| D-010 | Growth velocity | Show Core Group growth rate and projections |
| D-011 | Vision Meeting trends | Chart showing attendance trends over time |
| D-012 | Follow-up metrics | Display 48-hour follow-up completion rate |
| D-013 | Ministry team readiness | Show team staffing completion (Phase 2+) |
| D-014 | Milestone timeline | Visual timeline of key milestones |
| D-015 | Alert badges | Visual indicators for items needing attention |
| D-016 | Wiki integration | "How to improve" links to relevant wiki content |
| D-017 | Phase detail drill-down | Expandable view of phase-specific metrics |
| D-018 | Coach dashboard | Multi-planter overview for coaches |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| D-019 | Dashboard customization | User-configurable metric display |
| D-020 | Network comparison | Compare metrics to network averages |
| D-021 | Data export | Export dashboard data for reports |
| D-022 | Weekly email reports | Automated progress summaries |
| D-023 | Push notifications | Alerts for critical metrics |
| D-024 | Historical trends | Long-term trend analysis |

---

## Screens

### 1. Main Dashboard

The primary landing page after login.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Dashboard                                              New Life Church      │
│  Phase 1: Core Group Development                        Coach: Pastor Mike   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  PHASE PROGRESS                                                         │ │
│  │                                                                         │ │
│  │  Phase 0     Phase 1      Phase 2      Phase 3     Phase 4     Phase 5  │ │
│  │  Discovery   Core Group   Launch Team   Training   Pre-Launch   Launch  │ │
│  │  ✓───────────●────────────○────────────○───────────○────────────○       │ │
│  │              ↑                                                          │ │
│  │         You are here                                                    │ │
│  │                                                                         │ │
│  │  Phase 1 Exit Criteria: 4/7 complete (57%)                             │ │
│  │  █████████████████░░░░░░░░░░                                           │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────┐  ┌────────────────────────────────────────┐ │
│  │  CORE GROUP SIZE           │  │  DAYS TO LAUNCH                        │ │
│  │                            │  │                                        │ │
│  │        38                  │  │     Launch date not set                │ │
│  │       ────                 │  │                                        │ │
│  │    committed adults        │  │     [Set Launch Date]                  │ │
│  │                            │  │                                        │ │
│  │  Min: 50  │  Target: 100   │  │                                        │ │
│  │  ████████████░░░░░░░░░░░░  │  │                                        │ │
│  │  38%                       │  │                                        │ │
│  │                            │  │                                        │ │
│  │  +5 this month  ↑12%       │  │                                        │ │
│  └────────────────────────────┘  └────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  8 CRITICAL SUCCESS FACTORS                                             │ │
│  │                                                                         │ │
│  │  Vision Casting    ████████████████████  4.5/5  ↑                      │ │
│  │  Shared Ownership  ████████████░░░░░░░░  3.2/5  ↓                      │ │
│  │  Critical Mass     ████████░░░░░░░░░░░░  38/100 →                      │ │
│  │  Unity             ████████████████░░░░  4.0/5  ↑                      │ │
│  │  Prayer            ██████████████░░░░░░  3.5/5  →                      │ │
│  │  Giving            ████████████░░░░░░░░  3.0/5  ↑                      │ │
│  │  Leadership        ██████░░░░░░░░░░░░░░  2/10 leaders                  │ │
│  │  Training          ░░░░░░░░░░░░░░░░░░░░  0% (Phase 3)                  │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐   │
│  │  RECENT ACTIVITY        │  │  QUICK ACTIONS                          │   │
│  │                         │  │                                         │   │
│  │  Today                  │  │  [+ Schedule Vision Meeting]            │   │
│  │  • 2 new contacts added │  │  [+ Add Person]                         │   │
│  │  • Follow-up completed  │  │  [View Tasks Due Today]                 │   │
│  │                         │  │  [View Core Group]                      │   │
│  │  Yesterday              │  │                                         │   │
│  │  • Vision Meeting #11   │  │                                         │   │
│  │  • 18 new attendees     │  │                                         │   │
│  │  • 3 commitments        │  │                                         │   │
│  └─────────────────────────┘  └─────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Phase Progress Detail

Drill-down view for current phase.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Phase 1: Core Group Development                                             │
│  Purpose: Build a committed group of 50-100 adults                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  EXIT CRITERIA                                                 4/7 complete │
│                                                                              │
│  ☑ 30-40 committed adults minimum                                    38 ✓   │
│  ☐ Good momentum in Core Group growth                            Needs work │
│  ☑ Growing cohesiveness and unity                                    4.0/5  │
│  ☑ Financial base established                               $2,400/month ✓  │
│  ☑ Worship Leader identified                                   Sarah J. ✓   │
│  ☐ Geographic area identified                                    Not set    │
│  ☐ Facilities found or good possibilities                      0 prospects  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  PHASE METRICS                                                               │
│                                                                              │
│  Vision Meetings This Phase          Core Group Growth                       │
│  ┌────────────────────────────┐     ┌────────────────────────────────────┐  │
│  │ Total: 11                  │     │  40 ┤      ╭──────────────         │  │
│  │ Avg Attendance: 28         │     │  30 ┤   ╭──╯                       │  │
│  │ New Attendees: 156         │     │  20 ┤╭──╯                          │  │
│  │ Conversion Rate: 24%       │     │  10 ┤╯                             │  │
│  └────────────────────────────┘     │   0 ┼──────────────────────────    │  │
│                                      │      Jan  Feb  Mar  Apr  May       │  │
│  Follow-Up Performance               └────────────────────────────────────┘  │
│  ┌────────────────────────────┐                                              │
│  │ 48-hr completion: 89%      │     [View Phase Wiki Content]               │
│  │ Avg response time: 1.2 days│     [View Related Tasks]                    │
│  │ Best performer: You!       │                                              │
│  └────────────────────────────┘                                              │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Core Metrics Dashboard

Detailed view of key health indicators.

**Sections:**

#### Core Group Size Gauge
- Large gauge visualization
- Current count prominently displayed
- Minimum (50) and target (100) markers
- Growth velocity indicator (+X per week/month)
- Projection to target based on current velocity

#### Growth Velocity Chart
- Line chart showing Core Group size over time
- Trend line with projection
- Key events marked (Vision Meetings, commitments)

#### Vision Meeting Trends
- Attendance per meeting (bar chart)
- New vs returning attendees (stacked)
- Invitation effectiveness trends

#### Follow-Up Performance
- 48-hour completion rate
- Conversion funnel from attendee to committed

#### Ministry Team Readiness (Phase 2+)
- Teams with leaders assigned
- Staffing completion by team
- Training completion by team

---

### 4. 8 Critical Success Factors Scorecard

Deep dive into health indicators.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  8 Critical Success Factors                                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. VISION CASTING EFFECTIVENESS                              4.5/5  ↑      │
│     The SP's ability to cast compelling vision                               │
│     ─────────────────────────────────────────────────────────────────────    │
│     Indicators:                                                              │
│     • Attendee-to-follow-up conversion: 85%                                 │
│     • Follow-up-to-commitment conversion: 28%                               │
│     • Vision Meeting evaluation score: 4.3/5                                │
│                                                         [How to improve →]  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  2. SHARED OWNERSHIP                                          3.2/5  ↓      │
│     Core Group owns responsibility for growth                                │
│     ─────────────────────────────────────────────────────────────────────    │
│     Indicators:                                                              │
│     • Members meeting invitation goal (5+): 45%                             │
│     • Average invitations per member: 3.2                                   │
│     • Members who brought someone: 60%                                      │
│     ⚠️ Below target - see wiki for improvement strategies                   │
│                                                         [How to improve →]  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  [... 3-8 continue with similar format ...]                                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Launch Countdown (Phase 2+)

When launch date is set.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Launch Countdown                                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                           ┌─────────────────┐                               │
│                           │      127        │                               │
│                           │      DAYS       │                               │
│                           │   until launch  │                               │
│                           └─────────────────┘                               │
│                                                                              │
│            Launch Sunday: September 7, 2026                                  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  KEY MILESTONES                                                              │
│                                                                              │
│  │  ✓ Launch date set                                     Jan 20           │
│  │  ✓ Ministry team leaders assigned                      Feb 15           │
│  │  ○ All teams staffed 80%                              Target: Apr 30    │
│  │  ○ Training complete                                   Target: Jul 15   │
│  │  ○ Pre-launch services (3)                            Aug 17, 24, 31    │
│  │  ○ Promotion campaign launch                          Target: Aug 1     │
│  │  ★ LAUNCH SUNDAY                                       Sep 7            │
│  │                                                                          │
│                                                                              │
│  TIMELINE VIEW                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep                    │ │
│  │  ●─────●─────○─────○─────○─────○─────○─────○─────★                     │ │
│  │  ↑     ↑                                   ↑     ↑                     │ │
│  │ Now  Teams                            Pre-Launch Launch                │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 6. Coach Dashboard (Coach Role Only)

Overview of all assigned planters.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Coach Dashboard                                          Pastor Mike        │
│  5 Active Planters                                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ New Life Church                        Phase 1        Core Group: 38   │  │
│  │ Pastor John Smith                                                      │  │
│  │ ████████████░░░░░░░░  Exit Criteria: 57%           ● On Track         │  │
│  │ Last activity: Today                               [View Dashboard]   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Grace Community                        Phase 2        127 days to go   │  │
│  │ Pastor Sarah Johnson                                                   │  │
│  │ ████████████████░░░░  Teams: 80% staffed           ● On Track         │  │
│  │ Last activity: Yesterday                           [View Dashboard]   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Harvest Fellowship                     Phase 1        Core Group: 22   │  │
│  │ Pastor Mike Williams                                                   │  │
│  │ ████████░░░░░░░░░░░░  Exit Criteria: 29%           ⚠️ Needs Attention │  │
│  │ Last activity: 5 days ago                          [View Dashboard]   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  AGGREGATE METRICS                                                           │
│  Total Core Group across all plants: 145                                    │
│  Average Phase 1 completion: 52%                                            │
│  Plants needing attention: 1                                                │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Metric Calculations

### Core Group Size
- Count of Person records where status = 'core_group' or 'launch_team' or 'leader'

### Growth Velocity
- (Current Core Group - Core Group 30 days ago) / 30 = daily rate
- Multiply by 7 for weekly, 30 for monthly

### Vision Meeting Effectiveness
- Attendee-to-follow-up: % of new attendees who received follow-up
- Follow-up-to-commitment: % of followed-up who signed commitment

### Follow-Up Performance
- 48-hour completion: % of follow-up tasks completed within 48 hours of meeting

### 8 Critical Success Factors

| Factor | Calculation |
|--------|-------------|
| Vision Casting | Composite of VM attendance trend, conversion rates, VM evaluation scores |
| Shared Ownership | % members meeting invitation goal, avg invitations, % who brought someone |
| Critical Mass | Core Group size / 100 (target) |
| Unity | Average of 4 C's "Committed" scores across Core Group |
| Prayer | Prayer meeting attendance %, prayer team participation |
| Giving | Giving units / Core Group size, consistency metrics |
| Leadership | Leaders identified / 10 ministry teams |
| Training | Training completion % (relevant for Phase 3+) |

### Phase Exit Criteria
- Each criterion has a calculation or boolean check
- Overall = completed criteria / total criteria

---

## Integration Contracts

This feature is **read-only** and aggregates metrics via events and queries. It integrates with cross-cutting services defined in [System Architecture](../../system-architecture.md).

### Inbound (This Feature Consumes)

| Data | Contract | Source |
|------|----------|--------|
| **Core Group count** | Query `Person` records where `status IN ('core_group', 'launch_team', 'leader')` by `church_id` | People/CRM (via [Core Data Contracts](../../core-data-contracts.md)) |
| **Meeting metrics** | Subscribe to `meeting.completed` event; query meeting attendance trends | Vision Meeting events |
| **Task completion** | Query task completion rates by `church_id` and `category` | Task Service |
| **Giving metrics** | Query aggregate giving and giving units by `church_id` | Financial Service |
| **Team staffing** | Query filled roles vs total roles by `team_id` and `church_id` | Ministry Teams Service |
| **Phase status** | Subscribe to `phase.changed` and `phase.criteria.updated` events | Phase Engine (per [Core Data Contracts](../../core-data-contracts.md)) |

### Outbound (This Feature Provides)

| Data | Contract | Consumers |
|------|----------|-----------|
| **Dashboard summary** | Exposes aggregated metrics for coach multi-planter view | Coach dashboard |
| **Alert data** | Exposes threshold-based alerts (understaffed teams, overdue follow-ups) | Notification service |

---

## Alerts & Notifications

### Dashboard Alerts

| Condition | Alert Type | Action |
|-----------|-----------|--------|
| Follow-up overdue (>48 hours) | Warning | Highlight metric, suggest action |
| Core Group growth stalled (0 new in 14 days) | Warning | Show on dashboard |
| Phase exit criteria met | Info | Suggest phase advancement |
| Ministry team understaffed (<40%) | Warning | Highlight team |
| Training deadline approaching | Info | Show countdown |

### Scheduled Reports (Optional)

- Weekly progress email to planter
- Weekly summary to coach
- Monthly network rollup (admin)

---

## Success Metrics

### Dashboard Engagement
- Daily active users viewing dashboard
- Time spent on dashboard
- Most viewed metrics/sections

### Actionability
- Clicks through to "How to improve" wiki content
- Actions taken after viewing alerts
- Phase progression correlation with dashboard usage

---

## Oversight Access Patterns

### Coach Access
Coaches see the full dashboard view for each assigned church — the same view the planter sees. The coach dashboard (D-018) provides a multi-planter overview showing phase, Core Group size, exit criteria progress, and health indicators for all assigned planters.

### Sending Church Admin Access
Sending church admins see a portfolio dashboard showing all churches they have sent, including current phase, key aggregate metrics, and health indicators. Each metric's visibility is controlled by the corresponding feature's privacy toggle (e.g., people counts require `share_people`, meeting metrics require `share_meetings`).

### Network Admin Access
Network admins see a network-wide dashboard with plants by phase, aggregate health scores, and comparative analytics. Each metric's visibility is controlled by the corresponding feature's privacy toggle for each planter.

### Privacy Controls
- The dashboard aggregates data from other features. Each metric's visibility is controlled by the corresponding feature's privacy toggle
- Phase information and wiki progress are always visible (not subject to privacy toggles)
- Feature-specific metrics (people counts, meeting stats, task completion) respect their respective `share_*` toggles
- If a privacy toggle is off, the corresponding dashboard metric shows as "Not shared" rather than hidden, so oversight roles know data exists but is not accessible

---

## Open Questions

1. **Customization:** Can planters customize which metrics appear prominently?

2. **Comparison:** Should planters be able to compare their metrics to network averages?

3. **Export:** Should dashboard data be exportable for coach meetings or reports?

4. **Historical:** How far back should trend data be available?

5. **Alerts:** Should dashboard alerts trigger push notifications or just show on-screen?
