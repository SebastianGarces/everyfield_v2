# EveryField - App Summary

## The Problem

The church technology industry is a multi-billion dollar market, yet virtually all software is designed for **established churches**: website builders (e.g., Subsplash, Church Online Platform), church management systems (Planning Center, Breeze, Church Community Builder), giving platforms (Tithe.ly, Pushpay), and streaming/media tools. These products assume a church already exists — with a congregation, a building, a staff, and weekly services.

None of them address what comes **before** all of that.

Church planting — the process of starting a new church from scratch — is a 1-to-3-year journey that looks nothing like running an established church. A planter begins with zero people, no building, no budget, and no team. They need to cast vision, build a core group of 50–100 committed adults, develop ministry teams, secure a facility, manage finances, train leaders, and eventually execute a public launch. This process involves hundreds of tasks across dozens of domains, all while juggling relationships with a sending church and/or a church planting network that may be overseeing and supporting them.

Today, planters manage all of this with a patchwork of disconnected tools: spreadsheets for tracking contacts, a personal CRM (or nothing at all), paper sign-in sheets at vision meetings, group texts for communication, Google Docs for training materials, and email threads for coordination with their sending church. There is no unified system that provides structured guidance through each phase, tracks progress against proven methodologies, manages the pipeline of relationships, or gives sending networks visibility into how their planters are doing.

**EveryField exists to fill this gap** — the first platform purpose-built for the church planting journey.

---

## What EveryField Does Today

EveryField is a web application that gives church planters a single platform to **learn**, **plan**, **execute**, and **measure** their church plant journey, guided by proven best practices from the Launch Playbook methodology (developed by Harvest Bible Fellowship).

### Multi-Tenant Hierarchy

The platform serves three distinct user types at different levels of the church planting ecosystem:

```
Sending Network (e.g., Send Network, ARC — oversees 10-1000+ plants)
    └── Sending Church (a church that sends planters — oversees 1-5 plants)
        └── Church Plant
            ├── Planter (the church planter themselves)
            ├── Coach / Mentor
            └── Core Group Members
```

All relationships are optional and mutable. A planter can sign up independently and later accept an invitation to join a sending church or network. Each tier has its own navigation and dashboard:

- **Planters** see the full toolset: Dashboard, Wiki, People & CRM, Meetings, Tasks, Communication, Ministry Teams, Phase (Plant Intelligence), and more.
- **Sending Church Admins** see a portfolio view of their church plants, invitations, and settings.
- **Network Admins** see a network-wide overview of sending churches and church plants with aggregate metrics, plus a plant health view powered by the Phase Engine.

> **This document describes the product, not the build state.** Implementation status lives on the
> GitHub board (`gh issue list --label feature`) — it is the only place that says what is shipped,
> in flight, or queued. Read the sections below as a description of what EveryField is.

### Core Features

**Phase Engine (Plant Intelligence)** — The platform's primary differentiator. An advisory intelligence engine that reads each plant's real activity (a deterministic Signal layer computes fact snapshots from the database), judges it against the Launch Playbook methodology via an LLM-as-judge grounded in retrieved methodology content (RAG over embedded methodology chunks), and surfaces prioritized insights to the planter on a dedicated Phase page — with useful / not-useful feedback on each insight. Phase transitions are soft-gated and planter-confirmed (forward, back, or skip — never blocked), recorded in an immutable audit trail with the fact snapshot and rubric version. Oversight users get a plant health view with assessment-derived health signals. Runs on OpenAI gpt-4o via the Vercel AI SDK.

**People & CRM** — A Kanban-style pipeline that tracks every person from initial contact through committed team member. Statuses flow through: Prospect → Attendee → Following Up → Interviewed → Core Group → Launch Team → Leader. The CRM includes household grouping, tagging, skills inventory, 4 C's assessments (Committed, Compelled, Contagious, Courageous), 5-criteria interviews (Maturity, Gifted, Chemistry, Right Reasons, Season of Life), commitment tracking, activity timelines, notes, and CSV import with duplicate detection.

**Meetings** — Full lifecycle management for Vision Meetings (the primary outreach tool where the planter casts vision to grow the core group), Orientations, and Team Meetings. Includes meeting creation, location management, invitation tracking (who invited whom), RSVP via email with token-based confirmation buttons, attendance recording (first-time vs. returning vs. core group), preparation checklists, post-meeting evaluations with scoring (attendance, location, logistics, agenda, vibe, message, close, next steps), and attendee notes.

**Tasks** — Task management with statuses (not started, in progress, blocked, complete), priorities (low through urgent), due dates, assignment, categories (vision meeting, follow-up, training, facilities, promotion, administrative, ministry team, launch prep, recurring, general), parent/sub-task relationships, recurring task support, and event-driven auto-completion.

**Wiki / Knowledge Base** — A curated, structured knowledge base that guides planters through the seven phases (0–6) of the church planting journey: Phase 0 (Discovery), Phase 1 (Core Group Development), Phase 2 (Launch Team Formation), Phase 3 (Training & Preparation), Phase 4 (Pre-Launch), Phase 5 (Launch Sunday), Phase 6 (Post-Launch). Articles cover frameworks like the 4 C's, 8 Critical Success Factors, the Ministry Funnel, the 4 Pillars, Meeting Objectives (Inspire, Instill, Inform), and the 5 Interview Criteria. Includes full-text search, reading progress tracking, bookmarks, and support for network/church-specific content.

**Communication Hub** — Email messaging with reusable templates (meeting invitations, reminders, follow-ups, core group communications, team updates, announcements, launch communications). Per-recipient delivery tracking (sent, delivered, opened, clicked, bounced). Meeting-linked communications with RSVP confirmation tokens. Powered by Resend for email delivery. SMS is in scope but deferred to post-beta.

**Dashboard** — Aggregated metrics (core group size, total people, overdue tasks, vision meetings held) and a cross-feature activity feed showing recent contact additions, status changes, commitments, completed meetings, and completed tasks.

**Ministry Teams** — Team organization and management for the 8-10 ministry teams a church plant needs to staff before launch (worship, tech, hospitality, children's ministry, etc.).

**Feedback** — In-app feedback collection (bugs, suggestions, questions) with status tracking.

### Further Features

Also part of the product's scope. Check the board for where each one stands.

- **Documents & Templates** — Ready-to-use templates for commitment documents, vision meeting materials, budget worksheets, team checklists, and letter templates.
- **Financial Tracking** — Budget monitoring and aggregate giving metrics (no individual contribution tracking — integrates with third-party giving platforms).
- **Notifications & Digest** — Shared delivery infrastructure: an in-app notification rail, an email digest, and per-category preferences, so features stop inventing their own delivery.
- **Planter Onboarding** — The first-run journey from account creation to a plant the planter can actually work in.
- **Oversight** — The overseer's surface: a plant directory and per-plant detail with privacy-gated aggregates, plus association invite, accept, and sever with an audit trail.
- **Launch (Launch Sunday)** — Launch as a first-class entity: target date, status lifecycle, readiness milestones, and the outcome of the day itself.

---

## AI: The Two Halves of the Direction

The biggest opportunity with EveryField is reducing the operational burden on the planter. Church planters are typically not administrators — they're pastors, visionaries, and relationship builders. Every minute spent clicking through forms, writing follow-up emails, or hunting for the right wiki article is a minute not spent casting vision or meeting with people.

The AI direction has two separate halves. The **judgment half** is the Phase Engine (see Core Features above): a retrieval-grounded judge that assesses each plant against the Launch Playbook and surfaces insights to planters and health signals to oversight. The **action half** is [Evry](./features/church-plant-agent/frd.md), a conversational application-action workspace for accounts in a plant tenancy.

### Evry Application Actions

Evry is available as a contextual panel and a dedicated conversation workspace. A person describes the EveryField work they need, reviews any lasting effects in a structured confirmation artifact, and confirms before Evry changes data, stores a file, or sends a communication.

**Meeting work:**

- *"Schedule a vision meeting for next Thursday at 7pm at the Johnson's house"* → Evry resolves the date, location, and meeting details, then presents the meeting for confirmation.
- *"Invite everyone who attended the last vision meeting plus the 5 new prospects I added this week"* → Evry resolves and previews the exact recipient set and communication before confirmation.
- *"Send a reminder to everyone who hasn't RSVP'd to Thursday's meeting"* → Evry finds the eligible recipients, reports exclusions, and previews the reminder before confirmation.

**People work:**

- *"Add John and Sarah Miller — they came to the vision meeting last night and Mike Davis referred them"* → Evry prepares the two People/CRM records, household link, source, referrer, and attendance effects for confirmation.
- *"Move everyone who's attended three Vision Meetings to Following Up"* → Evry identifies the qualifying people and shows the complete before-and-after set before confirmation.
- *"Who haven't I followed up with in the last two weeks?"* → Evry returns the application result directly because the request is a read.

**Communication and task work:**

- *"Send a thank-you email to everyone who came last night"* → Evry resolves attendance, drafts the email, and shows recipients and content before confirmation.
- *"What do I need to do before the meeting on Thursday?"* → Evry shows the meeting checklist and related tasks without a confirmation pause.
- *"Create follow-up tasks for everyone who attended last night, due in 48 hours"* → Evry shows every proposed task, assignee, and due date before confirmation.

### Reducing Clicks to Zero

The goal is to make common workflows require **zero navigation and zero form-filling** while keeping the same permissions and making every effect visible before it happens:


| Traditional flow | Evry flow |
|---|---|
| Navigate to Meetings → New → Complete form → Save → Communication → Select recipients → Write email → Send | *"Schedule a Vision Meeting next Thursday at 7 PM and invite all prospects"* → review one combined plan → confirm |
| Navigate to People → Add → Complete form → Save → Person → Add note → Save | *"Add Jane Doe, met her today, interested in kids ministry"* → review the record and note → confirm |
| People → Filter by stage → Select multiple → Bulk action → Change stage → Confirm | *"Move everyone who signed a commitment card to Core Group"* → review the exact people and prior stages → confirm |
| Tasks → Review each → Complete → Open next | *"Mark all prep tasks for last night's meeting complete"* → review the exact tasks → confirm |

### Boundary, Scope, and Interface

Evry covers operational work available to an authenticated account in a plant tenancy. Settings, coaching, oversight, sessionless flows, and pre-tenancy onboarding are outside its contract. It does not answer theology, prayer-guidance, pastoral-advice, or general-purpose questions; those requests produce a brief application-only message and no application access.

EveryField's standard interface remains available for direct, fine-grained work. Evry adds durable conversation history, visible page context, structured read results, focused clarification choices, dynamic confirmation artifacts, execution progress, and per-step receipts. A person can return days later and see the same messages, plan state, and outcomes without risking a replay.
