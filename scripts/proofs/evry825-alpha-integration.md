# Evry #825 / leadership #830 integration hold

## Corrected Evry base

`9f7cf80f679752151354bca88d69137160a39bf2` corrects both CI failures without
changing application behavior. The composer proof reads rendered RichText host
output; the invitation proof substitutes only the model provider and retains
its production conversation, recipe, database and delivery assertions.

CI: https://github.com/SebastianGarces/everyfield_v2/actions/runs/35016702762

## Held compatibility branch

`codex/evry825-leadership830-compat` starts at the corrected Evry base and
integrates native leadership `5d799e9a` and discovery `241d0c40`. Discovery's
reserved schema changes shared invitation discriminants, so its schema alone
is not a compilable integration; its existing implementation accompanies it.
This branch is **not a main/release candidate yet**. No shared migration was
applied. Chat UI files are unchanged from `9f7cf80f`.

Migration 0078 adds a separate per-plant `leadership_versions` conflict witness.
Database triggers advance it for all role, membership, team and person writes,
user seat/tenancy changes, user inserts/deletes and leadership-status changes.
New plants receive a guard; existing plants are backfilled. This covers writers
that do not call native leadership helpers, particularly inserts into empty sets.

Evry retains Serializable and its one full retry on `40001`/`40P01`. It locks
plant advisory key → version → teams → roles/memberships → candidate people and
linked users/actor → lifecycle/attempt, then executes its original exact-plan
claim-and-domain CTE. The final predicate rechecks appointment eligibility.
Explicit/role/legacy provenance survives raw-row planning and persistence.
Receipt recovery still precedes eligibility and never reapplies committed work.

Direct person writers can acquire a person row before their trigger needs the
version, opposite Evry's order. The proof deliberately creates that deadlock:
PostgreSQL aborts Evry with `40P01`, its bounded retry reads the new state, and no
stale claim or domain write survives. This is an explicit safety/retry mechanism,
not a claim that advisory locking eliminates every cross-writer deadlock.

## Repeatable production-path proof

Requires Docker, this checkout's installed dependencies, and the `pg` transport
driver from the #830 handoff. The wrapper creates a uniquely named loopback-only
Postgres container, applies the real migration sequence to disposable databases,
and removes that container and its temporary data on exit:

```sh
PG_MODULE=/private/tmp/ef830-pg/node_modules/pg/lib/index.js \
  bash scripts/proofs/run-evry-leadership-cross-writer.sh
```

The harness changes Neon HTTP transport and supplies request-session context
backed by real session/user rows. It does **not** replace the database module,
production resolver, proposal, confirmation route, execution route, dispatcher,
executor, lifecycle, claim or outcome implementation. Native removal,
appointment and role creation use their actual exported services. Arbitrary
candidate/identity edits run SQL directly to exercise the database-wide guard.
No model or email provider is called.

The 15 checks cover:

- Production approval/execution/outcomes and exact receipt identity; unlinked CRM eligibility.
- Native removal first, with an older Evry snapshot: one `40001`, one retry, no claim.
- Role INSERT and qualifying owner-person INSERT, both previously invisible to the old snapshot.
- Person deletion, candidate seat/tenancy, actor seat, plan cancellation and role-flag drift.
- Same-person explicit provenance replacing a role appointment; fresh role deletion preserves it.
- Effect first, native cleanup second, receipt-only replay without restoring leadership.
- Claim/domain rollback together and a successful retry.
- Lost post-commit response recovered from the exact durable claim.
- A real `40P01` deadlock and a single fresh retry.

The existing Teams live proof additionally exercises all 19 effect operations,
including initialization, role import, membership history, notifications and
replay. Schema snapshot/journal checks must remain green.

## Aggregate release blockers found by the full regression run

The leadership proofs are green; the aggregate is not release-ready. The full
regression run exposed six remaining discovery-integration checks, outside the
leadership writer changes:

- `scripts/cs013-mutation-check.test.ts`: association consequence-copy mutation
  target no longer matches the discovery-aware component.
- `src/app/(dashboard)/assigned-plants.test.ts`: the shell's new conditional
  `hasDiscoveryProfile` await needs a reviewed contract and failure treatment.
- `src/app/(dashboard)/page-canvas-scroll-layouts.test.ts`: classify the new
  discovery home canvas's scroll ownership.
- `src/components/settings/settings-mechanism.test.ts`: discovery home has a
  raw settings link instead of `SettingsLink`.
- `src/db/live-suite-coverage.test.ts`: move discovery's test endpoint switch
  into its runner/preload, not a module under `src/`.
- `src/lib/testing/source-span.test.ts`: remove the now-stale invitation-source
  allowlist entry.

Two other integration failures were corrected here: the native membership
contract now follows its shared RETURNING CTE, and platform inventory explicitly
excludes `createDiscoveryPlant` as human, pre-tenancy onboarding. Neither change
adds an Evry runtime capability. These six remaining checks and the discovery
preview gate must be resolved before treating this branch as a release base.

## Merge and rollout order

1. Keep #825 draft/unreleased at corrected `9f7cf80f`. The two-file CI commit can
   be cherry-picked immediately onto the three published alpha integration
   branches. To adopt the approved Markdown/copy work too, merge the corrected
   Evry head into those **held** branches, not into main.
2. Use `codex/evry825-leadership830-compat` as the combined leadership/discovery
   test base. Integrate wiki `95c2e8e`, task filters `a9a968b`, then task guards
   `7cb2f9f` there; resolve overlapping inventory/permission metadata by source
   intent and rerun combined tests and preview checks. Those three final merges
   have not been performed by this change.
3. Preserve applied 0075 byte-for-byte. Preserve reserved 0076/0077 SQL and
   timestamps. After compatibility and release approval, apply pending
   **0076 → 0077 → 0078** as one migration batch through `pnpm db:migrate`.
   First inspect the actual ledger read-only, including any earlier Evry
   migration gaps. Never rewrite accepted migration history.
4. Coordinate compatible application deployment and migrations under a
   leadership-write maintenance window: 0076's constraint rejects old writers
   that set a leader without provenance, and new readers require its columns.
   Do not send traffic to a half-upgraded application/schema pair. Smoke-test
   native and Evry writers before reopening those writes.
5. Only merge/release the aggregate into main after Evry #758/#825 and the alpha
   release gates are explicitly approved. If alpha must ship before Evry,
   extract native-only changes onto a clean main-based branch instead; never
   merge one of these Evry-based branches wholesale into main.
