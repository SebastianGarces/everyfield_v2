# Database Contracts

ORM: Drizzle | DB: PostgreSQL (Neon serverless) | Connection: `src/db/index.ts`
Schema: `src/db/schema/*.ts`, one file per feature area — **read the schema files, they are the
contract.** Migrations: `src/db/migrations/` via `pnpm db:migrate` (never `db:push`).

Conventions (unless a schema file says otherwise): `id` uuid PK; `church_id` → churches is the
tenant scope; `created_at`/`updated_at` default now.

## Non-obvious column semantics

- **`churches.leadership_status`** (`church.ts`): `planter_confirmed` | `no_planter` | **null =
  never asked** — null is NOT "no planter", which is why it is not a boolean. Read it only
  through `src/lib/onboarding/leadership.ts`; the planter _assignment_ is `users.church_id` +
  role.
- **`churches` has NO `launch_date` column.** Launch Sunday is the `launches` entity, at most one
  row per church. Read with `getLaunchForChurch` / `getLaunchDatesForChurches`
  (`src/lib/launch/queries.ts`); write ONLY through `setLaunchDate`
  (`src/lib/launch/service.ts`), which journals the change and fires `launch_date_changed`.
  Nothing under `src/lib/launch/` carries `"use server"`.
  - `launches.target_date` is nullable **only** while `status = 'planning'`;
    `launches_target_date_check` makes "scheduled with no day" unrepresentable, so countdown
    readers never defend against it. `planning | scheduled | completed | postponed` is
    CHECK-closed; `postponed` is NOT terminal, it carries a new date.
  - **One live launch per church is the `launches_church_id_unique` index, not a service check**,
    because two concurrent first schedules both pass a SELECT-then-INSERT. The insert carries
    `ON CONFLICT (church_id) DO NOTHING`, and the loser writes nothing at all, journal included.
  - The write is ONE statement, not a `db.batch`: a `WITH` chain that locks the row
    (`SELECT … FOR UPDATE`), inserts-or-compare-and-sets, then journals from what was written.
    The journal needs the OLD values the update destroys, and an id the insert has yet to mint.
  - **`launch_events` is APPEND-ONLY** on the same terms as `association_events` below.
    `previous_target_date` null = the first commitment, a fact rather than a gap; `moved` vs
    `postponed` follows the CALLER's intent. Milestone links live in `launch_milestone_tasks`,
    so `tasks` carries no launch-shaped column.
  - **Cleanup order trap:** `launches.church_id`, `launch_events.actor_user_id` and
    `tasks.created_by_id` do NOT cascade, so a scheduled launch's seeded `launch_prep` tasks
    outlive their milestone links and then refuse a users delete. `planWipe()` derives that
    order; never write it down as a list.
- **`phase_transitions.kind`** (`phase-engine.ts`): `transition` (default) |
  `initial_declaration`, CHECK-closed. The second is history the planter DECLARED, so no rows
  exist for the phases behind it (declaring 3 writes nothing for 1–2), and
  `phase_transitions_initial_declaration_unique_idx` allows at most one per church ever. Ask
  `isInitialDeclaration` / `hasInitialPhaseDeclaration`, never the `reason` text.
- **`phase_prompt_answers` is an idempotency key, not a log** (`tasks.ts`): the row EXISTING
  silences the checklist prompt on any device, and nothing branches on `answer`. The key is
  `transition_id` ALONE — pairing it with `church_id` would let a forged church id claim a second
  answer. `acceptPhaseTemplatePrompt` writes it with `ON CONFLICT DO NOTHING` BEFORE the import
  it guards and gates that import on the claim's rowcount (`../invariants.md` → Transactions,
  claim-first). `PHASE_TEMPLATE_PROMPT_COOKIE` can only suppress a prompt, never restore one.
- **`church_id = null` means global content** (e.g. wiki articles visible to all tenants).
- **`sessions.id`** is the SHA-256 of the token, not the token.
- **Soft deletes:** `persons.deleted_at` — feature queries must filter it.
- **Notifications enqueue gate:** oversight recipients can ONLY receive `milestones` + `digest`,
  gated by `share_activity_with_oversight` at enqueue time; a recipient failing the gate is
  skipped and reported, never thrown over (`src/lib/notifications/`).
- **`organization_invitations` with BOTH target FKs null is a legitimate OPEN invitation** — the
  invitee had no account when the admin typed `invitee_email`. `bindOpenInvitationTarget`
  (`src/lib/invitations/core.ts`) fills it in at registration, and its compare-and-set is what
  makes an invite link single-use. Full rule: `../invariants.md` → Multi-Tenancy.
- **`association_events` is APPEND-ONLY, and only the code says so.** One writer,
  `src/lib/invitations/audit.ts`, which only INSERTs; with no `updated_at` and no soft-delete
  column there is no shape an edit could take, and no trigger blocks UPDATE/DELETE.
  - `church_id` is NOT NULL here, unlike most tables: the row's subject is a PLANT, and null
    already means "global content", which an audit row must never read as.
  - `org_type` + `org_id` is a discriminated pair with **no FK on `org_id`**, because an audit
    row must outlive its referent; the CHECK on `org_type` is the integrity it gets.
    `source_invitation_id` **null is a fact, not a gap** — a sever answers no invitation.
  - The actor is a session-minted `InvitationActor`, never a uuid parameter, and `audit.ts`
    carries no `"use server"` directive (`../invariants.md` → Authentication). Batch the audit
    row with the write it audits (`associationEventStatement` builds the INSERT without running
    it); a second round trip is the half-applied shape atomicity warns about.
- **`communications.status = 'logged'` is an entry the app RECORDED, not a message it sent.** A
  sent message walks `sending → sent | failed`; a `logged` entry is born terminal. Its only
  writer is `src/lib/communication/log.ts`, on `task.completed` for a task whose
  `related_type = 'person'`, and its `sent_at` is the task's `completed_at` — when the contact
  happened. The status list is a TS union over a plain `varchar(20)` with no CHECK, so anything
  rendering a status keeps its `?? status` fallback.
  - **`communication_recipients.external_id` is the Resend message id EXCEPT when it is
    `task:<taskId>`**, the back-reference making the entry idempotent under a replayed event
    (Resend ids are `re_…`, so the two cannot collide). It is a REPLAY guard, not a concurrency
    one — no unique index stands behind it, so two simultaneous completions write two entries.
    Accepted residual: a duplicate row in one person's log, never a missing or cross-tenant one;
    the fix is a partial unique index on `(church_id, external_id)`.
  - The handler swallows its own failures: `task.completed` also drives phase-engine
    dirty-marking, and a log entry is never worth a plant's dirty mark.
- **Transactions:** `db.transaction()` throws on neon-http — read `../invariants.md` →
  Transactions/Atomicity before any multi-statement mutation.

## The dev-seed wipe (`scripts/seed-dev-db.ts`)

Rules: `../invariants.md` → Dev Seeds. What the source does not tell you:

- **`pnpm db:seed` is not scoped to the rows it creates.** `WIPE_ROOTS` is `users` + `churches`,
  both cleared with a bare `DELETE FROM`, so the fixture IS the whole database — which is why it
  takes real logins with it on a shared branch.
- **The guard is positive detection, and it is code.** `assertDatabaseIsWipeable()` refuses if
  any user address matches a sentinel in `PROTECTED_ACCOUNTS`
  (`src/lib/dev-seed/protected-database.ts`); `--allow-protected-db` is the only way past.
  Recognising a database as SAFE instead fails open — an unfamiliar connection string or a
  pooled host reads as "not development".
- **The order is derived, not enumerated.** `planWipe()` reads every `public` foreign key from
  `pg_constraint`, walks out from the roots, and emits children before parents. A table
  unreachable from a user or a church is left alone (`sending_networks`, `sending_churches`), and
  a cycle of non-cascading keys throws with the table names rather than half-wiping.
- **`wiki_articles` and `wiki_sections` are `PROTECTED_TABLES`**: never deleted, _and_ never
  walked THROUGH, so nothing downstream of them is dragged in either.
  `assertProtectedTablesAreSafe()` aborts the seed BEFORE the first DELETE if a protected row
  points at a table the wipe deletes; a human re-points the rows.
- **Every script inserting a `churches` row stamps `onboarding_completed_at`**, or the wizard
  still owns that planter's dashboard (`shouldShowOnboarding`, `src/lib/onboarding/steps.ts`).
  The value is `now()` inside the same INSERT as `created_at`'s `DEFAULT now()`, so the two are
  the same instant.
