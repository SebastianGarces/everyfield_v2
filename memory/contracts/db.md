# Database Contracts

ORM: Drizzle | DB: PostgreSQL (Neon serverless) | Connection: `src/db/index.ts`
Schema: `src/db/schema/*.ts`, one file per feature area — **read the schema files, they are
the contract.** Migrations: `src/db/migrations/` via `pnpm db:migrate` (never `db:push`).
The full table-by-table mirror this file used to hold is in git history.

Conventions (unless a schema file says otherwise): `id` uuid PK; `church_id` → churches is the
tenant scope; `created_at`/`updated_at` default now.

## Non-obvious column semantics

- **`churches.leadership_status`** (`church.ts`): `planter_confirmed` | `no_planter` | **null =
  never asked** — null is NOT "no planter", which is why it isn't a boolean. Read ONLY through
  `src/lib/onboarding/leadership.ts`. The planter *assignment* is `users.church_id` + role.
- **`church_id = null` means global content** (e.g. wiki articles visible to all tenants).
- **`sessions.id`** is the SHA-256 of the token, not the token.
- **Soft deletes:** `persons.deleted_at` — feature queries must filter it.
- **Notifications enqueue gate:** oversight recipients can ONLY receive `milestones` + `digest`
  categories, gated by `share_activity_with_oversight` read at enqueue time; a recipient who
  fails the gate is skipped and reported, never thrown over. Source: `src/lib/notifications/`
  and `product-docs/features/notifications/frd.md` (N-025/N-026).
- **Transactions:** `db.transaction()` throws on neon-http — see `../invariants.md` →
  Transactions/Atomicity before writing any multi-statement mutation.
