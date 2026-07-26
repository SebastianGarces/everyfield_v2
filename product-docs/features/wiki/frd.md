# F1: Wiki / Knowledge Base
## Feature Requirements Document (FRD)

**Version:** 1.2  
**Date:** July 25, 2026  
**Feature Code:** F1

---

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services
- [Core Data Contracts](../../core-data-contracts.md) - Shared entity contracts (Church, User, Person, Phase)

---

## Overview

The Wiki is a comprehensive educational resource providing church planters with structured guidance and best practices throughout their church planting journey. It combines the proven methodology from the Launch Playbook with practical templates, tutorials, and reference materials.

The Wiki is designed to help planters **learn**, understand the **why** behind each phase, and access **actionable resources** when they need them.

### Source of Expertise

The primary knowledge foundation is the **Launch Playbook** methodology (Harvest Bible Fellowship), which provides:

- Core Group development process
- Vision Meeting best practices & critical success factors
- Follow-up procedures & commitment formalization
- Ministry team structure & responsibilities
- Project management approach
- Launch Sunday preparation
- Administrative setup (legal, financial, technology)

Secondary sources include:
- Network coaches' experiential knowledge
- Successful planters' retrospectives and case studies
- Templates and documents from actual church plants
- Video content from training events

---

## Content Architecture

### Content Types

Inspired by software documentation best practices (Divio framework), the wiki organizes content into four types:

| Type | Purpose | Learning Style | Example |
|------|---------|----------------|---------|
| **Tutorials** | Learning-oriented guided walk-throughs | Learning | "Your First Vision Meeting: A Step-by-Step Guide" |
| **How-to Guides** | Task-oriented problem solving | Working | "How to Conduct a Follow-Up Interview" |
| **Explanations** | Understanding-oriented concepts & principles | Studying | "Why the 4 C's Matter for Core Group Health" |
| **Reference** | Information-oriented accurate details | Looking up | "8 Ministry Teams: Roles & Responsibilities" |

### Information Architecture

```
📚 Wiki Structure

├── 🏠 Home
│   ├── Quick Start (role-based entry points)
│   ├── What phase am I in?
│   └── How to use this wiki
│
├── 📖 The Journey (Phase-based)
│   ├── Phase 0: Discovery
│   ├── Phase 1: Core Group Development
│   ├── Phase 2: Launch Team Formation
│   ├── Phase 3: Training & Preparation
│   ├── Phase 4: Pre-Launch
│   ├── Phase 5: Launch Sunday
│   └── Phase 6: Post-Launch
│
├── 👥 Ministry Teams (Reference)
│   ├── Overview & Org Chart
│   └── [10 individual team sections]
│
├── 📐 Frameworks & Concepts
│   ├── The 4 C's
│   ├── 8 Critical Success Factors
│   ├── The Ministry Funnel (Worship/Walk/Work)
│   ├── The 4 Pillars
│   ├── Meeting Objectives (Inspire/Instill/Inform)
│   └── The 5 Interview Criteria
│
├── 📋 Administrative
│   ├── Legal Setup
│   ├── Financial Management
│   ├── Facilities
│   └── Technology
│
├── 📄 Templates & Downloads
│   ├── Commitment Documents
│   ├── Vision Meeting Materials
│   ├── Budget Worksheets
│   ├── Checklists by Team
│   └── Letter Templates
│
└── 🎓 Training Library
    ├── Video Content
    ├── Case Studies
    └── Network Resources
```

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement | Description |
|----|-------------|-------------|
| W-001 | Phase-based content organization | Wiki articles organized by the 6-phase journey |
| W-002 | Article viewing | Users can read full-text wiki articles with rich formatting |
| W-003 | Navigation | Hierarchical navigation with collapsible sections |
| W-004 | Search | Full-text search across all wiki content |
| W-005 | Current phase indicator | Display user's current phase prominently |
| W-006 | Phase-relevant recommendations | Show recommended articles based on user's current phase |
| W-007 | Article progress tracking | Track which articles a user has read (not started/in progress/completed) |
| W-008 | Breadcrumb navigation | Clear navigation path showing article location |
| W-009 | Related articles | Cross-linking between related wiki content |
| W-010 | Template linking | Articles can link to downloadable templates (F6 integration) |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| W-011 | Bookmarking | Users can bookmark articles for quick access |
| W-012 | Reading progress | Save scroll position for "continue reading" |
| W-013 | Time estimates | Display estimated read time per article |
| W-014 | Table of contents | Right-side TOC for long articles |
| W-015 | Recently viewed | Track and display recently viewed articles |
| W-016 | Article feedback | Thumbs up/down helpfulness rating |
| W-017 | Contextual surfacing | Show relevant wiki content within other features |
| W-018 | Download as PDF | Export individual articles as PDF |
| ~~W-019~~ | ~~Video content embedding~~ | **CUT 2026-07-26** (decision #6) — own-content production is far enough out that this isn't worth carrying. Drop the `WikiVideo` table with it. |
| W-020 | Print-friendly styling | Articles render well for printing |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| W-021 | Offline reading | Cache articles for offline access |
| W-022 | Audio versions | Text-to-speech or recorded audio for articles |
| W-023 | Coach annotations | Coaches can add notes visible to their planters |
| W-024 | Network customization | Networks can customize certain content |
| W-025 | Content versioning | Track changes and show changelog |
| W-026 | Interactive quizzes | Self-assessment within tutorials |
| W-027 | Personalized paths | AI-driven reading recommendations |
| W-028 | Multi-language support | Localized content (Spanish, etc.) |

---

## Detailed Content Structure

### Phase 0: Discovery

| Article | Type | Description |
|---------|------|-------------|
| Is Church Planting Your Calling? | Explanation | Self-assessment guidance, calling discernment |
| Understanding the 4 Pillars | Explanation | Ministry philosophy framework introduction |
| Defining Your Church Values | How-to | Process for identifying and documenting distinctives |
| The Worship/Walk/Work Model | Explanation | Discipleship funnel deep-dive |
| Setting Your Initial Goals | How-to | Goal-setting framework and timeline expectations |
| Finding a Coach/Mentor | How-to | How to connect with and work with mentors |

---

### Phase 1: Core Group Development

#### Vision Meetings Section

| Article | Type | Description |
|---------|------|-------------|
| What is a Vision Meeting? | Explanation | Definition, purpose, and importance |
| 8 Critical Success Factors for Vision Meetings | Reference | Detailed breakdown of each factor |
| Planning Your Vision Meeting | How-to | Location, logistics, agenda preparation |
| Running the Meeting | How-to | Step-by-step execution guide |
| Your First Vision Meeting | Tutorial | End-to-end walkthrough for beginners |
| Vision Meeting Kit Checklist | Reference | Physical materials needed |
| Vision Meeting Troubleshooting | How-to | Common problems and solutions |

#### Building Your Network Section

| Article | Type | Description |
|---------|------|-------------|
| The Invitation Imperative | Explanation | Why Core Group must own growth |
| Invitation Strategy | How-to | Step-by-step approach to inviting |
| Leveraging Social Media | How-to | Facebook, website, digital outreach |
| Asking for Referrals | How-to | Training Core Group to expand network |
| Setting Invitation Goals | How-to | Goal-setting for Vision Meeting attendance |

#### Follow-Up Section

| Article | Type | Description |
|---------|------|-------------|
| Why Follow-Up Matters | Explanation | The 4 reasons great follow-up is vital |
| The 48-Hour Rule | How-to | Timely follow-up execution |
| The Interview Process | How-to | Conducting qualification interviews |
| The 5 Interview Criteria | Reference | Maturity, Gifted, Chemistry, Right Reasons, Season of Life |
| Follow-Up Email Templates | Reference | Ready-to-use templates |
| Handling Objections | How-to | Common concerns and responses |

#### Formalizing Commitment Section

| Article | Type | Description |
|---------|------|-------------|
| The 3 Key Documents | Reference | Expectations, Commitment Card, Commitments |
| Having the Commitment Conversation | How-to | Asking for signed commitment |
| Managing Expectations | Explanation | What Core Group members should expect |

#### Core Group Assignments Section

| Article | Type | Description |
|---------|------|-------------|
| The 3 Primary Assignments | Explanation | GROW, PRAY, GIVE overview |
| GROW: Building the Core Group | How-to | Invitation responsibility and tracking |
| PRAY: Corporate and Personal Prayer | How-to | Establishing prayer rhythms |
| GIVE: Financial Foundation | Explanation | Giving principles and expectations |
| Core Group Meeting Format | Reference | Agenda structure and objectives |

---

### Phase 2: Launch Team Formation

| Article | Type | Description |
|---------|------|-------------|
| When to Set a Launch Date | Explanation | Variables and decision framework |
| Best Seasons to Launch | Reference | Fall vs Spring considerations |
| Core Group → Launch Team Transition | Explanation | What changes when launch date is set |
| Establishing Ministry Teams | How-to | Team formation process |
| The 10 Ministry Teams | Reference | Overview of all teams |
| Finding a Launch Coordinator | How-to | Role importance and selection criteria |
| Setting Up Project Management | How-to | Timeline, milestones, critical path |

---

### Phase 3: Training & Preparation

| Article | Type | Description |
|---------|------|-------------|
| Training Programs Overview | Explanation | What training is needed and why |
| Peak Performance I, II, III | Reference | Membership class curriculum guide |
| Small Group 101 | Reference | Small group leader training |
| Boot Camp | Reference | Intensive leadership discipleship |
| Ministry-Specific Training | Reference | Training by team |
| Church Visit Best Practices | How-to | Learning from existing churches |
| Training Completion Tracking | How-to | Ensuring readiness |

---

### Phase 4: Pre-Launch

| Article | Type | Description |
|---------|------|-------------|
| The 3-4 Week Countdown | Explanation | What this window is about |
| Operations & Equipment Setup | How-to | Set-up, tear-down, testing |
| Pre-Launch Services | How-to | Running rehearsal services |
| Intensifying Prayer Focus | How-to | Fasting weeks and corporate prayer |
| Promotion Plan Execution | How-to | Full promotion checklist |
| Promotion Channels Guide | Reference | Radio, email, social, direct mail, etc. |
| Final Checklist Review | Reference | Comprehensive pre-launch checklist |

---

### Phase 5: Launch Sunday

| Article | Type | Description |
|---------|------|-------------|
| Launch Day Guide | Tutorial | Complete walkthrough of launch day |
| Team Checklists | Reference | By-team execution checklists |
| Capturing the Moment | How-to | Video, photography, documentation |
| Partner Church Coordination | How-to | Network announcement and roles |
| After-Service Celebration | How-to | Recognizing the milestone |
| Launch Day Debrief | How-to | Post-launch review process |

---

### Phase 6: Post-Launch

| Article | Type | Description |
|---------|------|-------------|
| Establishing Weekly Rhythms | How-to | Sustainable operations setup |
| The Guest Assimilation Journey | Explanation | 9-step guest-to-member pathway |
| 48-Hour Guest Follow-Up | How-to | Weekly follow-up execution |
| Small Group Launch | How-to | Post-launch small group rollout |
| Party with the Pastor | Reference | Event format and purpose |
| Financial Sustainability | Explanation | Budget monitoring and adjustments |
| Growth Metrics to Track | Reference | Attendance, retention, giving metrics |

---

### Frameworks & Concepts

| Article | Type | Description |
|---------|------|-------------|
| The 4 C's: Committed, Compelled, Contagious, Courageous | Explanation | Core Group member qualities deep-dive |
| 8 Critical Success Factors | Reference | Launch health indicators |
| The Ministry Funnel (Worship/Walk/Work) | Explanation | Discipleship model |
| The 4 Pillars | Explanation | Customizable ministry philosophy |
| Meeting Objectives: Inspire, Instill, Inform | Explanation | Meeting format framework |
| The 5 Interview Criteria | Reference | Member qualification guide |

---

### Administrative

#### Legal Setup Section

| Article | Type | Description |
|---------|------|-------------|
| Incorporating as a Non-Profit | How-to | State-by-state guidance |
| 501(c)(3) Application | How-to | Tax-exempt status process |
| Required Documents | Reference | Articles, bylaws, EIN |

#### Financial Management Section

| Article | Type | Description |
|---------|------|-------------|
| First Year Budget | How-to | Budget creation with templates |
| Principles of Financial Accountability | Explanation | Biblical financial management |
| Collection Procedures | Reference | Handling cash and checks |
| Counting Procedures | Reference | Team structure and process |
| Disbursement Procedures | Reference | Approval and signature requirements |
| Designated Giving | Explanation | Policy and handling |

#### Facilities Section

| Article | Type | Description |
|---------|------|-------------|
| Site Selection Guide | How-to | Finding and evaluating venues |
| Facility Requirements Checklist | Reference | Evaluation criteria |
| Managing Venue Relationships | How-to | Ongoing relationship management |
| Equipment and Storage | Reference | What you need and where to store it |

#### Technology Section

| Article | Type | Description |
|---------|------|-------------|
| Website Setup Guide | How-to | Provider selection and launch |
| Assimilation Software | Reference | Options and selection criteria |
| Production Technology | Reference | AV, lighting, projection basics |

---

## Screens

### 1. Wiki Home

The primary landing page for the knowledge base.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🔍 Search wiki...                                    [Your Phase: Phase 1]  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Welcome to the EveryField Wiki                                              │
│  Your guide to launching a healthy, fruitful church.                         │
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │  🚀 Quick Start     │  │  📍 Where Am I?     │  │  📖 Browse Topics   │  │
│  │                     │  │                     │  │                     │  │
│  │  New to EveryField? │  │  Not sure which     │  │  Explore all wiki   │  │
│  │  Start here.        │  │  phase you're in?   │  │  content by topic.  │  │
│  │                     │  │  Let's figure it out│  │                     │  │
│  │  [Get Started]      │  │  [Find My Phase]    │  │  [Browse All]       │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  📌 RECOMMENDED FOR YOU (Phase 1)                                           │
│                                                                              │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐   │
│  │ 📄 Your First Vision Meeting    │  │ 📄 The 4 C's Explained          │   │
│  │    Tutorial • 15 min read       │  │    Explanation • 8 min read     │   │
│  │    ░░░░░░░░░░ Not started       │  │    ████████░░ 80% complete      │   │
│  └─────────────────────────────────┘  └─────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐   │
│  │ 📄 Follow-Up Best Practices     │  │ 📄 The 5 Interview Criteria     │   │
│  │    How-to • 10 min read         │  │    Reference • 5 min read       │   │
│  │    ░░░░░░░░░░ Not started       │  │    ░░░░░░░░░░ Not started       │   │
│  └─────────────────────────────────┘  └─────────────────────────────────┘   │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  📚 THE JOURNEY                                                             │
│                                                                              │
│  Phase 0        Phase 1        Phase 2        Phase 3        Phase 4        │
│  Discovery      Core Group  ●  Launch Team    Training       Pre-Launch     │
│  ○──────────────●──────────────○──────────────○──────────────○──────────○   │
│                 ↑ You are here                                               │
│                                                                              │
│  [View Phase 1 Content →]                                                    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Search bar with global wiki search
- Current phase indicator badge
- Quick start paths for different user types
- Recommended articles based on current phase
- Visual phase timeline showing progress
- Recently viewed articles
- Bookmarked articles quick access

---

### 2. Wiki Navigation (Side Panel)

Persistent left navigation panel.

**Layout:**

```
┌────────────────────────────────┐
│  🔍 Search...                  │
│                                │
│  ─────────────────────────────  │
│                                │
│  THE JOURNEY                   │
│  ▼ Phase 0: Discovery          │
│  ▼ Phase 1: Core Group    ←    │
│      • Overview                │
│      ▶ Vision Meetings    ←    │
│          ◦ What is a VM?       │
│          ◦ 8 Success Factors ← │
│          ◦ Planning            │
│          ◦ Running the Meeting │
│          ◦ VM Kit Checklist    │
│      ▶ Building Your Network   │
│      ▶ Follow-Up               │
│      ▶ Commitment              │
│      ▶ Core Group Assignments  │
│  ▶ Phase 2: Launch Team        │
│  ▶ Phase 3: Training           │
│  ▶ Phase 4: Pre-Launch         │
│  ▶ Phase 5: Launch Sunday      │
│  ▶ Phase 6: Post-Launch        │
│                                │
│  ─────────────────────────────  │
│                                │
│  REFERENCE                     │
│  ▶ Ministry Teams              │
│  ▶ Frameworks & Concepts       │
│  ▶ Administrative              │
│                                │
│  ─────────────────────────────  │
│                                │
│  RESOURCES                     │
│  ▶ Templates & Downloads       │
│  ▶ Training Library            │
│                                │
│  ─────────────────────────────  │
│                                │
│  🔖 My Bookmarks (3)           │
│  📕 Recently Viewed            │
│                                │
└────────────────────────────────┘
```

**Navigation Features:**
- Collapsible sections (expand/collapse on click)
- Current article highlighted
- Current phase section auto-expanded
- Progress indicators on articles (read/unread)
- Bookmark and recently viewed quick access
- Sticky positioning (scrolls with content)

---

### 3. Article View

The main reading interface for wiki content.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  [← Back to Phase 1]                                                         │
│                                                                              │
│  Phase 1 > Vision Meetings > 8 Critical Success Factors                     │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                    │  ON THIS PAGE          │
│  8 Critical Success Factors                        │                        │
│  for Vision Meetings                               │  1. Great Attendance   │
│  ═══════════════════════════════════════           │  2. Acceptable Location│
│                                                    │  3. Great Logistics    │
│  Reference • 12 min read • Last updated Jan 2026  │  4. Clear Agenda       │
│                                                    │  5. Great Vibe         │
│  [🔖 Bookmark]  [📤 Share]  [📥 Download PDF]      │  6. Compelling Message │
│                                                    │  7. Strong Close       │
│  ────────────────────────────────────────────────  │  8. Clear Next Steps   │
│                                                    │                        │
│  A successful Vision Meeting requires attention    │                        │
│  to these 8 critical factors. Master these and    │                        │
│  you'll see consistent Core Group growth.         │                        │
│                                                    │                        │
│  ## 1. Great Attendance                           │                        │
│                                                    │                        │
│  The Core Group + Senior Pastor own the           │                        │
│  responsibility of inviting and delivering a      │                        │
│  steady stream of new people...                   │                        │
│                                                    │                        │
│  ┌─────────────────────────────────────────────┐  │                        │
│  │ 💡 Pro Tip                                   │  │                        │
│  │                                             │  │                        │
│  │ Challenge members to invite minimum 5       │  │                        │
│  │ people to every Vision Meeting, with a     │  │                        │
│  │ goal of bringing at least one person.      │  │                        │
│  └─────────────────────────────────────────────┘  │                        │
│                                                    │                        │
│  [... content continues ...]                       │                        │
│                                                    │                        │
│  ────────────────────────────────────────────────  │                        │
│                                                    │                        │
│  📎 RELATED TEMPLATES                              │                        │
│  • Vision Meeting Kit Checklist                   │                        │
│  • Meeting Agenda Template                        │                        │
│                                                    │                        │
│  ────────────────────────────────────────────────  │                        │
│                                                    │                        │
│  🔗 RELATED ARTICLES                              │                        │
│  • Planning Your Vision Meeting                   │                        │
│  • Running the Meeting                            │                        │
│  • Invitation Strategy                            │                        │
│                                                    │                        │
│  ────────────────────────────────────────────────  │                        │
│                                                    │                        │
│  ← Previous: What is a Vision Meeting?            │                        │
│  → Next: Planning Your Vision Meeting             │                        │
│                                                    │                        │
│  ────────────────────────────────────────────────  │                        │
│                                                    │                        │
│  Was this article helpful?  [👍 Yes]  [👎 No]      │                        │
│                                                    │                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Article Features:**
- Breadcrumb navigation
- Article metadata (type, read time, last updated)
- Bookmark, share, download actions
- Right-side table of contents (sticky, highlights current section)
- Callout boxes for tips, warnings, important notes
- Related templates section (linked to F6)
- Related articles cross-linking
- Previous/Next navigation within section
- Feedback mechanism
- Print-friendly styling

---

### 4. Article Progress View

Shows reading progress across all wiki content.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  My Wiki Progress                                                            │
│                                                                              │
│  Overall Progress: 23/87 articles completed (26%)                           │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                     │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  BY PHASE                                                                    │
│                                                                              │
│  Phase 0: Discovery                    ████████████████████  6/6 (100%) ✓   │
│  Phase 1: Core Group Development       ████████████░░░░░░░░  12/20 (60%)    │
│  Phase 2: Launch Team Formation        ░░░░░░░░░░░░░░░░░░░░  0/8  (0%)      │
│  Phase 3: Training & Preparation       ░░░░░░░░░░░░░░░░░░░░  0/7  (0%)      │
│  Phase 4: Pre-Launch                   ░░░░░░░░░░░░░░░░░░░░  0/8  (0%)      │
│  Phase 5: Launch Sunday                ░░░░░░░░░░░░░░░░░░░░  0/6  (0%)      │
│  Phase 6: Post-Launch                  ░░░░░░░░░░░░░░░░░░░░  0/7  (0%)      │
│                                                                              │
│  Frameworks & Concepts                 ██████░░░░░░░░░░░░░░  3/6  (50%)     │
│  Administrative                        ██░░░░░░░░░░░░░░░░░░  2/12 (17%)     │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  📖 CONTINUE READING                                                         │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ The 5 Interview Criteria                                               │  │
│  │ Phase 1 > Follow-Up • Reference • 5 min read                          │  │
│  │ You stopped at: "Chemistry is about..."                               │  │
│  │                                                            [Continue] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Search Results

Full-text search across all wiki content.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🔍 "vision meeting"                                          [X Clear]     │
│                                                                              │
│  12 results found                                                            │
│                                                                              │
│  Filter by: [All Types ▼]  [All Phases ▼]  [Sort: Relevance ▼]              │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  📄 What is a Vision Meeting?                                               │
│     Phase 1 > Vision Meetings • Explanation                                  │
│     "A Vision Meeting is any gathering, large or small, formal or           │
│     informal, where the Senior Pastor and/or key leaders cast..."           │
│                                                                              │
│  📄 8 Critical Success Factors for Vision Meetings                          │
│     Phase 1 > Vision Meetings • Reference                                    │
│     "A successful Vision Meeting requires attention to these 8              │
│     critical factors. Master these and you'll see..."                       │
│                                                                              │
│  📄 Your First Vision Meeting                                               │
│     Phase 1 > Vision Meetings • Tutorial                                     │
│     "This step-by-step guide will walk you through planning and             │
│     executing your first Vision Meeting from start to finish..."            │
│                                                                              │
│  📄 Vision Meeting Kit Checklist                                            │
│     Phase 1 > Vision Meetings • Reference                                    │
│     "Physical materials needed for a successful Vision Meeting:              │
│     Guest Sign-in Sheet, Name Tags, Welcome Brochure..."                    │
│                                                                              │
│  [Load more results...]                                                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Search Features:**
- Full-text search across all articles
- Search highlighting in results
- Filters by content type, phase
- Sort by relevance or recency
- Contextual snippets showing match
- Keyboard navigation (arrow keys, enter)

*Implementation note: search shipped as a global Cmd/Ctrl+K command palette (top 10 results, no filters or sort) rather than this dedicated results page. Whether the palette is the canonical search UX or this screen is still required is an open decision.*

---

### 6. Templates & Downloads

Downloadable resources organized by category.

*Status: not built — pending product decision on templates (see WikiTemplate data model).*

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  📄 Templates & Downloads                                                    │
│                                                                              │
│  Filter by: [All Categories ▼]  [All Phases ▼]                              │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  COMMITMENT DOCUMENTS                                                        │
│                                                                              │
│  ┌──────────────────────────┐  ┌──────────────────────────┐                 │
│  │ 📋 Commitment Card       │  │ 📋 Expectations Document │                 │
│  │    PDF • 1 page          │  │    DOCX • 2 pages        │                 │
│  │    Phase 1               │  │    Phase 1               │                 │
│  │                          │  │                          │                 │
│  │  [Preview] [Download]    │  │  [Preview] [Download]    │                 │
│  └──────────────────────────┘  └──────────────────────────┘                 │
│                                                                              │
│  VISION MEETING MATERIALS                                                    │
│                                                                              │
│  ┌──────────────────────────┐  ┌──────────────────────────┐                 │
│  │ 📋 Vision Meeting Agenda │  │ 📋 Response Card         │                 │
│  │    DOCX • 1 page         │  │    PDF • 1 page          │                 │
│  │    Phase 1               │  │    Phase 1               │                 │
│  │                          │  │                          │                 │
│  │  [Preview] [Download]    │  │  [Preview] [Download]    │                 │
│  └──────────────────────────┘  └──────────────────────────┘                 │
│                                                                              │
│  ┌──────────────────────────┐  ┌──────────────────────────┐                 │
│  │ 📋 Guest Sign-in Sheet   │  │ 📋 VM Kit Checklist      │                 │
│  │    PDF • 1 page          │  │    PDF • 1 page          │                 │
│  │    Phase 1               │  │    Phase 1               │                 │
│  │                          │  │                          │                 │
│  │  [Preview] [Download]    │  │  [Preview] [Download]    │                 │
│  └──────────────────────────┘  └──────────────────────────┘                 │
│                                                                              │
│  BUDGET & FINANCIAL                                                          │
│                                                                              │
│  ┌──────────────────────────┐  ┌──────────────────────────┐                 │
│  │ 📊 First Year Budget     │  │ 📊 Budget Worksheet      │                 │
│  │    XLSX • Template       │  │    XLSX • Template       │                 │
│  │    Phase 2+              │  │    Phase 1+              │                 │
│  │                          │  │                          │                 │
│  │  [Preview] [Download]    │  │  [Preview] [Download]    │                 │
│  └──────────────────────────┘  └──────────────────────────┘                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 7. Training Library (Video Content)

Video resources organized by topic.

*Status: not built — pending product decision on the video library (see WikiVideo data model).*

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🎓 Training Library                                                         │
│                                                                              │
│  Filter by: [All Topics ▼]  [All Phases ▼]                                  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  VISION MEETING TRAINING                                                     │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  ▶ [Video Thumbnail]                                                    │ │
│  │                                                                         │ │
│  │  Casting Compelling Vision                                              │ │
│  │  Learn how to present your church vision in a way that                 │ │
│  │  transforms interested attendees into committed members.               │ │
│  │                                                                         │ │
│  │  23 min • Phase 1 • 847 views                        [Watch Now]       │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  ▶ [Video Thumbnail]                                                    │ │
│  │                                                                         │ │
│  │  Follow-Up That Converts                                               │ │
│  │  Best practices for turning Vision Meeting attendees into              │ │
│  │  committed Core Group members.                                         │ │
│  │                                                                         │ │
│  │  18 min • Phase 1 • 623 views                        [Watch Now]       │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  CASE STUDIES                                                                │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  ▶ [Video Thumbnail]                                                    │ │
│  │                                                                         │ │
│  │  Case Study: Grace Community Church Launch                              │ │
│  │  Pastor Mike shares lessons learned from his church plant              │ │
│  │  journey from discovery to 200+ members post-launch.                   │ │
│  │                                                                         │ │
│  │  34 min • All Phases • 1.2k views                    [Watch Now]       │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Workflows

### Workflow 1: First-Time Wiki User Onboarding

**Trigger:** User accesses wiki for the first time

**Steps:**

```
[User clicks Wiki in main navigation]
    ↓
[Wiki Home loads with onboarding prompt]
    ↓
"Welcome! Let's personalize your experience."
    ↓
[Quick assessment]:
├── Are you exploring church planting? → Phase 0 content
├── Building your Core Group? → Phase 1 content
├── Have a launch date? → Phase 2+ content
└── Not sure? → Phase finder quiz
    ↓
System sets recommended content based on response
    ↓
[Display personalized home with relevant articles]
    ↓
Optional: Guided tour of wiki features
```

---

### Workflow 2: Phase-Based Content Discovery

**Trigger:** User's church phase changes in system

**Steps:**

```
[Church phase updated (e.g., Phase 1 → Phase 2)]
    ↓
System identifies new relevant wiki content
    ↓
[Notification]: "You've moved to Phase 2! New content unlocked."
    ↓
Wiki home updates:
├── "Recommended for You" shows Phase 2 articles
├── Phase timeline highlights new phase
└── New articles marked with "New" badge
    ↓
User can still access all phases (no content locked)
```

---

### Workflow 3: Contextual Wiki Surfacing

**Trigger:** User is working in another feature and needs guidance

**Steps:**

```
[User is in Meetings (F3)]
    ↓
[Contextual help icon appears]
    ↓
Click icon → Sidebar panel opens with relevant wiki articles:
├── "8 Critical Success Factors for Vision Meetings"
├── "Planning Your Vision Meeting"
└── "Vision Meeting Kit Checklist"
    ↓
Click article → Opens in sidebar (doesn't leave current screen)
    ↓
"Open in full view" option to navigate to wiki
```

*Implementation note: shipped as the WikiGuide floating panel mounted across dashboard routes, driven by a route-pattern → article-slug mapping, rather than per-feature sidebar embeds.*

---

### Workflow 4: Bookmarking and Progress Tracking

**Trigger:** User reading an article

**Steps:**

```
[User reading article]
    ↓
System tracks:
├── Scroll position (for "Continue reading" later)
├── Time spent on page
└── Completion (scrolled to bottom)
    ↓
[User clicks Bookmark icon]
    ↓
Article added to "My Bookmarks" list
    ↓
[User finishes article]
    ↓
Article marked as "Completed" in progress tracker
    ↓
Progress percentage updates across views
```

---

### Workflow 5: Template Download

**Trigger:** User needs a template document

**Steps:**

```
[User navigates to Templates & Downloads]
    ↓
Browse or search for needed template
    ↓
Click "Preview" → Modal shows document preview
    ↓
Click "Download" → 
├── Select format (if multiple available)
└── File downloads to user's device
    ↓
System logs download for analytics
    ↓
[If template has related article]:
"Learn how to use this template" → Link to article
```

---

## Data Model

### WikiArticle

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | No | Reference to Church; `null` = global (platform-wide), value = church-specific |
| slug | String | Yes | URL-friendly identifier (unique within scope) |
| title | String | Yes | Article title |
| content | Rich Text | Yes | Article body (Markdown/MDX) |
| excerpt | Text | No | Short description for previews |
| content_type | Enum | Yes | `tutorial` / `how_to` / `explanation` / `reference` |
| phase | Enum | No | Phase 0-6, or null for cross-phase content |
| section | String | Yes | Primary section (e.g., "vision_meetings") |
| parent_article_id | UUID (FK) | No | Reference to parent article for hierarchy |
| read_time_minutes | Integer | No | Estimated read time |
| sort_order | Integer | No | Display order within section |
| related_article_ids | UUID[] | No | Array of related article IDs |
| related_template_ids | UUID[] | No | Array of related WikiTemplate IDs |
| status | Enum | Yes | `draft` / `published` / `archived` |
| published_at | Timestamp | No | Publication date |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

**Content Scope:**
- `church_id = null`: Global articles (Launch Playbook content, platform-wide resources) visible to all users
- `church_id = <uuid>`: Church-specific articles visible only to users of that church

**Query pattern:** `WHERE church_id IS NULL OR church_id = :current_church_id`

*Implementation note: the shipped `wiki_articles` schema diverges from this model — it uses a `section_id` FK instead of a `section` string, `related_article_slugs` (String[]) instead of `related_article_ids`, has no `parent_article_id` or `related_template_ids`, and adds `overview` and `guide` to the content_type enum. Whether to rewrite this model to match the shipped schema or converge the schema toward it is an open decision.*

---

### WikiSection

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| slug | String | Yes | URL-friendly identifier (unique) |
| name | String | Yes | Section name |
| description | Text | No | Section description |
| icon | String | No | Icon identifier |
| parent_section_id | UUID (FK) | No | Reference to parent section |
| phase | Enum | No | Associated phase, if any |
| sort_order | Integer | No | Display order |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

---

### WikiProgress

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| user_id | UUID (FK) | Yes | Reference to User |
| article_slug | String | Yes | Article slug (progress keys on slug, not an article FK) |
| status | Enum | Yes | `not_started` / `in_progress` / `completed` |
| scroll_position | Float | No | Last scroll position (0-1) |
| last_viewed_at | Timestamp | Yes | Last time the article was viewed (powers Recently Viewed) |
| completed_at | Timestamp | No | When marked complete |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

**Constraints:**
- Unique constraint on (user_id, article_slug)

*Note: `time_spent_seconds` from the original spec was not implemented.*

---

### WikiBookmark

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| user_id | UUID (FK) | Yes | Reference to User |
| article_slug | String | Yes | Article slug (bookmarks key on slug, not an article FK) |
| created_at | Timestamp | Yes | Creation timestamp |

**Constraints:**
- Unique constraint on (user_id, article_slug)

*Note: the `notes` field from the original spec was not implemented.*

---

### WikiTemplate

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Template name |
| description | Text | No | Template description |
| category | String | Yes | Category (e.g., "commitment", "vision_meeting") |
| file_type | Enum | Yes | `pdf` / `docx` / `xlsx` / `pptx` |
| file_url | String | Yes | URL to downloadable file |
| preview_url | String | No | URL to preview image/PDF |
| phase | Enum | No | Relevant phase |
| download_count | Integer | No | Download counter |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

*Status: not built — whether template downloads remain on the roadmap is an open decision.*

---

### WikiVideo

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| title | String | Yes | Video title |
| description | Text | No | Video description |
| video_url | String | Yes | URL to video (YouTube, Vimeo, etc.) |
| thumbnail_url | String | No | Thumbnail image URL |
| duration_minutes | Integer | No | Video duration |
| category | String | Yes | Category (e.g., "training", "case_study") |
| phase | Enum | No | Relevant phase |
| view_count | Integer | No | View counter |
| created_at | Timestamp | Yes | Creation timestamp |
| updated_at | Timestamp | Yes | Last update timestamp |

*Status: not built — whether the video library remains on the roadmap is an open decision.*

---

### WikiSearch

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| user_id | UUID (FK) | Yes | Reference to User |
| query | String | Yes | Search query text |
| results_count | Integer | No | Number of results returned |
| clicked_article_id | UUID (FK) | No | Article clicked from results |
| created_at | Timestamp | Yes | Timestamp of search |

*Note: Used for analytics and search improvement.*

*Status: not built — whether search analytics remain on the roadmap is an open decision.*

---

## Integration Contracts

This feature integrates with cross-cutting services defined in [System Architecture](../../system-architecture.md).

### Inbound (This Feature Consumes)

| Data | Contract | Source |
|------|----------|--------|
| **Current phase** | Read `church.current_phase` to filter phase-relevant content | Phase Engine |
| **User identity** | Read `user.id` for progress tracking and bookmarks | Auth Service |

### Outbound (This Feature Provides)

| Data | Contract | Consumers |
|------|----------|-----------|
| **Article completion** | Exposes `WikiProgress` by `user_id` for coaching metrics | Dashboard aggregation |
| **Template links** | Exposes `WikiTemplate.id` for document generation context | Document generation flow |
| **Contextual help** | Exposes article lookup by `slug` and `phase` for in-app help | Platform-wide contextual help system |

---

## Contextual Surfacing Rules

The wiki should appear contextually throughout the platform:

| Context | Wiki Content Surfaced |
|---------|----------------------|
| Creating first Vision Meeting | "Your First Vision Meeting" tutorial |
| Vision Meeting detail view | "8 Critical Success Factors" reference |
| Adding first Core Group member | "The 4 C's Explained" |
| Conducting follow-up | "The 5 Interview Criteria" |
| Entering Phase 2 | "When to Set a Launch Date" |
| Ministry Teams dashboard | Team-specific wiki sections |
| Budget setup | "First Year Budget" how-to |
| Facility search | "Site Selection Guide" |

---

## UI/UX Requirements

### General
- Responsive design (desktop, tablet, mobile)
- Clean, readable typography optimized for long-form reading
- Generous whitespace and clear hierarchy
- Consistent navigation patterns

### Reading Experience
- Comfortable line length (60-80 characters)
- Clear heading hierarchy (H1, H2, H3)
- Code-like styling for checklists and structured content
- Callout boxes for tips, warnings, important notes
- Smooth scroll with anchor linking

### Navigation
- Sticky side navigation on desktop
- Collapsible mobile navigation
- Breadcrumb trail always visible
- "On this page" TOC for long articles
- Keyboard shortcuts (j/k for next/prev, / for search)

### Accessibility
- WCAG 2.1 AA compliance
- Screen reader compatible
- Keyboard navigation support
- High contrast mode option
- Adjustable font size

### Performance
- Articles load in < 1 second
- Search results in < 500ms
- Lazy load images and videos
- Offline reading support (future enhancement)

---

## Success Metrics

### Engagement Metrics
- Articles read per user per week
- Average time spent reading per session
- Search usage frequency
- Bookmark usage
- Template download count

### Learning Metrics
- Wiki completion percentage by phase
- Correlation between wiki usage and phase progression speed
- Most/least accessed articles
- Drop-off points in long articles

### Content Quality Metrics
- Article helpfulness ratings (thumbs up/down)
- Search queries with no results (content gaps)
- Time to first wiki access (onboarding)
- Return visits to specific articles

---

## Content Development Plan

### Phase 1: Foundation (MVP)
- Structure Launch Playbook content into wiki framework
- Phase 0 complete content (6 articles)
- Phase 1 complete content (20 articles)
- Core frameworks content (6 articles)
- Essential templates (Commitment Card, Vision Meeting materials)
- Basic search functionality

### Phase 2: Enhancement
- Phase 2-6 complete content
- Full administrative section
- All templates and checklists
- Video content integration
- Advanced search with filters

### Phase 3: Enrichment
- Case studies from real church plants
- Coach-contributed content
- Interactive assessments and quizzes
- Personalized reading paths

### Phase 4: Community
- Coach annotations and tips
- Network-specific customizations
- User-contributed tips and learnings
- Content versioning and changelog

---

## Oversight Access Patterns

*Status: not built — no oversight surface currently reads wiki progress. Whether coach/sending-church/network visibility into wiki progress remains a requirement is an open decision.*

### Coach Access
Coaches can view wiki progress and bookmarks for their assigned churches. This includes per-article completion status, overall phase completion percentages, and bookmark lists. Access is read-only.

### Sending Church Admin Access
Sending church admins can see aggregate wiki completion rates across their plants — specifically, the percentage of articles completed per phase for each church plant they have sent.

### Network Admin Access
Network admins can see aggregate wiki completion rates across all plants in their network, enabling comparison of content engagement across the portfolio.

### Privacy Controls
- Wiki data is **not subject to privacy toggles** since it tracks content consumption, not church-specific operational data
- Wiki progress metrics (articles read, phase completion %) are always visible to oversight roles
- No per-feature privacy toggle is needed for wiki

---

## Open Questions

1. **Content authoring:** ~~Will wiki content be authored directly in the codebase (MDX files) or through an admin CMS interface?~~ **Resolved:** Content is authored as MDX and seeded into the `wiki_articles` table via `scripts/migrate-wiki-to-db.ts`; no CMS. The former in-repo `wiki/` content directory was removed after migration.

2. **Multi-language support:** Is localization needed for Spanish or other languages?

3. **Coach overlay:** Should coaches be able to add notes/annotations to articles visible only to their planters?

4. **Network customization:** ~~Can networks customize certain articles or add network-specific content?~~ **Resolved:** WikiArticle supports `church_id` scoping (null = global, value = church-specific). Network-level scoping deferred to future enhancement if needed.

5. **Print/Export:** Should users be able to export entire sections as PDF for offline reference?

6. **Versioning:** How do we handle content updates? Show changelog? Notify users of significant changes?

7. **Interactive elements:** Should tutorials include interactive elements (quizzes, progress checks)?

---

## Future Enhancements

### Post-MVP
- AI-powered search with natural language queries
- Personalized content recommendations based on activity
- In-article glossary tooltips for terminology
- Audio versions of key articles
- Spaced repetition for key concepts

### Long-term
- Community Q&A attached to articles
- Coach-to-planter content assignment ("Read this before our call")
- Content analytics dashboard for network administrators
- Integration with external training platforms (LMS)
- Mobile app with offline reading

---

## Appendix: Content Migration from Launch Playbook

The following Launch Playbook sections map to wiki content:

| Playbook Section | Wiki Location |
|-----------------|---------------|
| Introduction | Phase 0: Is Church Planting Your Calling? |
| Core Group Development Overview | Phase 1: Overview |
| Vision Meeting | Phase 1: Vision Meetings (entire section) |
| Follow Up | Phase 1: Follow-Up (entire section) |
| Formalize Commitment | Phase 1: Formalizing Commitment |
| Core Group Assignments | Phase 1: Core Group Assignments |
| Targeted Launch Date | Phase 2: When to Set a Launch Date |
| Mission Focus | Phase 3: Training Programs Overview |
| Gantt Chart / Timeline | Phase 2: Setting Up Project Management |
| Preparation for Launch Sunday | Phase 4 (entire phase) |
| Launch Sunday | Phase 5 (entire phase) |
| Administrative | Administrative (entire section) |
| Quick Reference: 4 C's | Frameworks: The 4 C's |
| Quick Reference: Checklists | Templates & Downloads |
