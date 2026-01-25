# EveryField - Product Brief

**Version:** 1.0  
**Date:** January 25, 2026  
**Source Document:** Launch Playbook v1.2 (Harvest Bible Fellowship)

---

## Problem Statement

Church planting is a complex endeavor requiring coordination across multiple domains: vision casting, team building, financial management, facility acquisition, ministry team development, and launch execution. Currently, planters rely on disconnected tools (spreadsheets, CRM software, paper documents, external services) with no unified system that:

- Provides structured guidance through each phase
- Tracks progress against proven methodologies
- Manages relationships with potential and committed team members
- Offers templates for critical documents and meetings
- Monitors key metrics that predict launch success

---

## Product Vision

A single platform where church planters can **learn**, **plan**, **execute**, and **measure** their church plant journey with confidence, guided by proven best practices from the Launch Playbook methodology.

---

## Target Users

| User Type | Description |
|-----------|-------------|
| **Potential Planter** | Someone exploring whether church planting is their calling |
| **Active Planter** | Someone actively working toward launching a church |
| **Coach/Mentor** | Experienced leaders providing oversight to planters |
| **Core Group Member** | Committed individuals who are part of the launch team |

---

## Core Concepts & Domain Language

### The 4 C's Member Framework

Every Core Group member should embody these qualities (used for assessment and tracking):

- **Committed** - Signed commitment, consistent attendance, faithful giving
- **Compelled** - Internally motivated by the vision, can articulate the why
- **Contagious** - Actively inviting others, growing their sphere of influence
- **Courageous** - Bold in action despite uncertainty, willing to sacrifice

### 8 Critical Success Factors

Key indicators that predict a healthy and fruitful church launch:

1. **Vision Casting Effectiveness** - The Senior Pastor's ability to cast compelling vision that transforms interested individuals into committed members
2. **Shared Ownership** - Core group members own the responsibility equally with the Senior Pastor for growing the Core Group
3. **Critical Mass** - Core Group grows to minimum 50 adults (target: 100 adults)
4. **Unity & Cohesiveness** - Deep work of God's Spirit growing the Core Group together
5. **Prayer Commitment** - Consistent, fervent prayer permeating the Core Group
6. **Generous Giving** - Sacrificial spirit of generosity to adequately fund the launch
7. **Leadership Emergence** - Leaders emerge to own the 8 primary ministry responsibilities
8. **Comprehensive Training** - Core Group trained in the ministry model and key responsibilities

### The Ministry Funnel (Discipleship Model)

The platform supports tracking members through the discipleship journey:

- **Worship** - Weekend services and corporate gatherings
- **Walk** - Small groups and personal spiritual growth
- **Work** - Active service and ministry involvement

### The 4 Pillars

Foundational ministry philosophy elements representing core values and distinctives that define the church's identity. Each planter defines their own 4 Pillars during Phase 0, guided by examples and frameworks in the wiki.

### Core Group Member Primary Assignments

Every Core Group member has three non-negotiable responsibilities:

1. **GROW** - Actively invite others to Vision Meetings
2. **PRAY** - Fervent and faithful prayer
3. **GIVE** - Generous, faithful, sacrificial giving

### Meeting Objectives Framework

- **INSPIRE** - Cast Vision (renew vision, remind of purpose)
- **INSTILL** - Enculturate the Team (teach values, distinctives, DNA)
- **INFORM** - Train the Team (corporate and ministry-specific training)

### The 5 Interview Criteria

Qualification criteria for potential Core Group members:

1. **Maturity** - Are they spiritually and emotionally mature?
2. **Gifted** - Do they bring a needed skill set?
3. **Chemistry** - Is there good chemistry with leadership?
4. **Right Reasons** - Are they coming for the right reasons?
5. **Season of Life** - Are they in a stable season of life?

---

## Phase Structure

The platform guides planters through six distinct phases. Each phase has specific goals, activities, and tracked metrics defined in the relevant Feature Requirements Documents.

| Phase | Name | Purpose |
|-------|------|---------|
| **Phase 0** | Discovery | Help potential planters learn, discern their calling, and establish foundational elements |
| **Phase 1** | Core Group Development | Build a committed group of 50-100 adults through Vision Meetings and relationship building |
| **Phase 2** | Launch Team Formation | Transition Core Group into Launch Team with set launch date and clear mission focus |
| **Phase 3** | Training & Preparation | Comprehensive training of all ministry teams to ensure readiness |
| **Phase 4** | Pre-Launch | Intensive final preparation (3-4 weeks before launch) through integration, testing, and promotion |
| **Phase 5** | Launch Sunday | Execute a high-impact first public service |
| **Phase 6** | Post-Launch | Transition to sustainable weekly operations while maintaining growth momentum |

---

## Features

The platform consists of the following features, each documented in a separate Feature Requirements Document (FRD):

| Code | Feature | Description |
|------|---------|-------------|
| F1 | Wiki / Knowledge Base | Educational resource with structured guidance and best practices |
| F2 | People / CRM Management | Track individuals from initial contact through committed team member |
| F3 | Vision Meeting Management | Plan, execute, and track Vision Meetings |
| F4 | Progress Dashboard | Visual representation of launch progress and health indicators |
| F5 | Task & Project Management | Track all tasks with templates and timeline visualization |
| F6 | Document Templates & Generation | Ready-to-use templates for critical documents |
| F7 | Financial Tracking | Monitor giving and budget progress |
| F8 | Ministry Team Management | Organize, staff, and track ministry teams |
| F9 | Communication Hub | Centralized communication with team members and prospects |
| F10 | Facility Management | Track facility search, evaluation, and venue relationship |

---

## Success Metrics

### Platform Success Metrics

- Number of active planters using the platform
- Percentage of planters completing each phase
- Average time-to-launch compared to historical norms
- Core group size at launch compared to historical averages
- Planter satisfaction scores

### In-Platform Planter Success Metrics

- Vision Meeting attendance growth trend
- Follow-up completion rate (target: 100% within 48 hours)
- Core Group growth velocity
- Commitment card conversion rate
- Ministry team staffing completion rate
- Training completion rates
- 8 Critical Success Factors scores
- Launch attendance vs. Core Group size ratio

---

## Non-Goals

The following are explicitly out of scope for EveryField:

- **Payment Processing** - The platform does not handle actual transactions; integrates with third-party giving platforms
- **Detailed Contribution Tracking** - Individual giving amounts are not tracked (only aggregate metrics)
- **Church Management Post-Launch** - Focus is on the launch journey; ongoing church management defers to specialized ChMS tools
- **Content Management System** - Wiki content is curated, not user-generated
- **Social Network Features** - Not a social platform for church members

---

## Open Questions

1. **Multi-tenancy Model:** Will this support multiple church planting networks with their own branding, or is it a single-network platform?

2. **Coach Visibility:** Should coaches have dashboards showing all their assigned planters' progress?

3. **Mobile Priority:** Is native mobile app required for certain functions (like Vision Meeting check-in), or is mobile-responsive web sufficient?

4. **Offline Needs:** Do planters need offline access for Vision Meetings or other field activities?

5. **Content Customization:** Can networks customize wiki content and templates, or is it standardized?

6. **Member Self-Service:** Should Core Group members have their own login to update info, view training, see team assignments?

7. **Data Migration:** Do planters have existing data in spreadsheets or other tools that needs to be imported?

---

## Reference Documents

- **Domain Reference:** [Launch Playbook](./launch-playbook.md) - Authoritative source material the product implements
- **System Architecture:** [system-architecture.md](./system-architecture.md) - System-wide constraints and data model
- **Feature Requirements:** Located in `./features/<feature-name>/frd.md`
