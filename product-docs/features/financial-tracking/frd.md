# F7: Financial Tracking
## Feature Requirements Document (FRD)

**Version:** 1.1  
**Date:** January 25, 2026  
**Feature Code:** F7

---

> **Scope: this feature is deferred** ([`decisions.md`](../../decisions.md), decision #2). Financial
> readiness is captured by attestation through the phase engine; this feature would replace that
> attestation with real tracking.
>
> Treat every requirement below as intentionally unbuilt, not as a gap.

---

> **Tracked on the board:** [F7 (deferred) #114](https://github.com/SebastianGarces/everyfield_v2/issues/114) — open requirements are its sub-issues. Implementation status is not tracked in this file.

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services
- [Core Data Contracts](../../core-data-contracts.md) - Shared entity contracts (Church, User, Person, Phase)

---

## Overview

Financial Tracking monitors giving and budget progress without handling actual transactions. This feature provides planters with visibility into financial health through aggregate metrics, budget planning tools, and giving trend analysis.

**Important:** EveryField does not process payments or track individual contribution amounts. Actual payment processing integrates with third-party giving platforms.

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement | Description |
|----|-------------|-------------|
| FIN-001 | Aggregate giving entry | Record total giving amounts (not individual contributions) |
| FIN-002 | Giving units tracking | Track number of giving households/individuals |
| FIN-003 | Monthly giving display | Show total giving by month |
| FIN-004 | Giving trend chart | Visualize giving over time |
| FIN-005 | Budget creation | Create annual budget with categories |
| FIN-006 | Budget line items | Add line items within budget categories |
| FIN-007 | Expense recording | Record expenses against budget |
| FIN-008 | Budget vs actual | Compare actual expenses to budgeted amounts |
| FIN-009 | Financial dashboard | Overview of giving and budget status |
| FIN-010 | Standard budget categories | Pre-defined categories (Personnel, Facilities, etc.) |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| FIN-011 | Budget template import | Start from pre-built First Year Budget template |
| FIN-012 | Expense categorization | Assign expenses to budget categories |
| FIN-013 | Receipt attachment | Attach receipt images to expenses |
| FIN-014 | Variance alerts | Flag when categories exceed budget |
| FIN-015 | Giving participation rate | Calculate % of Core Group giving |
| FIN-016 | Runway calculation | Project financial sustainability |
| FIN-017 | Launch budget projection | Track progress toward launch funding goal |
| FIN-018 | Export to CSV | Export financial data for external tools |
| FIN-019 | Monthly/annual views | Toggle between time period views |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| FIN-020 | Individual giving (opt-in) | Optional individual contribution tracking |
| FIN-021 | QuickBooks integration | Export to accounting software |
| FIN-022 | Multi-fund support | Designated funds (building, missions) |
| FIN-023 | Board reports | Exportable financial reports |
| FIN-024 | Scenario modeling | What-if projections |
| FIN-025 | Giving platform redirect | Direct link to online giving provider |

---

## Screens

### 1. Financial Dashboard

Primary financial overview.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Financial Overview                                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐   │
│  │  MONTHLY GIVING             │  │  GIVING UNITS                       │   │
│  │                             │  │                                     │   │
│  │     $8,450                  │  │       28                            │   │
│  │     ─────                   │  │       ──                            │   │
│  │     January 2026            │  │       of 38 Core Group              │   │
│  │                             │  │                                     │   │
│  │  Target: $10,000            │  │  74% participation                  │   │
│  │  ████████████████░░░░  85%  │  │  ██████████████████░░  74%          │   │
│  │                             │  │                                     │   │
│  │  ↑ 12% from last month      │  │  ↑ 3 new units this month          │   │
│  └─────────────────────────────┘  └─────────────────────────────────────┘   │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  GIVING TREND                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ $10k ┤                                                    ─ ─ Target   │ │
│  │      │                                          ╭──────                │ │
│  │  $8k ┤                              ╭──────────╯                       │ │
│  │      │                    ╭────────╯                                   │ │
│  │  $6k ┤          ╭────────╯                                             │ │
│  │      │  ╭──────╯                                                       │ │
│  │  $4k ┤──╯                                                              │ │
│  │      │                                                                 │ │
│  │  $2k ┤                                                                 │ │
│  │      ┼──────────────────────────────────────────────────────────────   │ │
│  │        Sep   Oct   Nov   Dec   Jan   Feb   Mar   Apr   May   Jun      │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  BUDGET VS ACTUAL (Year to Date)                                            │
│                                                                              │
│  Category              Budget      Actual      Variance                     │
│  ─────────────────────────────────────────────────────────────────────────   │
│  Personnel             $2,500      $2,500      $0         ✓                 │
│  Facilities            $1,200      $1,100      +$100      ✓                 │
│  Ministry Supplies     $500        $650        -$150      ⚠                 │
│  Marketing             $800        $400        +$400      ✓                 │
│  Technology            $300        $300        $0         ✓                 │
│  Administrative        $200        $180        +$20       ✓                 │
│  ─────────────────────────────────────────────────────────────────────────   │
│  TOTAL                 $5,500      $5,130      +$370      ✓                 │
│                                                                              │
│                                              [View Full Budget] [Edit Budget]│
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Budget Planning

Create and manage budgets.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Budget: 2026 Annual                                           [+ Add Item] │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  View: [Monthly ▼]                                     Total: $120,000/year │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  PERSONNEL                                                          $60,000 │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Senior Pastor Salary            $48,000/yr    $4,000/mo        [Edit] │  │
│  │ Benefits/Insurance              $9,600/yr     $800/mo          [Edit] │  │
│  │ Housing Allowance               $2,400/yr     $200/mo          [Edit] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  FACILITIES                                                         $18,000 │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Venue Rental                    $14,400/yr    $1,200/mo        [Edit] │  │
│  │ Storage                         $1,800/yr     $150/mo          [Edit] │  │
│  │ Insurance                       $1,800/yr     $150/mo          [Edit] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  MINISTRY SUPPLIES                                                   $6,000 │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Children's Curriculum           $2,400/yr     $200/mo          [Edit] │  │
│  │ Small Group Materials           $1,200/yr     $100/mo          [Edit] │  │
│  │ Worship Supplies                $1,200/yr     $100/mo          [Edit] │  │
│  │ Office Supplies                 $1,200/yr     $100/mo          [Edit] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  MARKETING/PROMOTION                                                $12,000 │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Website                         $1,200/yr     $100/mo          [Edit] │  │
│  │ Print Materials                 $3,600/yr     $300/mo          [Edit] │  │
│  │ Direct Mail Campaign            $4,800/yr     Pre-launch       [Edit] │  │
│  │ Social Media/Advertising        $2,400/yr     $200/mo          [Edit] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  [... more categories ...]                                                   │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  NETWORK CONTRIBUTION (5%)                                          $6,000  │
│  ⓘ Recommended 5% contribution to church planting network                   │
│                                                                              │
│                                              [Download Template] [Save]      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Giving Entry

Log aggregate giving data (not individual amounts).

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Record Giving                                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  AGGREGATE GIVING ENTRY                                                      │
│                                                                              │
│  Date: [January 26, 2026    ▼]                                              │
│                                                                              │
│  Total Amount: [$  2,150.00           ]                                     │
│                                                                              │
│  Number of Giving Units: [  28  ]                                           │
│                                                                              │
│  Source:                                                                     │
│  ○ Sunday Service Collection                                                │
│  ○ Online Giving Platform                                                   │
│  ○ Combined (all sources)                                                   │
│                                                                              │
│  Notes: [                                                       ]           │
│         [                                                       ]           │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  ⓘ Why we don't track individual giving amounts:                            │
│     • Protects member privacy                                               │
│     • Allows pastor to preach boldly about generosity                       │
│     • Aggregate data provides sufficient insight                            │
│     [Learn more about financial accountability →]                           │
│                                                                              │
│                                              [Cancel]  [Save]               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 4. Expense Tracking

Log actual expenses against budget.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Expenses                                               [+ Record Expense]   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Filter: [January 2026 ▼]  [All Categories ▼]                               │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  Date        Description              Category          Amount     Receipt  │
│  ─────────────────────────────────────────────────────────────────────────   │
│  Jan 24      Venue rental - January   Facilities        $1,200.00    📎     │
│  Jan 22      Children's curriculum    Ministry          $189.00      📎     │
│  Jan 20      Business cards           Marketing         $75.00       📎     │
│  Jan 18      Pastor salary - Jan      Personnel         $4,000.00    📎     │
│  Jan 15      Website hosting          Technology        $29.00       📎     │
│  Jan 12      Office supplies          Administrative    $45.00       📎     │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  JANUARY SUMMARY                                                             │
│                                                                              │
│  Total Expenses: $5,538.00                                                  │
│  Budget: $5,500.00                                                          │
│  Variance: -$38.00 (over budget by 0.7%)                                    │
│                                                                              │
│                                              [Export to CSV] [Export to QB] │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Financial Projections

Runway and sustainability analysis.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Financial Projections                                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CURRENT RUNWAY                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                         │ │
│  │  Based on current giving rate ($8,450/mo) and expenses ($5,500/mo):    │ │
│  │                                                                         │ │
│  │  Monthly Surplus: $2,950                                                │ │
│  │  Cash Reserve: $18,500                                                  │ │
│  │  Runway: Sustainable ✓                                                  │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  LAUNCH BUDGET PROJECTION                                                    │
│                                                                              │
│  Launch Date: September 7, 2026                             226 days away   │
│                                                                              │
│  Category                      Budgeted        Projected      Status        │
│  ─────────────────────────────────────────────────────────────────────────   │
│  Pre-Launch Expenses           $35,000         $32,500        ✓ On track    │
│  Launch Sunday Event           $8,000          $8,000         ✓ On track    │
│  First 6 Months Post-Launch    $66,000         $66,000        ✓ Funded      │
│  ─────────────────────────────────────────────────────────────────────────   │
│  Total Launch Budget           $109,000        $106,500       ✓ 98%         │
│                                                                              │
│  Current Progress: $42,500 raised of $109,000 (39%)                         │
│  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░                                   │
│                                                                              │
│  At current rate, you will reach goal by: August 15, 2026 ✓                 │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  SCENARIOS                                                                   │
│                                                                              │
│  If giving increases 10%:  Goal reached by July 20, 2026                    │
│  If giving decreases 10%: Goal reached by September 25, 2026 ⚠              │
│  If giving stays flat:     Goal reached by August 15, 2026                  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Workflows

### Workflow 1: Creating Initial Budget

**Trigger:** User sets up financial tracking

**Steps:**

```
[Financial Dashboard] → [Create Budget]
    ↓
Select budget type:
├── Start from template (recommended)
└── Start from scratch
    ↓
[If template]:
    ↓
    Import the First Year Budget template from the document-templates catalog
    ↓
    Pre-populated with standard categories
    ↓
[Customize]:
├── Adjust amounts per category
├── Add/remove line items
└── Set monthly vs annual amounts
    ↓
[Save Budget]
    ↓
Budget active for tracking
```

---

### Workflow 2: Recording Weekly Giving

**Trigger:** After Sunday service / weekly giving period

**Steps:**

```
[Financial Dashboard] → [Record Giving]
    ↓
[Giving Entry form]
    ↓
Enter:
├── Date
├── Total aggregate amount
├── Number of giving units
└── Source
    ↓
[Save]
    ↓
Giving record created
    ↓
Dashboard metrics updated:
├── Monthly total recalculated
├── Trend chart updated
└── Budget vs actual refreshed
```

---

### Workflow 3: Recording Expense

**Trigger:** Expense incurred

**Steps:**

```
[Expenses] → [+ Record Expense]
    ↓
[Expense form]:
├── Date
├── Description
├── Amount
├── Category (from budget categories)
├── Vendor (optional)
└── Receipt upload (optional)
    ↓
[Save]
    ↓
Expense recorded
    ↓
Budget vs actual updated
    ↓
[If over budget for category]:
    ↓
    Alert displayed on dashboard
```

---

## Data Model

### Budget

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| name | String | Yes | Budget name (e.g., "2026 Annual") |
| type | Enum | Yes | `annual` / `launch` / `monthly` |
| start_date | Date | Yes | Budget period start |
| end_date | Date | Yes | Budget period end |
| total_amount | Decimal | Yes | Total budgeted amount |
| status | Enum | Yes | `draft` / `active` / `closed` |
| created_by_id | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### BudgetLineItem

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| budget_id | UUID (FK) | Yes | Reference to Budget |
| category | Enum | Yes | `personnel` / `facilities` / `ministry` / `marketing` / `technology` / `administrative` / `network` / `other` |
| name | String | Yes | Line item name |
| description | Text | No | Description |
| annual_amount | Decimal | No | Annual budgeted amount |
| monthly_amount | Decimal | No | Monthly budgeted amount |
| is_recurring | Boolean | Yes | Regular monthly expense |
| sort_order | Integer | No | Display order within category |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### GivingRecord

Aggregate giving entry (not individual contributions).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| date | Date | Yes | Giving date |
| amount | Decimal | Yes | Total aggregate amount |
| giving_units | Integer | No | Number of giving households/individuals |
| source | Enum | No | `service` / `online` / `combined` |
| notes | Text | No | Notes |
| recorded_by_id | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |

---

### Expense

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| budget_line_item_id | UUID (FK) | No | Reference to BudgetLineItem |
| date | Date | Yes | Expense date |
| description | String | Yes | Expense description |
| amount | Decimal | Yes | Expense amount |
| category | Enum | Yes | Same as BudgetLineItem categories |
| vendor | String | No | Vendor name |
| receipt_document_id | UUID (FK) | No | Reference to the stored receipt document |
| payment_method | Enum | No | `check` / `card` / `cash` / `transfer` |
| recorded_by_id | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |

---

## Financial Accountability Principles

The principles this feature embodies. Its procedures, roles, and approval rules follow from them.

### Core Principles
- Senior Pastor should NOT handle money or write checks
- Separation of duties between collection, counting, and disbursement
- Establish a Financial Leader immediately

### Collection Procedures
- Handle cash and checks securely and confidentially
- No single individual should handle money alone
- Place immediately into secure/locked container

### Counting Procedures
- Minimum 3 people per counting team
- Rotate team members
- Create deposit slip with date, signatures, and amount

### Disbursement Procedures
- Over minimum limit: Require two signatures
- Over maximum limit: Require elder board approval
- NEVER sign blank checks or forms

---

## Integration Contracts

This feature integrates with cross-cutting services defined in [System Architecture](../../system-architecture.md). For shared entity contracts, see [Core Data Contracts](../../core-data-contracts.md).

### Inbound (This Feature Consumes)

| Data | Contract | Source |
|------|----------|--------|
| **Core Group count** | Read count of `Person` records with `status = 'core_group'` for giving participation rate | People/CRM (via [Core Data Contracts](../../core-data-contracts.md)) |
| **Budget templates** | Read the template catalog filtered to category `budget`, for First Year Budget import | Document template catalog |

### Outbound (This Feature Provides)

| Data | Contract | Consumers May |
|------|----------|---------------|
| **Giving metrics** | Exposes monthly giving totals, giving unit counts, and trends by `church_id` | Dashboard aggregation |
| **Budget vs actual** | Exposes variance data by `church_id` and `category` | Dashboard financial health display |

### External Services

| Function | Purpose | Integration |
|----------|---------|-------------|
| **Accounting export** | Export to QuickBooks, Wave | CSV/API export |
| **Giving platform** | Redirect to online giving provider | External link |

---

## Budget Categories

| Category | Description | Typical % |
|----------|-------------|-----------|
| Personnel | Salary, benefits, housing | 40-50% |
| Facilities | Rent, utilities, insurance | 15-20% |
| Ministry | Curriculum, supplies, events | 10-15% |
| Marketing | Website, print, advertising | 5-10% |
| Technology | Software, equipment | 3-5% |
| Administrative | Office, legal, accounting | 3-5% |
| Network | Church planting network contribution | 5% |
| Reserve | Emergency/contingency | 5-10% |

---

## Success Metrics

### Financial Health
- Monthly giving vs budget
- Giving unit participation rate
- Expense variance from budget

### Feature Engagement
- Budget utilization (% of churches with active budget)
- Giving recording frequency
- Projection feature usage

---

## Oversight Access Patterns

### Coach Access
- Can view budget, giving records, and financial health for assigned churches

### Sending Church Admin Access
- Aggregate financial metrics only: total giving, budget health percentage, giving trend
- Subject to `share_financials` privacy toggle

### Network Admin Access
- Aggregate financial metrics across all plants in the network
- Subject to `share_financials` privacy toggle

### Privacy Controls
- Planter controls visibility via per-feature privacy toggle in church privacy settings
- Privacy toggle for this feature: `share_financials`
- Default: `false` (not shared until planter opts in)

---

## Open Questions

1. **Individual tracking:** Should there be an optional mode for tracking individual giving (with appropriate privacy controls)?

2. **Integration depth:** How deep should accounting software integration go? Read-only export or bidirectional sync?

3. **Giving platform:** Should EveryField recommend specific giving platforms? Partner integrations?

4. **Multi-fund:** Should budgets support designated funds (building fund, missions, etc.)?

5. **Reporting:** What financial reports should be exportable for board meetings?
