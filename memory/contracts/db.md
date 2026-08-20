# Database Contracts

ORM: Drizzle | DB: PostgreSQL (Neon serverless) | Connection: `src/db/index.ts`
Schema: `src/db/schema/*.ts`, one file per feature area — **read the schema files, they are the
contract.** Migrations: `src/db/migrations/` via `pnpm db:migrate` (never `db:push`).

Conventions (unless a schema file says otherwise): `id` uuid PK; `church_id` → churches is the
tenant scope; `created_at`/`updated_at` default now.

## Non-obvious column semantics

- **`churches.time_zone`** (`church.ts`): non-null IANA id, default and backfill `America/Chicago`. Invalid ids are rejected on write (`isValidTimeZone` in `datetime.ts`); there is no CHECK, because IANA is `Intl`'s list. Church-scoped instants render in this zone; meeting `datetime` stays a UTC wall clock. Changed in church settings, not onboarding. There is no per-user timezone.
- **`users.seat`** (`user.ts`): `owner` | `admin` | `member` | **null = a coach**, and null is a
  VALUE here rather than a gap — coaching is an assignment, not a seat. Read it ONLY together with
  the tenancy FK on the same row (`church_id` / `sending_church_id` / `sending_network_id`), through
  `src/lib/auth/tenancy.ts`: `owner` alone says nothing about whose owner. There is no `users.role`
  — migration 0051 dropped it.
- **`churches.leadership_status`** (`church.ts`): `planter_confirmed` | `no_planter` | **null =
  never asked** — null is NOT "no planter", which is why it is not a boolean. Read it only
  through `src/lib/onboarding/leadership.ts`; the planter _assignment_ is `users.church_id` +
  `users.seat = 'owner'`.
- **`churches` has NO `launch_date` column.** Launch Sunday is the `launches` entity, at most one
  row per church. Read with `getLaunchForChurch` / `getLaunchDatesForChurches`
  (`src/lib/launch/queries.ts`); write ONLY through `setLaunchDate` (`src/lib/launch/service.ts`),
  which journals the change and fires `launch_date_changed`. Nothing under `src/lib/launch/`
  carries `"use server"`.
  - `launches.target_date` is nullable **only** while `status = 'planning'`;
    `launches_target_date_check` makes "scheduled with no day" unrepresentable, so countdown
    readers never defend against it. `planning | scheduled | completed | postponed` is
    CHECK-closed; `postponed` is NOT terminal, it carries a new date.
  - **One live launch per church is the `launches_church_id_unique` index, not a service check**,
    because two concurrent first schedules both pass a SELECT-then-INSERT. The insert carries
    `ON CONFLICT (church_id) DO NOTHING`, and the loser writes nothing at all, journal included.
  - The write is ONE statement, not a `db.batch`: a `WITH` chain that locks the row
    (`SELECT … FOR UPDATE`), inserts-or-compare-and-sets, then journals from what was written —
    the journal needs the OLD values the update destroys and an id the insert has yet to mint.
  - **`launch_events` is APPEND-ONLY** on the same terms as `association_events` below.
    `previous_target_date` null = the first commitment, a fact rather than a gap; `moved` vs
    `postponed` follows the CALLER's intent. Milestone links live in `launch_milestone_tasks`, so
    `tasks` carries no launch-shaped column.
  - **Cleanup order trap:** `launches.church_id`, `launch_events.actor_user_id` and
    `tasks.created_by_id` do NOT cascade, so a scheduled launch's seeded `launch_prep` tasks
    outlive their milestone links and then refuse a users delete. `planWipe()` derives that order;
    never write it down as a list.
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
  claim-first). This row is the ONLY record — `PHASE_TEMPLATE_PROMPT_COOKIE` was deleted (#411),
  and nothing browser-held may answer a prompt again.
- **`church_id = null` means global content** (e.g. wiki articles visible to all tenants).
- **`sessions.id`** is the SHA-256 of the token, not the token.
- **Soft deletes:** `persons.deleted_at` — feature queries must filter it.
- **Notifications enqueue gate:** oversight recipients can ONLY receive `milestones` + `digest`,
  gated by `share_activity_with_oversight` at enqueue time; a recipient failing the gate is
  skipped and reported, never thrown over (`src/lib/notifications/`).
- **`email_suppressions` is about an ADDRESS**, not a delivery and not a user (`notifications.ts`,
  0042, #324): `PERMANENT_FAILURE_PREFIX` stops one (notification, channel) retry, while the NEXT
  notification gets a fresh row and mails the dead mailbox again. Webhook writes it, dispatch reads
  it once per run.
  - `email` is stored **already lowercased and trimmed** by `normalizeEmailAddress`
    (`notifications/channels/suppression.ts`), its one writer — a `lower(email)` index would make
    the `ON CONFLICT` target unspellable. Plus-addresses and dots are NOT folded.
  - **`email_suppressions_active_email_idx` is the guard AND the `ON CONFLICT … DO NOTHING`
    arbiter**: partial unique on `email` where `cleared_at is null`. Never `DO UPDATE` — the first
    row's reason and `suppressed_at` survive every webhook redelivery. `cleared_at` non-null =
    retired and the row stays as history; `..._cleared_check` ties it to `cleared_reason` both
    ways, and `cleared_by_user_id` is null for a self-service clear.
  - **`addressSuppressionForEvent`** (`channels/delivery-events.ts`) decides, derived from the
    delivery-outcome mapping: hard bounce and spam complaint suppress, a SOFT bounce and
    `email.failed` keep their bounded retries. **Dispatch REPORTS the skip, never throws** —
    refuses before composing, settles `failed` with the permanent prefix so the log says why
    (N-016), counts `addressSuppressed`. EMAIL only; the in-app feed row still arrives.
- **`meeting_responses` is the Response Card (VM-014, `meetings.ts`, 0041), NOT
  `meeting_attendance.response_status`** — that column is the RSVP. **NO ROW means no card came
  back, and is never a refusal**: `not_interested` is the only negative value and it needs a row.
  Read only through `buildResponseBreakdown` (`lib/meetings/response-card.ts`), which reports
  `notRecordedCount` separately. One upserted row per (meeting, person),
  `meeting_responses_meeting_person_unique`, so a double submit cannot double-count.
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
  takes real logins on a shared branch.
- **The guard is positive detection, and it is code.** `assertDatabaseIsWipeable()` refuses if any
  user address matches a `PROTECTED_ACCOUNTS` sentinel
  (`src/lib/dev-seed/protected-database.ts`); `--allow-protected-db` is the only way past.
  Recognising a database as SAFE instead fails open — an unfamiliar connection string or a pooled
  host reads as "not development".
- **The order is derived, not enumerated.** `planWipe()` reads every `public` foreign key from
  `pg_constraint`, walks out from the roots, and emits children before parents. A table unreachable
  from a user or a church is left alone (`sending_networks`, `sending_churches`); a cycle of
  non-cascading keys throws with the table names rather than half-wiping.
- **`wiki_articles` and `wiki_sections` are `PROTECTED_TABLES`**: never deleted, _and_ never
  walked THROUGH, so nothing downstream of them is dragged in either.
  `assertProtectedTablesAreSafe()` aborts the seed BEFORE the first DELETE if a protected row
  points at a table the wipe deletes; a human re-points the rows.
- **Every script inserting a `churches` row stamps `onboarding_completed_at`**, or the wizard
  still owns that planter's dashboard (`shouldShowOnboarding`, `src/lib/onboarding/steps.ts`).
  The value is `now()` inside the same INSERT as `created_at`'s `DEFAULT now()`, so the two are
  the same instant.

## Migration ledger vs journal (HR2)

The shared Neon branch is also the de-facto prod DB. **Diagnosis is read-only.** Any write to
`drizzle.__drizzle_migrations` is attended-only — never a side effect of another track.

### Finding (2026-08-16, #340)

Re-ran the journal-vs-applied check against the live ledger and
`src/db/migrations/meta/_journal.json` at `97db346` (42 journal entries, tags `0000`–`0042`).

| Applied `id` | `created_at` (UTC) | Journal `when` | What it is |
|---|---|---|---|
| 19 | 2026-04-07T23:59:06.754Z (`1775606346754`) | **none** | Orphan. Sits between journal `0017_inactivity_thresholds` (`1771112665213`) and `0018_confused_lady_ursula` (`1781130119804`). Hash `31f441c8…` matches no committed migration blob. Live catalog OIDs place `assistant_threads` / `assistant_messages` / `assistant_artifacts` in that gap — three tables with **no repo owner** and no git history for `assistant_threads`. |
| 40 | 2026-08-09T21:56:31.041Z (`1786312591041`) | **none** | Orphan. Same-day sibling between two journal-matched rows (`1786254063022` and `1786321828264`). Hash `dbacaf84…` matches no committed blob. No uniquely attributable leftover objects. |

Every current journal `when` has a matching applied row. **0 pending.**

**Id gaps** (`31`, `34`, `36`, `38`, `42`) are **deleted serial rows**, not missing journal
entries. `__drizzle_migrations.id` is a sequence; a rollback that `DELETE`s a ledger row leaves
a hole. Filename gaps in the repo (`0035` never existed; `0034` then `0036`) are a different
axis and do not explain the serial holes.

`share_phase` / `share_digest` on `church_privacy_settings` were never ledger drift: 0029 is
expand-only, and `0045_drop_share_phase_digest.sql` is the contract half that drops both
columns (#255).

### Proposed ruling

**Document the drift as accepted history. Do not repair the ledger unattended.**

Deleting an orphan row whose hash matches no committed file hides applied DDL we cannot name.
The April orphan almost certainly created the `assistant_*` tables; dropping those objects is
a separate attended decision (they hold no product code path). The August orphan stays as a
tombstone until an operator can prove its DDL is subsumed.

If a repair is later approved: identify objects, drop or keep them on purpose, then
`DELETE FROM drizzle.__drizzle_migrations WHERE id IN (19, 40)` in the same attended session.
Never edit `_journal.json` to invent tags for hashes we do not have.

### Reusable snippet

Match journal `when` to `drizzle.__drizzle_migrations.created_at`. A row on only one side is
drift. Run read-only:

```sql
-- applied rows whose created_at is not a journal `when`
-- (paste journal whens, or join from a values list built off _journal.json)
SELECT id, created_at, encode(hash, 'hex')
FROM drizzle.__drizzle_migrations
ORDER BY id;
```

```js
// node — worktree or checkout that has src/db/migrations/meta/_journal.json
const journal = require("./src/db/migrations/meta/_journal.json");
const applied = /* rows from the SELECT above, created_at as string */;
const jWhen = new Set(journal.entries.map((e) => String(e.when)));
const aWhen = new Set(applied.map((r) => String(r.created_at)));
const orphans = applied.filter((r) => !jWhen.has(String(r.created_at)));
const pending = journal.entries.filter((e) => !aWhen.has(String(e.when)));
const ids = applied.map((r) => r.id).sort((a, b) => a - b);
const gaps = [];
for (let i = ids[0]; i <= ids[ids.length - 1]; i++)
  if (!ids.includes(i)) gaps.push(i);
console.log({
  journal: journal.entries.length,
  applied: applied.length,
  orphans,
  pending: pending.map((e) => e.tag),
  gaps,
});
```

HR2 evidence is this section plus a fresh run of the snippet. A green "0 pending" is not "0
orphans".

## `user_invitations` — the two CHECKs, and the one that nearly was not

- **`token_hash` is sha256 of the emailed token, never the token.** The unique index on it is what makes the registration lookup a point read; a resend rotates it, so a row cannot reproduce the link it already sent (`memory/invariants.md` → Multi-Tenancy).
- **`user_invitations_seat_check` is a biconditional over non-null booleans, deliberately.** The obvious spelling — `(kind = 'seat' and seat in (…)) or (kind = 'coach' and seat is null)` — ACCEPTS `kind='seat', seat=NULL`: the first arm is `true and NULL` = `NULL`, and a CHECK rejects only `false`. It shipped, typechecked and passed every DDL regex; a scratch Postgres answered `INSERT 0 1`. Prove a new constraint by writing the row it forbids.
- **Exactly-one tenancy is `num_nonnulls(...) = 1`**, the `association_events` 0036 precedent — NULL-safe by construction, because `num_nonnulls` counts nulls and never returns one.
