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
    between launches and users. **That order is no longer written down anywhere and must not be
    re-introduced as a list:** `planWipe()` in `scripts/seed-dev-db.ts` derives it at runtime from
    `pg_constraint`, so a table added next month joins the wipe on its own and nothing has to be
    kept in step. The FK facts above are still why the derivation matters — they are exactly the
    edges a hand-kept list kept missing. See "The dev-seed wipe" below.
- **`phase_transitions.kind`** (`phase-engine.ts`, migration 0033): `transition` (the default) |
  `initial_declaration`, closed by `phase_transitions_kind_check`. The second is OB-005's "where
  this plant already was when it joined" — history the planter DECLARED, not a move they made
  here, so no rows exist for the phases behind it (declaring 3 writes nothing for 1–2). At most
  one per church, ever, by `phase_transitions_initial_declaration_unique_idx`; see
  `../invariants.md` → Atomicity for why that index and not a predicate. Ask
  `isInitialDeclaration` / `hasInitialPhaseDeclaration`, never the `reason` text — the reserved
  sentence there is display copy that `transitionPhaseSchema` merely refuses to let a planter
  retype.
- **`phase_prompt_answers` is an idempotency key, not a log** (`tasks.ts`, migration 0037,
  ruled 2026-08-10 on #393). One row per phase transition, unique on `transition_id` — the row
  EXISTING is what silences the T-020 checklist prompt and what makes a repeat accept a no-op, on
  any device. `answer` (`accepted` | `declined`, CHECK-closed) is recorded because "did anyone
  ever take the phase-2 checklists?" cannot be reconstructed from `tasks` — an imported task is an
  ordinary task with no template marker — but nothing branches on it. Unique on `transition_id`
  ALONE, not on the pair with `church_id`: a transition belongs to one church, so the pair would
  be a wider key for the same rule and would let a forged church id claim a second answer.
  `acceptPhaseTemplatePrompt` writes it with `ON CONFLICT DO NOTHING` BEFORE the import it guards
  and gates the import on the claim's rowcount — see `../invariants.md` → Transactions for why
  claim-first rather than marker-last. This ROW is the only
  record of the answer: the `PHASE_TEMPLATE_PROMPT_COOKIE` that used to sit beside it as a "fast
  path" was deleted by #411 — it saved no query (the answer arrives on the same LEFT JOIN as the
  transition) and was a year-long browser-held copy of an answer the plant owns.
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
- **`communications.status = 'logged'` is an entry the app RECORDED, not a message it sent**
  (COM-020, #83). A sent message walks `sending → sent | failed`; a `logged` entry is born
  terminal, has no delivery behind it, and is the FRD's "[Log Only]" branch of the follow-up
  workflow. Today the only writer is `src/lib/communication/log.ts`, from the `task.completed`
  event: completing a task whose `related_type = 'person'` writes one into that person's
  communication log (COM-007's join of `communications` × `communication_recipients`). Its
  `sent_at` is **when the contact happened** — the task's `completed_at` — because that is what
  the person log and the history table already render.
  - The status list is a TS union over a plain `varchar(20)` with no CHECK, so adding a value
    took no migration. Anything rendering a status must therefore keep its `?? status` fallback.
  - **`communication_recipients.external_id` is the Resend message id EXCEPT when it is
    `task:<taskId>`** — the namespaced back-reference that makes the log entry idempotent under a
    replayed `task.completed`. Resend ids are `re_…`, so the two cannot collide, and the webhook
    only ever looks up an exact id it was handed. That pre-read is a REPLAY guard, not a
    concurrency one (`../invariants.md` → Atomicity): there is no unique index behind it, and
    **nothing stands in for one**. `completeTask` is a read-then-write whose UPDATE does not
    re-assert `status <> 'complete'`, so two simultaneous completions of one task — a
    double-clicked Complete button — write two entries. Verified reproducible on #366.
    Accepted residual: the cost is a duplicate row in one person's log, never a missing or
    cross-tenant one. The fix is a partial unique index on `(church_id, external_id)`.
  - The handler swallows its own failures. `task.completed` also drives phase-engine
    dirty-marking (PE-010), and a communication log entry is never worth costing a plant its
    dirty mark.
- **Transactions:** `db.transaction()` throws on neon-http — see `../invariants.md` →
  Transactions/Atomicity before writing any multi-statement mutation.

## The dev-seed wipe (`scripts/seed-dev-db.ts`, #326)

Rules: `../invariants.md` → Dev Seeds. Why they are not guessable from the source:

- **`pnpm db:seed` is not scoped to the rows it creates.** `WIPE_ROOTS` is `users` + `churches`
  and both are deleted with a bare `DELETE FROM` — the fixture IS the whole database. That is
  precisely what makes the seed-domain retirement (ruled 2026-07-31; the placeholder domain is
  retired repo-wide, `everyfield.app` replaced it) converge: there is no email predicate to keep
  in step, so no account can survive by carrying an address the script no longer mentions. The
  retired literal is deliberately not written here — #326's AC is a repo-wide `grep` with two
  named exclusions, and memory is not one of them. The same property is the cost — pointed at the shared
  `development` branch it takes the alpha-cohort logins, the marketing-church fixture and every
  hand-registered plant with them. That cost is why the wipe is guarded in code — see below.
- **The guard is positive detection, and it is code (ruled 2026-08-09).** Before the FK graph is
  even read, `assertDatabaseIsWipeable()` reads every user's address and refuses if any
  alpha-cohort sentinel is present (`PROTECTED_ACCOUNTS` in
  `src/lib/dev-seed/protected-database.ts`); `--allow-protected-db` is the only way past. It looks
  for accounts that only exist on a database worth protecting rather than trying to recognise a
  database that is safe — the negative version fails OPEN, since an unfamiliar connection string,
  a renamed Neon branch or a pooled host all read as "not development". The sentinels are a
  sample, not an inventory: one match stops a wipe that would also take ~67 hand-registered plants
  no sentinel names. Until #326 this was a comment, and the thing actually protecting that
  database was the accident that the wipe used to CRASH partway through on launch history —
  which `planWipe()` fixed, removing the protection with the bug. The decision is a pure function
  over query results because the only way to test the wired-up version end to end is to run the
  wipe it exists to prevent (`src/lib/dev-seed/protected-database.test.ts`).
- **The order is derived, not enumerated.** `planWipe()` reads every `public` foreign key from
  `pg_constraint`, walks out from the roots taking anything that (transitively) points into the
  set, and emits children before parents. A table unreachable from a user or a church is not
  fixture and is left alone (`sending_networks`, `sending_churches`). Self-referencing keys are
  dropped from the ordering — one `DELETE FROM t` removes the referencing rows with the rest. A
  cycle of non-cascading keys throws with the table names rather than half-wiping.
- **`wiki_articles` and `wiki_sections` are `PROTECTED_TABLES`, which means two things:** never
  deleted, *and* never walked THROUGH — so nothing downstream of them is dragged into the wipe
  either. The corpus is migrated content that no script rebuilds (#317), including the
  `related_article_slugs` cross-links.
- **`assertProtectedTablesAreSafe()` aborts the entire seed BEFORE the first DELETE** if any
  protected row points at a table the wipe deletes — today that is a church-scoped
  `wiki_articles.church_id`. The honest answer to that FK is to stop and let a human re-point the
  rows, not to delete an article; stopping late (after the users are gone) would be the worst of
  both.
- **Why `--oversight-orgs-only` writes credentials the way it does (#304, rounds 7–10).** The
  mode's only job is to leave a usable oversight fixture behind, and four separate versions of it
  failed in ways the code alone does not explain:
  - *Round 7* — it deleted nothing, so three comments called it "the safe mode". It minted a real
    `sending_church_admin` login whose password was a constant in this repository, on whatever
    database it last ran against. The account it created on the shared development branch was
    neutralised BY HAND on 2026-08-10; that is why an address there may already exist with a
    password nobody holds. Additive is not a synonym for safe — writing a login needs the same
    "which database is this" answer a DELETE does, which is why `decideSeedAccounts` exists.
  - *Round 8* — dropping the in-repo constant was right and replaced it with nothing. The password
    became whatever the last operator typed, recorded nowhere, so the fixture was reachable by
    exactly one shell. Every interactive acceptance criterion of #304 then went unexercised for
    want of a login, which is what `.env.local` (and `unrecordedPasswordNotice`) now prevent.
  - *Round 9* — the write was `onConflictDoNothing`, so a second run with a different password
    exited 0 announcing "the SEED_ADMIN_PASSWORD you passed" while the OLD password still opened
    the account. A false success on a credential path: the announcement and the write disagreed.
  - *Round 10* — the two halves of the fixture drifted apart. Only the sending-church admin was
    written, so `admin@everyfield.app` kept a NULL `sending_network_id` and `/oversight/invitations`
    rendered "Set up your network first" with no invitation sendable. Both halves are restored by
    one command now, and `oversightAdminSeeds()` THROWS rather than restore half of them.
- **Every script that inserts a `churches` row stamps `onboarding_completed_at`.** A null stamp
  means the onboarding wizard still owns that planter's dashboard (`shouldShowOnboarding`,
  `src/lib/onboarding/steps.ts`), so an unstamped fixture puts every seeded planter in the wizard.
  The value is `now()` evaluated inside the same INSERT as `created_at`'s `DEFAULT now()`, so the
  two are the same instant rather than milliseconds apart. `src/lib/onboarding/seeded-churches.test.ts`
  pins the script list.
