# Invariants

Stable truths that must not be violated.

## Transactions / Atomicity

- `drizzle-orm/neon-http` has **no interactive transactions** — `db.transaction()` throws at runtime. Never use it.
- Writes all known up front: pass them all to `db.batch([...])` — a Neon batched transaction, all-or-nothing.
- Writes interleaved with reads/events/another feature: nothing can span them. Write the durable "already happened" marker **last** and make every earlier step idempotent, so a failure is retryable rather than half-applied.
- **A SELECT-then-INSERT guard is not a concurrency guard.** Ordering + idempotency only make a *replay* safe; two concurrent requests both pass the SELECT. Where duplicates must be impossible, enforce it with a (partial) unique index and let the write fail — and keep the uniquely-indexed row in the SAME `INSERT` as the rows it speaks for, so the loser writes nothing at all.
- **`db.batch` is not a guard on its own: an empty `returning()` is not an error and rolls nothing back.** Inside a batch each statement sees the previous one's writes, so put the compare-and-set FIRST and condition the dependent write on the state it claimed. Reference: `acceptInvitationAs()` (`src/lib/invitations/core.ts`) batches the claim (`status = 'pending' → 'accepted'`) with the FK write, whose WHERE carries `EXISTS (… status = 'accepted')` — a lost claim writes nothing, and the plant is bound IFF the invitation reads accepted (`scripts/g3-oversight-model.ts` §3d races it). Every status write on that table compare-and-sets on `pending`, the auto-expire included.
- **A compare-and-set only serialises requests that write the SAME ROW. A predicate about a different table is a snapshot read, not a lock.** So two requests updating two different rows contend on nothing, however carefully each one's `EXISTS (…)` is written: both subqueries were true when evaluated, both writes commit, and under READ COMMITTED the dependent statement of whichever ran second silently matches nothing. When the thing being competed for is a row in another table, LOCK it — `SELECT … WHERE id = ? FOR UPDATE` as the FIRST statement of the batch — and gate the outcome on the dependent write's own rowcount, not the claim's. Reference: `acceptInvitationAs()` again (#265, r3): two accepts of two DIFFERENT invitations for one free oversight slot both committed `accepted` until `lockTargetRow` was put in front of them (`scripts/g3-oversight-model.ts` §3d case H, 10 runs).
- Reference: `finalizeAttendance()` emits downstream first, then compare-and-sets `church_meetings.actual_attendance` (written only there; non-null = already finalized = its idempotency key), so a meeting is never finalized without its follow-up tasks. `meeting.attendance.finalized` is the one event emitted **strictly** — handler failures reach the emitter instead of being swallowed. Duplicate follow-up sets are blocked by `tasks_meeting_evaluation_unique_idx` (one live evaluation task per meeting).
- Residual, accepted: `meeting.attendance.recorded` is emitted non-strictly, so a failed prospect → attendee auto-advance is logged and swallowed while the meeting still finalizes. Deliberate — a status nudge must not block finalization — and self-healing on the next status change.

**Source:** `src/db/index.ts`, `src/db/schema/tasks.ts`, `src/lib/meetings/service.ts`, `src/lib/tasks/events.ts`, `src/lib/events/event-bus.ts`

## Multi-Tenancy

- All feature data includes `church_id` for tenant isolation
- `church_id = null` means global content (e.g., wiki articles visible to all)
- Tenant isolation enforced at application layer (DB-layer RLS is a future goal)
- Hierarchical model: SendingNetwork → SendingChurch → Church (all relationships optional/nullable)
- All hierarchy FKs (`sending_church_id`, `sending_network_id`) are nullable — entities can exist independently
- **An accept never replaces an association** (#265, ruled 2026-08-03). Nothing stops a second sending church or network inviting a plant that already belongs to one — `createInvitation` checks no membership — and the plant's own planter has authority over that invitation too, so accepting it used to set the FK to the newcomer and sever the incumbent silently: no type-to-confirm, no notification, no `association_events` row (the three things #274/OV-007 requires of a sever), with the incumbent's invitation still reading `accepted` and its acceptance milestone already sent. Both statements of the accept batch now carry `fk IS NULL OR fk = <this org>` — the guard is on the CLAIM, so a refused accept leaves the invitation `pending` and writes nothing at all rather than committing an acceptance with no association behind it — and the refusal is `ALREADY_ASSOCIATED_MESSAGE`, distinct from the "no longer pending" a lost claim gets. **That predicate is a subquery on another table, so it holds against a SEQUENTIAL second accept and, on its own, held against nothing else**: two accepts of two different invitations for one free slot update two different rows, so both used to commit `accepted` while only one association was written (reproduced 6/10 runs; #265 r3). The claim's slot guard is a concurrency guard only because `lockTargetRow` — `SELECT … FOR UPDATE` on the row the association writes — is statement ONE of the same batch, and success plus the milestone are gated on the association's own rowcount. Re-binding the SAME org stays an idempotent no-op (the replay path depends on it). A plant leaves one org for another by severing first (#277/#278) and then accepting. Covered by `service.test.ts` (the slot rule and the lock read off the generated SQL) and `scripts/g3-oversight-model.ts` §3d cases G (sequential) and H (concurrent, 10 runs) — `assertConsistent` alone cannot see either, since it only ever inspects ONE invitation and two accepted invitations for one slot satisfy "bound IFF accepted" vacuously
- Associations are created via the invitation system, and **as of #265 there is still no way to remove one in-product** — treat "an accepted oversight association can only be replaced by severing it first, and severing has no entrypoint yet" as the current truth. The FKs are nullable and the primitives exist (`disassociate*` in `src/lib/invitations/core.ts`) but have no action wrapper, route or UI: they were three of the eleven unauthenticated `"use server"` exports #265 removed, each of which detached any church from its oversight org for anyone who could guess a uuid. They stay unexposed and are **not** dead code — RULED 2026-08-03 (**#274**, FRD `product-docs/features/oversight/frd.md` OV-007/OV-010): **both sides may sever** (the plant's planter, or the org's admin), each type-to-confirm, each notifying the other side, each writing an `association_events` row. The wrappers ship with **#277** (planter) and **#278** (org), never as a re-export from a `"use server"` module
- **That missing sever is a privacy fact, not a missing button.** `getOversightPlantHealth()` exposes an associated plant's name, phase, launch countdown and health with **no privacy gate** (see Hierarchical Access Control below; the portfolio listing is deliberately not gated), so until #277 a plant that accepts once cannot withdraw that exposure. Severing is what closes it; a new `share_*` toggle is not

**Source:** `src/db/schema/*.ts`, `src/lib/invitations/core.ts`, `product-docs/system-architecture.md`

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
- **Every export of a `"use server"` module is a POSTable endpoint — reachable with no session and no UI.** So the export list of such a module IS its auth surface: putting a helper, a read, or a "we'll wire this up later" write there publishes it. Keep logic in a sibling module with no directive and let the `"use server"` file hold only the actions.
- **A state-changing action never takes its actor as an argument.** It mints one from `verifySession()` (which throws `Unauthorized`), so there is no parameter a forged request can name someone else in. Where the entity is implied by the actor (their own plant, their own org), that is not an argument either. Reference: `src/lib/invitations/service.ts` + `core.ts` (#265 — `acceptInvitation(id, respondingUser)` used to trust the caller), `src/app/(dashboard)/settings/sharing/actions.ts`, `preferenceOwnerFromSession` in `src/lib/notifications/preferences.ts`. Branding the actor/owner type so only the mint can produce one makes it a compile error rather than a review note.

- **A shared secret is never compared with `===`.** Both cron routes call `matchesBearerSecret` from `src/lib/security/constant-time.ts` — `===` short-circuits on the first differing byte (a timing oracle), and a plain `if (a.length !== b.length)` guard in front of `timingSafeEqual` only relocates the leak onto the secret's length, so both sides are SHA-256'd to a fixed 32 bytes first. One `CRON_SECRET` authorises BOTH `/api/notifications/dispatch` and `/api/phase-engine/assess` (`contracts/config.md`), which is why the comparison is shared rather than copied: hardening one route while the other keeps `===` leaks the key to both (#266, ruled 2026-08-04). Enforced by `src/lib/security/constant-time.test.ts`, which scans every route reading `CRON_SECRET`. Still open: `src/app/api/wiki/revalidate/route.ts` compares `REVALIDATION_SECRET` with `!==`.

**Source:** `src/lib/auth/session.ts`, `src/lib/auth/cookies.ts`, `src/lib/invitations/service.test.ts`, `src/lib/security/constant-time.ts`

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
