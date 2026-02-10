# Invariants

Stable truths that must not be violated.

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
- Per-feature privacy toggles in `church_privacy_settings` control what oversight users can see (default: all false / opt-in)
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
- Progress and bookmarks link by `article_slug`, not `article_id`
- MDX content compiled at request time via `next-mdx-remote/rsc`
- Full-text search: weighted tsvector (title A > excerpt B > content C)
- Cache revalidation requires `REVALIDATION_SECRET`

**Source:** `src/db/schema/wiki.ts`, `src/lib/wiki/search.ts`

## Request Deduplication

- `getCurrentSession()` uses `React.cache()` for per-request dedup
- Multiple calls in same request hit cache, not DB

**Source:** `src/lib/auth/session.ts:254`

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
