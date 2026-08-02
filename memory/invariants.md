# Invariants

Stable truths that must not be violated.

## Transactions / Atomicity

- `drizzle-orm/neon-http` has **no interactive transactions** — `db.transaction()` throws at runtime. Never use it.
- Writes all known up front: pass them all to `db.batch([...])` — a Neon batched transaction, all-or-nothing.
- Writes interleaved with reads/events/another feature: nothing can span them. Write the durable "already happened" marker **last** and make every earlier step idempotent, so a failure is retryable rather than half-applied.
- **A SELECT-then-INSERT guard is not a concurrency guard.** Ordering + idempotency only make a *replay* safe; two concurrent requests both pass the SELECT. Where duplicates must be impossible, enforce it with a (partial) unique index and let the write fail — and keep the uniquely-indexed row in the SAME `INSERT` as the rows it speaks for, so the loser writes nothing at all.
- Reference: `finalizeAttendance()` emits downstream first, then compare-and-sets `church_meetings.actual_attendance` (written only there; non-null = already finalized = its idempotency key), so a meeting is never finalized without its follow-up tasks. `meeting.attendance.finalized` is the one event emitted **strictly** — handler failures reach the emitter instead of being swallowed. Duplicate follow-up sets are blocked by `tasks_meeting_evaluation_unique_idx` (one live evaluation task per meeting).
- Residual, accepted: `meeting.attendance.recorded` is emitted non-strictly, so a failed prospect → attendee auto-advance is logged and swallowed while the meeting still finalizes. Deliberate — a status nudge must not block finalization — and self-healing on the next status change.

**Source:** `src/db/index.ts`, `src/db/schema/tasks.ts`, `src/lib/meetings/service.ts`, `src/lib/tasks/events.ts`, `src/lib/events/event-bus.ts`

## Multi-Tenancy

- All feature data includes `church_id` for tenant isolation
- `church_id = null` means global content (e.g., wiki articles visible to all)
- Tenant isolation enforced at application layer (DB-layer RLS is a future goal)
- Hierarchical model: SendingNetwork → SendingChurch → Church (all relationships optional/nullable)
- All hierarchy FKs (`sending_church_id`, `sending_network_id`) are nullable — entities can exist independently
- Associations are mutable: created via invitation system, can be added/removed at any time

**Source:** `src/db/schema/*.ts`, `product-docs/system-architecture.md`

## Hierarchical Access Control

- Coach: accesses multiple churches via `coach_assignments` table
- Sending Church Admin: accesses churches where `churches.sending_church_id = user.sending_church_id`
- Network Admin: accesses churches where `churches.sending_network_id = user.sending_network_id`
- Oversight users (sending_church_admin, network_admin) see **aggregate metrics only** — no individual person records
- Per-feature privacy toggles in `church_privacy_settings` control what oversight users may **pull** (dashboard reads): `share_people`/`share_meetings`/`share_tasks`/`share_financials`/`share_ministry_teams`/`share_facilities`, default all false / opt-in
- What is **pushed** to oversight is a separate and much narrower question, ruled 2026-07-27 (FRD N-025/N-026, #224): an oversight recipient receives ONLY a daily activity digest (counts, and only on a day with activity) and three milestone events (invitation accepted, phase/stage advanced, launch date set/changed). They are NEVER enqueued a granular per-event category — `enqueue` refuses `tasks`/`meetings`/`communication`/`teams`/`phase` for them unconditionally, sharing on or off (`OVERSIGHT_ELIGIBLE_CATEGORIES` = `milestones` + `digest`). One plant-side toggle, `share_activity_with_oversight` (0029, default false for everyone; it replaced 0026's `share_phase`/`share_digest`), gates both. Read at enqueue time, so a flip takes effect at the next enqueue. A recipient who fails the gate is skipped and reported, never thrown over — see `memory/contracts/db.md` → Notifications
- **`share_activity_with_oversight` gates PUSH only, and the consent copy may not claim more.** `getOversightPlantHealth()` (`src/lib/phase-engine/oversight/read.ts`, route `/oversight/health`) returns every accessible plant's name, `currentPhase`, `daysUntilLaunch` and health classification with NO privacy gate — that portfolio listing is what the oversight dashboard is for, and the six `share_*` columns gate the feature data inside it, not the listing. So "they see nothing unless you turn sharing on" is false; `OVERSIGHT_SHARING_TOGGLE.detail` (`notifications/categories.ts`) says so in a bullet and `oversight.test.ts` pins it. Changing either the exposure or the copy means changing both
- Use `getAccessibleChurchIds(user)` to resolve which churches a user can access
- Use `canAccessFeatureData(user, churchId, feature)` before returning data to oversight users

**Source:** `src/lib/auth/access.ts`, `src/db/schema/church-privacy-settings.ts`

## Authentication

- Session-based auth (NOT JWT) for immediate revocability
- Sessions stored in `sessions` table with hashed token as ID
- Cookie name: `session` (httpOnly, secure in prod, sameSite=lax)
- Session expiry: 30 days with 15-day sliding window refresh
- Fresh session: 10 minutes after login (for sensitive ops)

**Source:** `src/lib/auth/session.ts`, `src/lib/auth/cookies.ts`

## Password Security

- Hashing: Argon2id with OWASP parameters
- Memory: 19456 KiB, Time: 2, Parallelism: 1, Output: 32 bytes

**Source:** `src/lib/auth/password.ts`

## User Roles

- Roles: `planter`, `coach`, `team_member`, `sending_church_admin`, `network_admin`
- Planter: full CRUD on own church
- Coach: read access to assigned planters (via `coach_assignments`)
- Team member: feature-limited within church
- Sending church admin: aggregate metrics for churches with matching `sending_church_id` (subject to privacy toggles)
- Network admin: aggregate metrics for churches with matching `sending_network_id` (subject to privacy toggles)

**Source:** `src/db/schema/user.ts`, `src/lib/auth/access.ts`, `product-docs/system-architecture.md`

## Wiki Articles

- Slug-based routing (not ID-based)
- **Never interpolate a slug into a wiki path** (`` `/wiki/${slug}` ``). Slugs are authored content: a space, `#`, `?` or `%` truncates or breaks the href. Build every wiki path — href, `router.push`, OpenGraph `url`, `revalidatePath` — with `wikiHref()` from `src/lib/wiki/href.ts`. It encodes **per segment**, so `/` stays a separator for the `[...slug]` catch-all and safe slugs are byte-identical.
- Progress and bookmarks link by `article_slug`, not `article_id`
- MDX content compiled at request time via `next-mdx-remote/rsc`
- Full-text search: weighted tsvector (title A > excerpt B > content C)
- Cache revalidation requires `REVALIDATION_SECRET`

**Source:** `src/db/schema/wiki.ts`, `src/lib/wiki/href.ts`, `src/lib/wiki/search.ts`

## Request Deduplication

- `getCurrentSession()` uses `React.cache()` for per-request dedup
- Multiple calls in same request hit cache, not DB

**Source:** `src/lib/auth/session.ts` (`getCurrentSession`)

## Date & Time Rendering

- **Never format a `Date` without a pinned `timeZone`.** `Intl`/`toLocale*`/date-fns follow the *runtime's* zone — UTC on the server, the visitor's in the browser — so SSR markup and hydrated markup differ (React #418) and a server-only sibling disagrees forever. Format through `src/lib/datetime.ts`, pinned to `APP_TIME_ZONE` (UTC).
- **A meeting's `datetime` is a wall clock, not a zoned instant.** `datetime-local` submits a naive string; `parseDateTimeLocalValue()` reads it as `APP_TIME_ZONE` so the stored instant does not follow the server's `TZ`, `toDateTimeLocalValue()` inverts it. Use `meetingDatetimeSchema`, never `z.coerce.date()`.
- No per-user/per-church timezone column exists. Adding one means changing `APP_TIME_ZONE` and back-filling, not re-introducing runtime-local formatting.

**Source:** `src/lib/datetime.ts`, `src/lib/validations/meetings.ts`

## Client/Server Data Synchronization

- **NEVER store server data in useState** - This is an anti-pattern that leads to stale data
- **NEVER use useEffect for data sync** - useEffect is for side effects only (subscriptions, DOM, external systems)
- **Use useOptimistic for instant UI feedback** - React's built-in hook for optimistic updates
- **Server actions call refresh() from next/cache** - Not client calling router.refresh()
- Server data flows through props from server components to client components

**Patterns:**
- useOptimistic: Instant UI updates, server reconciles via refresh() (e.g., `ActivityTimelineClient`)
- Props-only: No local state, use props directly (e.g., `TagPicker`)
- Legitimate client state: UI state, pagination cursors, drag-and-drop (e.g., `PipelineView`)

**Source:** `memory/contracts/data-patterns.md`
