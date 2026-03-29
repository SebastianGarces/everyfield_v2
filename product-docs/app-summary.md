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

- **Planters** see the full toolset: Dashboard, Wiki, People & CRM, Meetings, Tasks, Communication, Ministry Teams, and more.
- **Sending Church Admins** see a portfolio view of their church plants, invitations, and settings.
- **Network Admins** see a network-wide overview of sending churches and church plants with aggregate metrics.

### Core Features (Built)

**People & CRM** — A Kanban-style pipeline that tracks every person from initial contact through committed team member. Statuses flow through: Prospect → Attendee → Following Up → Interviewed → Core Group → Launch Team → Leader. The CRM includes household grouping, tagging, skills inventory, 4 C's assessments (Committed, Compelled, Contagious, Courageous), 5-criteria interviews (Maturity, Gifted, Chemistry, Right Reasons, Season of Life), commitment tracking, activity timelines, notes, and CSV import with duplicate detection.

**Meetings** — Full lifecycle management for Vision Meetings (the primary outreach tool where the planter casts vision to grow the core group), Orientations, and Team Meetings. Includes meeting creation, location management, invitation tracking (who invited whom), RSVP via email with token-based confirmation buttons, attendance recording (first-time vs. returning vs. core group), preparation checklists, post-meeting evaluations with scoring (attendance, location, logistics, agenda, vibe, message, close, next steps), and attendee notes.

**Tasks** — Task management with statuses (not started, in progress, blocked, complete), priorities (low through urgent), due dates, assignment, categories (vision meeting, follow-up, training, facilities, promotion, administrative, ministry team, launch prep, recurring, general), parent/sub-task relationships, recurring task support, and event-driven auto-completion.

**Wiki / Knowledge Base** — A curated, structured knowledge base that guides planters through six phases of the church planting journey: Phase 0 (Discovery), Phase 1 (Core Group Development), Phase 2 (Launch Team Formation), Phase 3 (Training & Preparation), Phase 4 (Pre-Launch), Phase 5 (Launch Sunday), Phase 6 (Post-Launch). Articles cover frameworks like the 4 C's, 8 Critical Success Factors, the Ministry Funnel, the 4 Pillars, Meeting Objectives (Inspire, Instill, Inform), and the 5 Interview Criteria. Includes full-text search, reading progress tracking, bookmarks, and support for network/church-specific content.

**Communication Hub** — Email and SMS messaging with reusable templates (meeting invitations, reminders, follow-ups, core group communications, team updates, announcements, launch communications). Per-recipient delivery tracking (sent, delivered, opened, clicked, bounced). Meeting-linked communications with RSVP confirmation tokens. Powered by Resend for email delivery.

**Dashboard** — Aggregated metrics (core group size, total people, overdue tasks, vision meetings held) and a cross-feature activity feed showing recent contact additions, status changes, commitments, completed meetings, and completed tasks.

**Ministry Teams** — Team organization and management for the 8-10 ministry teams a church plant needs to staff before launch (worship, tech, hospitality, children's ministry, etc.).

**Feedback** — In-app feedback collection (bugs, suggestions, questions) with status tracking.

### Planned Features (Not Yet Built)

- **Documents & Templates** — Ready-to-use templates for commitment documents, vision meeting materials, budget worksheets, team checklists, and letter templates.
- **Financial Tracking** — Budget monitoring and aggregate giving metrics (no individual contribution tracking — integrates with third-party giving platforms).
- **Facility Management** — Venue search, evaluation, and relationship tracking for finding a launch location.
- **Progress Dashboard (Enhanced)** — Visual representation of the 8 Critical Success Factors, phase progression, and health indicators.

---

## How AI Could Transform the Experience

The biggest opportunity with EveryField is reducing the operational burden on the planter. Church planters are typically not administrators — they're pastors, visionaries, and relationship builders. Every minute spent clicking through forms, writing follow-up emails, or hunting for the right wiki article is a minute not spent casting vision or meeting with people.

### Chat-First Interface

A conversational AI interface (sidebar or full-screen) could become the primary way planters interact with the platform. Instead of navigating menus and filling forms, the planter simply says what they need:

**Meeting management via tool calls:**
- *"Schedule a vision meeting for next Thursday at 7pm at the Johnson's house"* → AI creates the meeting, sets the location, auto-generates a preparation checklist.
- *"Invite everyone who attended the last vision meeting plus the 5 new prospects I added this week"* → AI queries the CRM, composes invitations, and sends them.
- *"Send a reminder to everyone who hasn't RSVP'd to Thursday's meeting"* → AI filters unconfirmed attendees and sends reminder emails.

**People management via tool calls:**
- *"Add John and Sarah Miller — they came to the vision meeting last night, got their info from Mike Davis"* → AI creates both person records, links them as a household, sets source to vision_meeting, records Mike as the referrer, and marks them as attendees.
- *"Move everyone who's attended 3+ vision meetings to Following Up status"* → AI queries attendance, identifies qualifying people, and batch-updates their pipeline status.
- *"Who haven't I followed up with in the last 2 weeks?"* → AI queries activity history and surfaces stale contacts.

**Communication via tool calls:**
- *"Send a thank-you email to everyone who came last night"* → AI pulls the attendance list, drafts an email using the follow-up template, and sends it.
- *"Draft a mass invitation for our next vision meeting and send it to all prospects and attendees"* → AI composes the email with meeting details, selects the right recipient segments, and queues it.
- *"Text the core group that we're moving the meeting to Wednesday"* → AI sends an SMS blast to all core group members.

**Task management via tool calls:**
- *"What do I need to do before the meeting on Thursday?"* → AI shows the meeting's checklist plus any related tasks.
- *"Create follow-up tasks for everyone who attended last night — due in 48 hours"* → AI batch-creates personalized follow-up tasks linked to each attendee.

### RAG-Powered Wiki & Coaching

The wiki content (phases, frameworks, best practices from the Launch Playbook) is a perfect candidate for Retrieval-Augmented Generation:

- **Contextual coaching:** When a planter asks *"How do I handle someone who wants to join the core group but fails the chemistry interview?"*, the AI retrieves relevant wiki content about the 5 Interview Criteria and the process for handling a "not qualified" result, then synthesizes a practical, personalized answer.
- **Phase-aware guidance:** The AI knows what phase the planter is in (stored in the church record) and proactively surfaces relevant articles, frameworks, and checklists. *"You're in Phase 1 with 30 core group members. Here are the 3 things the Launch Playbook says to focus on right now."*
- **Methodology Q&A:** *"What are the 8 Critical Success Factors and how am I doing on each?"* → AI retrieves the framework definitions via RAG, then queries the planter's actual data to score them against each factor.
- **Template generation:** *"Help me write a vision meeting talk for next week"* → AI uses RAG to pull the Meeting Objectives framework (Inspire, Instill, Inform) and relevant content from the Launch Playbook, then generates a talk outline tailored to the planter's current phase and goals.

### Reducing Clicks to Zero

The overarching goal is to make the planter's most common workflows require **zero navigation and zero form-filling**. The AI layer sits between the planter and the database, turning natural language intent into structured actions:

| Traditional Flow | AI-Assisted Flow |
|---|---|
| Navigate to Meetings → Click New → Fill form → Save → Navigate to Communication → Select recipients → Write email → Send | *"Schedule a vision meeting next Thursday at 7pm and invite all prospects"* |
| Navigate to People → Click Add → Fill form → Save → Navigate to Person → Add Note → Save | *"Add Jane Doe, met her at church today, she's interested in kids ministry"* |
| Navigate to People → Filter by status → Select multiple → Bulk action → Change status → Confirm | *"Move everyone who signed a commitment card to Core Group"* |
| Navigate to Tasks → Review each → Check off → Navigate to next | *"Mark all the prep tasks for last night's meeting as done"* |

### Network & Sending Church Intelligence

For oversight users (sending networks and sending churches), AI can provide:

- **Portfolio health summaries:** *"Which of my planters are at risk?"* → AI analyzes activity recency, core group growth velocity, meeting frequency, and task completion rates across all plants.
- **Comparative analytics:** *"How is Pastor Mike doing compared to other planters at the same phase?"* → AI benchmarks against network-wide averages.
- **Coaching recommendations:** *"What should I focus on in my next call with Pastor Mike?"* → AI identifies areas where the planter is lagging and retrieves relevant coaching content.

### Implementation Approach

The AI features would be implemented as a **tool-calling architecture** where:

1. The chat interface accepts natural language input from the planter.
2. An LLM (Claude) interprets the intent and selects from a set of defined tools (create_meeting, add_person, send_email, query_people, update_status, create_task, search_wiki, etc.).
3. Each tool maps to existing service functions in the codebase — the same business logic that powers the traditional UI.
4. RAG for the wiki uses vector embeddings of wiki articles stored alongside the existing full-text search index, enabling semantic retrieval of relevant content.
5. The AI maintains conversation context so planters can have multi-turn interactions: *"Add her to Thursday's meeting too"* (referring to the person just created).

This approach means the AI layer is additive — the traditional UI continues to work for users who prefer it or need fine-grained control, while the chat interface dramatically accelerates the most common workflows.
