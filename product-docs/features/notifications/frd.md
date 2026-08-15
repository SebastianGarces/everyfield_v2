# F11: Notifications & Digest
## Feature Requirements Document (FRD)

**Version:** 1.0
**Date:** July 26, 2026
**Feature Code:** F11

> **This is shared infrastructure, not a user-facing feature in its own right.** Its value is that other
> features stop inventing their own delivery: task due/overdue alerts, meeting reminders, scheduled sending
> and team health checks all reach the user through this layer rather than through four private one-offs.
> Read the Integration Contracts section as the primary deliverable.

---

> **Tracked on the board:** F11 — open requirements are its sub-issues. Implementation status is not tracked in this file.

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services

---

## Overview

Notifications give the product a way to reach a user who is **not currently looking at it**. The target user
is a bivocational planter who opens the app a few times a week, not daily — so anything that only exists as
an on-screen badge is invisible to the person who most needs it.

The feature owns three things and deliberately nothing else:

| Concern | What the notification service owns |
|---------|---------------|
| **Enqueue** | One contract any feature calls to say "tell this user this thing, at this time". |
| **Preference** | Whether a given user wants a given *category* on a given *channel*. |
| **Dispatch** | Draining due notifications to email and to the in-app feed, once each, on a schedule. |

It does **not** own the content decisions of its callers. The service does not know what makes a task overdue or a
meeting imminent; the owning feature decides that and hands over a rendered notification. This is what keeps
the layer extensible rather than becoming a switch statement over every feature in the product.

### Channels

Two channels ship in v1, chosen because they cover the two distinct failure modes:

- **Email** — reaches a planter who is not in the app. Delivered through the same transactional email
  pipeline the Communication Hub owns; the notification service adds no second provider.
- **In-app** — a notification feed with unread state, for a user who *is* in the app and wants a record of
  what happened while they were away.

SMS and web push are explicitly Nice to Have (N-020, N-021). Adding a third channel must not require
touching callers — that is a design constraint, not an aspiration.

### Categories

Notifications are grouped into a **fixed, code-defined set of categories**. The category is the unit of user
preference, which is what keeps the preference surface comprehensible: a user chooses "no meeting reminders",
not "no reminder for the 3-day offset of a Vision Meeting".

| Category | Covers |
|----------|--------|
| `tasks` | Task due, overdue, and assignment |
| `meetings` | Meeting reminders and Core Group notification of a new meeting |
| `communication` | Scheduled sends and delivery problems on messages the user sent |
| `teams` | Ministry-team health and training alerts |
| `phase` | New Plant Intelligence assessment available, phase transitions |
| `digest` | The recurring roll-up (see N-013) |

Adding a category is a code change plus a migration-free default, not a schema change — preferences are
stored per `(user, category, channel)` and an unknown category falls back to its code-defined default.

---

## Access Prerequisites

- Requires an authenticated user. Notifications are addressed to a `user`, never to a bare email address —
  a `person` record with no login is not a notification recipient.
- All five roles can receive notifications: `planter`, `coach` and `team_member` at the church level,
  `sending_church_admin` and `network_admin` at the oversight level.
- Notifications are church-scoped. A user never receives a notification about a church they cannot read, and
  oversight-role notifications respect the same privacy gating as the oversight read paths.

### What oversight recipients receive

An oversight recipient (`sending_church_admin`, `network_admin`) receives exactly two things about a
plant, and never the granular per-category notifications that are meant for the plant's own team:

- **A daily activity digest**, scheduled by the recurring dispatcher (N-028) and sent only when there
  was activity — a quiet plant generates no contact.
- **Three milestone events**, delivered per event: the planter accepted the invitation, the
  phase/stage advanced, and the launch date was set or changed.

*Why a digest rather than categories:* an admin over twenty plants subscribed by category is twenty
event streams for one person. A once-a-day roll-up is the shape oversight can actually consume.

One plant-side toggle, `share_activity_with_oversight` (default **off**), gates all of it — with one
exception: **invitation-accepted is always sent**, because it is the sending organization's own
event; that organization issued the invitation and the acceptance answers it. The exemption relaxes
consent only: the recipient must still be able to read the church. Phase/stage and launch-date
milestones stay gated, because those are facts about the plant's own progress.

*Why this is its own toggle rather than being inferred from the per-feature sharing settings:* a
church that shares its task list has not thereby asked for a weekly email about itself to leave the
building. The toggle's copy states what is shared — a summary digest, not a detailed list of
everything that occurred — and names the invitation-accepted exception.

Oversight roles also have the in-app feed (N-027): a notification delivered to them always has an
in-app row they can see.

**A recipient who may not be told is skipped and reported, not thrown over.** Enqueue records nothing
for that recipient — the refusal is total, no row is ever written — and returns a per-recipient result
saying it was skipped and why. *Why:* the natural caller is a fan-out ("remind all six attendees"),
and a throw there aborts the loop mid-way, writing rows for the recipients before the barred one and
none for those after, with the exception surfacing in whatever feature action triggered the reminder.
A notification permission failure must never be able to fail a meeting.

---

## User-Visible Behavior

**As a planter who has not opened the app in four days,** I get one email that tells me what needs my
attention — not eleven emails, and not silence.

**As a planter who opens the app daily,** I see a notification feed with what changed, and my inbox stays
quiet because I already saw it.

**As any user,** I can turn off a whole category from a settings screen or from the footer of any email,
and that choice is honoured on the next send — not eventually.

**As a user whose meeting was cancelled,** I do not receive its reminder. A notification about something
that no longer exists is worse than no notification, because it teaches the user to distrust all of them.

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement |
|----|-------------|
| **N-001** | A single enqueue contract accepts (church, recipient user, category, type, rendered title/body, optional entity reference, optional scheduled time, optional dedupe key) and records a pending notification. |
| **N-002** | Enqueue is **never** a synchronous send. A caller returns as soon as the notification is recorded; delivery is the dispatcher's job. |
| **N-003** | A recurring dispatcher drains notifications whose scheduled time has passed, delivering to each channel the recipient has enabled for that category. |
| **N-004** | Delivery is **at-most-once per channel**. A dispatcher that runs twice, overlaps itself, or crashes mid-run does not double-send. |
| **N-005** | Per-category, per-channel preferences: a user can disable `tasks` email while keeping `tasks` in-app, and vice versa. Absent an explicit row, the category's code-defined default applies. A preference is honoured on **read** as well as on send (see Screen 1). |
| **N-006** | A preferences screen lets a user see and change every category/channel combination. |
| **N-007** | Every email carries a working unsubscribe link that disables that category's email channel for that user without requiring a login. |
| **N-008** | An in-app feed lists a user's notifications newest-first with unread state; the app shell shows an unread count. The list is **paged**, not capped (see Screen 1). |
| **N-009** | A user can mark one notification read, and mark all read. |
| **N-010** | Notifications are church-scoped: a query for a user's notifications can never return another church's rows. |
| **N-011** | A pending notification can be **cancelled by entity reference**, so a caller that deletes or reschedules the underlying thing does not send a stale notification. |
| **N-012** | Multiple pending notifications in the same category for the same recipient within a batching window collapse into **one** email listing them, rather than one email each. The in-app feed keeps them as separate rows. |
| **N-013** | A recurring digest summarises the recipient's open items for the period. Two owners decide different halves: **the recipient** sets whether they get one and how often, as a per-user preference within the `digest` category; **the church** sets the day and hour it lands, in church settings. The default is **Sunday 16:00 in the church's timezone** — after the gathering, facing the week the reader is about to act in. The hour is part of the requirement, not a detail: delivered at the period boundary in UTC, a Sunday digest arrives Saturday evening in the Americas. The weekday governs the weekly cadence; the hour governs both. |
| **N-014** | Nothing is sent for a subject that is in the past or already resolved at dispatch time — a task completed before its overdue notice fires produces no notice. |
| **N-015** | A failed delivery is retried with backoff up to a bounded attempt count, then recorded as failed with its error. A permanent failure (invalid address, hard bounce) is not retried. |
| **N-016** | Delivery outcome per channel is recorded — queued, sent, failed, cancelled, suppressed-by-preference — so "did it send?" is answerable without reading provider logs. |
| **N-017** | The dispatcher completes within the platform function timeout at expected beta volume, and a run that cannot finish leaves the remainder pending rather than dropping it. |
| **N-025** | Oversight recipients receive only a daily activity digest (sent only when there was activity) and milestone events — planter accepted invitation, phase/stage advanced, launch date set or changed. They are never enqueued granular per-event category notifications. |
| **N-026** | A single plant-side toggle ("Share activity with your sending church/network"), default **off**, gates everything oversight receives, with ONE exception: the invitation-accepted milestone is the sending church's own event and is emitted regardless. Its copy states that a summary digest is shared, not a detailed activity list, and names that exception. |
| **N-028** | The oversight digest is scheduled by the recurring notification dispatcher: each tick runs it for the last complete day, guarded so that exactly one digest per oversight recipient is produced per day however many times the tick fires, and none on a day with no activity. |
| **N-027** | Oversight roles have the in-app feed — bell, unread count, `/notifications`, mark-read. A notification delivered to an oversight user always has an in-app row they can see. |

### Should Have

| ID | Requirement |
|----|-------------|
| **N-018** | Quiet hours: a user-configurable window during which email is held rather than sent. Reads the church timezone that N-013's send hour establishes; a per-user zone would layer on top of it, and is not assumed here. |
| **N-019** | Role-aware preference defaults — a coach's sensible defaults differ from a planter's. |
| **N-020** | An admin-visible delivery log for support ("did this planter get their reminder?"). |

### Nice to Have (Future)

| ID | Requirement |
|----|-------------|
| **N-021** | SMS channel. |
| **N-022** | Web push / PWA notifications. |
| **N-023** | Per-notification snooze ("remind me tomorrow"). |
| **N-024** | Per-notification threading so a re-notified entity updates its own row rather than adding one. |

---

## Acceptance Criteria

Each criterion below is observable. Requirement issues on the board carry the same wording.

### Must Have

1. **Enqueue records without sending** — calling the enqueue contract creates a pending row and makes no
   provider call.
2. **Dispatcher delivers due, skips future** — given one notification scheduled in the past and one in the
   future, a dispatcher run delivers exactly the first.
3. **At-most-once** — running the dispatcher twice over the same due notification produces exactly one
   delivery per channel.
4. **Preference suppression is per channel** — a user with `tasks` email off and `tasks` in-app on receives
   the in-app row and no email, recorded as suppressed-by-preference rather than as a silent no-op.
5. **Unsubscribe works without a session** — following an email's unsubscribe link while logged out disables
   that category's email channel for that user only, and changes no other user's preferences.
6. **Cancellation by entity** — cancelling by entity reference leaves a pending notification undelivered; a
   dispatcher run after the cancellation sends nothing.
7. **Batching collapses email, not the feed** — twenty pending `tasks` notifications for one recipient in one
   window produce one email and twenty feed rows.
8. **Resolved subjects are not announced** — a task completed after enqueue but before dispatch produces no
   delivery.
9. **Tenancy** — a query for user A's notifications never returns a row belonging to another church, and a
   cross-church fetch by direct id is rejected.
10. **Unread count and mark-read** — the shell count decrements on mark-read and zeroes on mark-all-read.
11. **Bounded retry** — a transient failure is retried and eventually succeeds; a hard bounce is recorded
    failed without retry.
12. **Every control carries `cursor-pointer`** — project hard rule.
13. **Oversight sharing is the church's to grant, via one toggle** — with the toggle off, an oversight
    recipient is enqueued nothing except the invitation-accepted milestone; with it on, the digest and the
    three milestone events are enqueued. No granular category notification is ever written for an oversight
    recipient, either side of the toggle.
14. **A barred recipient costs only that recipient** — a fan-out with a non-permitted recipient in the middle
    records rows for every permitted recipient, including those after the barred one, writes none for the
    barred one, and reports the skip with its reason.
15. **The feed pages rather than stopping** — with more visible notifications than fit one page, the feed
    shows a page and a "Load more" control; using it appends the next older page, repeating no row and
    skipping none across the boundary, including where several rows share a timestamp. When the last page is
    reached the control is gone.
16. **The in-app preference governs the feed and the count** — a category disabled for the in-app channel
    contributes no feed rows and nothing to the shell count; re-enabling it restores both with unread state
    intact, and its delivery records are unchanged throughout.
17. **Oversight in-app parity** — an oversight user whose plant has the sharing toggle on sees their
    delivered notifications in the feed and can mark them read; `/notifications` renders for them rather
    than redirecting.

---

## Screens

### 1. Notification Feed

Reachable from the app shell's unread indicator.

- Newest-first list; unread rows visually distinct from read.
- Each row: category, title, body, relative timestamp, and a link to the referenced entity where one exists.
- Row click marks read and navigates to the entity.
- "Mark all read" action.
- **Paged, with a "Load more" control that appends older notifications.** The list never silently stops.
- **Only categories the user has left on for the in-app channel appear**, and the shell count matches the list.
- Empty state distinguishes *no notifications yet* from *all caught up*.
- Cold-start (a brand-new church with no activity) reads as intentional, not broken.

The feed is paged, never capped: there is no page count and no page number, the list simply grows
downwards from newest, and a user who has been away for a month can reach all of it. *Why:*
truncating at a fixed number leaves the shell count describing rows the list refuses to show, and no
click can ever clear them.

The in-app preference governs the read side as well as the send side. A user who turns `meetings` off
is talking about the meeting rows already in their feed, not only about the ones not yet enqueued, so
the rows, the shell's unread count, and the empty-state probe all honour the same allow-list, and
"mark all read" is bounded by it too — a hidden category keeps its unread state for the day the user
turns it back on. Absent a preference row, the category's coded default applies (N-005), which is why
`digest` is absent from the feed by default: an in-app digest row would duplicate the feed it
summarises.

Delivery records are untouched by any of this. A preference governs what a user is **shown**; the
delivery log is the record of what a channel **attempted**, and hiding a row does not retro-edit the
fact that an email went out (N-016).

### 2. Notification Preferences

Within account settings.

- A matrix of category × channel toggles, with each category's purpose stated in plain language.
- Digest cadence selector within the `digest` category.
- Quiet hours control (N-018, Should Have) once a timezone exists.
- Changes save without a page navigation and take effect on the next dispatch.

### 3. Unsubscribe Confirmation

A logged-out-safe page reached from an email footer.

- States exactly which category was disabled and for which address.
- Offers a one-click undo and a link to full preferences.
- Never exposes any other information about the account.

---

## Workflows

### Workflow 1: A feature enqueues a notification

1. The owning feature detects a condition it wants to announce (a task became overdue, a meeting is three
   days out, an assessment completed).
2. It renders the human-readable title and body itself — the notification service does not template feature content.
3. It calls the enqueue contract with the recipient, category, type, rendered content, an entity reference,
   a scheduled time, and a dedupe key.
4. The service checks the recipient may be told: they can read the church, and — for an oversight recipient — the
   notification is one oversight may receive and the church has turned sharing on (or the notification is
   the consent-exempt invitation-accepted milestone). A recipient who fails is **skipped**, and the call
   says so; nothing is recorded for them.
5. Otherwise the service records a pending notification per enabled channel and returns. No provider call happens
   here.
6. A caller fanning out to several recipients loops this contract and collects the results. One barred
   recipient costs only that recipient their notification; the rest are recorded normally, and the skips are
   visible in what the loop collected.

### Workflow 2: Scheduled dispatch

1. The recurring job selects notifications whose scheduled time has passed and whose status is pending,
   bounded to a batch size that fits the function timeout.
2. It claims each row so a concurrent or retried run cannot select it again.
3. For each recipient and category, it resolves preferences, groups the batch per N-012, and re-checks the
   subject is still live per N-014.
4. It delivers per channel and records the outcome per N-016.
5. Anything left unprocessed stays pending for the next tick — never dropped.

### Workflow 3: The subject changes before delivery

1. A user cancels or reschedules the underlying entity.
2. The owning feature calls cancel-by-entity (reschedule = cancel + re-enqueue).
3. Pending notifications for that entity move to cancelled and are never delivered.

### Workflow 4: A user opts out

1. From preferences, or from an email footer without logging in.
2. The preference is written per `(user, category, channel)`.
3. The next dispatch suppresses that channel and records it as suppressed-by-preference — visible in the
   delivery log rather than silently absent.

---

## Data Model

Entity shapes below are **feature-owned and canonical**. Field lists are behavioural, not a migration script.

### Notification

The queue row and the in-app feed row are the same record — one notification, whose delivery per channel is
tracked separately. This is deliberate: two tables would let the feed and the email disagree about what
happened.

| Field | Purpose |
|-------|---------|
| `id` | Primary key. |
| `churchId` | Tenancy boundary. Every query filters on it. |
| `recipientUserId` | Who it is for. A user, never a bare address. |
| `category` | One of the fixed category set. The unit of preference. |
| `type` | Caller-defined discriminator within a category (e.g. task-overdue vs task-assigned), for grouping and analytics. |
| `title` / `body` | Rendered by the caller. The service stores, does not template. |
| `entityType` / `entityId` | What it is about. Powers cancel-by-entity, the feed's link target, and the still-live re-check. |
| `dedupeKey` | Caller-supplied idempotency key. A second enqueue with the same key does not create a second notification. |
| `scheduledFor` | When it becomes eligible. Defaults to now. |
| `status` | pending / claimed / delivered / cancelled / failed. |
| `readAt` | Null until the recipient reads it in-app. Independent of delivery. |
| `createdAt` / `updatedAt` | Audit. |

### NotificationPreference

| Field | Purpose |
|-------|---------|
| `id` | Primary key. |
| `userId` | Owner. Preferences are per user, not per church — a coach across two churches has one set. |
| `category` | One of the fixed set. |
| `channel` | email / in_app. |
| `enabled` | The choice. |
| `digestCadence` | Only meaningful on the `digest` category. |

**Absence is meaningful:** no row means "the code-defined default for this category", not "off". This keeps a
new category working for every user from the moment it is added, with no backfill.

Uniqueness on `(userId, category, channel)`.

### NotificationDelivery

One row per channel attempt, so a retry history survives.

| Field | Purpose |
|-------|---------|
| `id` | Primary key. |
| `notificationId` | Parent. |
| `channel` | email / in_app. |
| `status` | queued / sent / failed / suppressed_by_preference / cancelled. |
| `attemptCount` | Bounded per N-015. |
| `error` | Provider error on failure. Populated only on failure. |
| `providerMessageId` | For correlating with provider webhooks. |
| `sentAt` | Null until sent. |

---

## Integration Contracts

**This section is the feature's primary deliverable.** A caller must be able to adopt the notification service without knowing how
dispatch works.

### Inbound (this feature consumes)

| From | Contract |
|------|----------|
| Any feature | `enqueue(churchId, recipientUserId, category, type, title, body, { entityType, entityId, scheduledFor, dedupeKey })` → records pending notification(s). Idempotent on `dedupeKey`. Returns a per-recipient outcome: **recorded** (with the row) or **skipped** (with the reason — no church access, or an oversight recipient whose plant has not turned sharing on, or a notification oversight never receives). A refused recipient is never an exception, so a fan-out completes for everyone else. |
| Any feature | `cancelByEntity(churchId, entityType, entityId, { category? })` → moves matching pending rows to cancelled. Safe to call when nothing is pending. |
| Any feature | An optional **still-live predicate** registered per `type`, which dispatch calls before delivering, satisfying N-014 without the service knowing any feature's domain rules. |
| Communication Hub | The transactional email provider integration. The notification service sends *through* it and adds no second provider. Provider delivery webhooks update `NotificationDelivery`. |
| Platform | The recurring job scheduler. One additional scheduled entry, following the same scheduler pattern as the Plant Intelligence daily job. |

### Outbound (this feature provides)

| To | Contract |
|----|----------|
| App shell | Unread notification count for the current user. |
| Task Management | Due/overdue/assignment delivery, replacing that feature's blocked requirement. |
| Meetings | Reminder-schedule and new-meeting delivery, replacing that feature's blocked requirement. |
| Ministry Teams | Team health and training alert delivery. |
| Plant Intelligence | New-assessment-available delivery. |

### Explicitly not provided

- **Marketing or bulk sending.** That is the Communication Hub's job. The notification service is transactional only, and the
  distinction matters for compliance and deliverability.
- **Content templating for callers.** Callers render their own copy.
- **Notifications to non-users.** A `person` with no login is reached through Communication Hub, not here.

---

## Non-Functional Requirements

| Area | Requirement |
|------|-------------|
| **Correctness** | At-most-once delivery per channel is the load-bearing guarantee. Duplicate sends are the failure that loses trust fastest, followed by stale sends about deleted things. |
| **Volume** | A dispatcher run must fit the platform function timeout at beta volume, with a bounded batch and safe resumption. Growth is absorbed by more frequent ticks, not longer runs. |
| **Restraint** | Batching (N-012) is a correctness requirement, not an optimisation. Twenty emails where one was wanted is indistinguishable from spam to the recipient. |
| **Tenancy** | Every read and write filters on `churchId`. Cross-church leakage through a notification body is a data breach. |
| **Compliance** | Every email carries functional unsubscribe. Transactional classification must be accurate — a digest of the user's own data is transactional; anything promotional is not and does not belong here. |
| **Observability** | Delivery outcome is queryable per notification. "Did this send, and if not why" must not require provider log access. |
| **Failure posture** | A dispatcher failure delays notifications; it must never lose them or double-send them on recovery. |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Blocked requirements unblocked | 4 (task alerts, meeting reminders, scheduled sending, team health checks) |
| Duplicate deliveries | Zero, measured over the beta window |
| Stale deliveries (subject cancelled or resolved) | Zero |
| Digest open rate | Establishes a baseline; the digest is the retention mechanism for planters not in the app daily |
| Category opt-out rate | Watched as a signal of over-sending — a high opt-out on one category means that category sends too much, not that users dislike notifications |
| Emails per recipient per day | Bounded and monitored; a rising number invalidates N-012 |

---

## Open Questions

1. **In-app retention.** How long a read notification stays in the feed before pruning. Unbounded growth is
   a real cost at cohort scale; no ruling needed for v1 correctness.
