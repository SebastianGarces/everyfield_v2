# Invariants

Stable truths that must not be violated.

## Multi-Tenancy

- All feature data includes `church_id` for tenant isolation
- `church_id = null` means global content (e.g., wiki articles visible to all)
- Row-level security enforced at DB layer via `church_id`

**Source:** `src/db/schema/*.ts`, `product-docs/system-architecture.md`

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

- Roles: `planter`, `coach`, `team_member`, `network_admin`
- Planter: full CRUD on own church
- Coach: read access to assigned planters
- Team member: feature-limited within church
- Network admin: network-wide read + analytics

**Source:** `src/db/schema/user.ts`, `product-docs/system-architecture.md`

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
