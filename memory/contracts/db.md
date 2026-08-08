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
- **`churches` has NO `launch_date` column** — migration 0032 dropped it (LS-001, ruled on #285:
  deliberately not expand-only, landed with every reader in one slice). Launch Sunday is an entity:
  `launches`, at most one row per church, and it is the only owner of the day. Read it with
  `getLaunchForChurch` / `getLaunchDatesForChurches` (`src/lib/launch/queries.ts` — the second
  exists so the oversight portfolio listing stays one query); write it ONLY through
  `setLaunchDate` (`src/lib/launch/service.ts`), which journals the change and fires the existing
  `launch_date_changed` oversight milestone. Nothing under `src/lib/launch/` carries `"use server"`.
  - `launches.target_date` is nullable **only** while `status = 'planning'` — the
    `launches_target_date_check` CHECK makes "scheduled with no day" unrepresentable, so no
    countdown reader has to defend against it. Statuses are `planning | scheduled | completed |
    postponed`, closed by CHECK; `postponed` is NOT terminal (it carries a new date).
  - **One live launch per church is the `launches_church_id_unique` index, not a check in the
    service.** Two concurrent first schedules both pass any SELECT-then-INSERT
    (`../invariants.md` → Atomicity); the insert carries `ON CONFLICT (church_id) DO NOTHING` and
    the loser writes nothing at all, journal included.
  - The write is ONE statement, not a `db.batch`: a `WITH` chain that locks the row
    (`SELECT … FOR UPDATE`), inserts-or-compare-and-sets, and inserts the journal row from what
    was actually written. A batch cannot do it — the journal needs the OLD values (which the
    update destroys) and, on the create path, an id that does not exist until the insert runs.
  - **`launch_events` is APPEND-ONLY, on the same terms as `association_events`:** one writer,
    INSERT only, no `updated_at`, no soft-delete column, and no database rule enforcing it.
    `previous_target_date` null = the first commitment, a fact rather than a gap. `moved` vs
    `postponed` is LS-009's distinction and is chosen by the CALLER's intent, not derived.
  - `launch_milestone_tasks` is a join table rather than a column on `tasks`, so the task system
    carries no launch-shaped column.
  - **Cleanup order trap:** `launches.church_id` and `launch_events.actor_user_id` do NOT cascade,
    so any script deleting churches or users must delete `launches` first (milestones, milestone
    links and the journal all cascade from it). **`tasks` must go before `users` too, and this is
    the one that actually bit:** scheduling a launch seeds 23 `launch_prep` tasks, the
    `launch_milestone_tasks` link cascades but the TASK does not, and `tasks.created_by_id` →
    `users.id` then refuses the users delete (`tasks_created_by_id_users_id_fk`) — `pnpm db:seed`
    failed on any database where /launch had ever been used until `seed-dev-db.ts` deleted tasks
    between launches and users. The order is sessions → launches → tasks → users → churches.
- **`church_id = null` means global content** (e.g. wiki articles visible to all tenants).
- **`sessions.id`** is the SHA-256 of the token, not the token.
- **Soft deletes:** `persons.deleted_at` — feature queries must filter it.
- **Notifications enqueue gate:** oversight recipients can ONLY receive `milestones` + `digest`
  categories, gated by `share_activity_with_oversight` read at enqueue time; a recipient who
  fails the gate is skipped and reported, never thrown over. Source: `src/lib/notifications/`
  and `product-docs/features/notifications/frd.md` (N-025/N-026).
- **`organization_invitations` with BOTH target FKs null is a legitimate OPEN invitation**, not a
  broken row: the invitee had no account when the admin typed `invitee_email`, so there was
  nothing to point at. The target is filled in at registration by `bindOpenInvitationTarget`
  (`src/lib/invitations/core.ts`), whose compare-and-set is also what makes an invite link
  single-use. `invitee_email` null means the row predates #23 and matches nobody. Full rule:
  `../invariants.md` → Multi-Tenancy.
- **`association_events` is APPEND-ONLY, and only the code says so** (OV-008, #303, migration
  0031). One writer — `src/lib/invitations/audit.ts` — and it only ever INSERTs; the table has
  no `updated_at` and no soft-delete column, so there is no shape an edit could be recorded in.
  There is deliberately NO database rule/trigger blocking UPDATE/DELETE: that would make it
  structural but has to be decided alongside a retention story, so today it is a convention the
  schema makes awkward to break rather than one Postgres enforces. `audit.test.ts` pins both
  halves.
  - `church_id` is NOT NULL here, unlike most tables — the row's subject is a PLANT. It does not
    record a sending church joining a network (that association has no plant), because a null
    `church_id` already means "global content" one bullet up and an audit row must never read as
    global.
  - `org_type` + `org_id` is a discriminated pair with **no FK on `org_id`**: it points at
    `sending_churches` or `sending_networks` depending on `org_type`, and an audit row has to
    outlive its referent anyway. The CHECK on `org_type` is the integrity it gets.
  - `source_invitation_id` **null is a fact, not a gap**: a sever (#277/#278) answers no
    invitation, and an association may predate the invitation system.
  - The actor is a session-minted `InvitationActor`, never a uuid parameter — same rule as the
    invitation actions (`../invariants.md` → Authentication). And `audit.ts` carries no
    `"use server"` directive, for the same reason `src/lib/invitations/core.ts` does not.
  - Batch the audit row with the write it audits (`associationEventStatement` builds the INSERT
    without running it). A second round trip is the half-applied shape the atomicity invariant
    warns about.
- **Transactions:** `db.transaction()` throws on neon-http — see `../invariants.md` →
  Transactions/Atomicity before writing any multi-statement mutation.
