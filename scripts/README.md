# Script inventory

Reviewed 2026-09-26 for #855. This covers tracked executable and support files in `scripts/`, `ops/`, and `.cursor/hooks/`, including their tests. The maintained inventory has 68 files, including 13 test files. Application regression suites and versioned SQL migrations remain in their owning directories.

```sh
node ops/script-inventory.mjs > /tmp/everyfield-script-inventory.json
```

The command reads tracked files and reports textual references, including relative extensionless imports, plus package commands. It never runs a script or reads untracked environment files. Comments and historical documents count as references; globs and dynamic commands may invoke a file without naming it. Inspect the references before deciding whether a tool is still useful.

## Retired release tools

The first cleanup removed four dead rename/import/extraction scripts. The follow-up removes 39 more files: historical release runners and their private helpers, tests and documents. Historical evidence is available in the original PRs and Git history; keeping a release reproducible does not require maintaining its entire harness on current main.

| Retired group | Why it left the maintained toolset |
| --- | --- |
| `g3-*` harnesses and four `g3:*` package aliases | Belonged to the retired gated delivery process. Current application regression suites remain; these manual release scripts are not part of CI. This retirement does not claim every manual assertion has an identical CI replacement. |
| `proofs/alpha-migration-baseline.*` | Reconciled the specific immutable alpha release in PR #850 and requires frozen source revisions. |
| `proofs/discovery-preview-294-*` | One release's browser fixture, frozen schema evidence, mail capture and approval protocol, plus private helper tests. Current branch validation follows the browser-validation skill. |
| Avatar, Evry and wiki migration proofs | One-off apply/rollback evidence for already-reviewed immutable SQL. SQL files, snapshots, migration tests and the live database suite remain. |
| Avatar roundtrip, settings hash and wiki sharing release probes; notification-feed seed | Ad-hoc acceptance tooling for completed releases. Domain tests remain; new behavior changes still require fresh branch validation. |
| `discovery-schema-delta.ts` | Scratch SQL generator used before numbered discovery migrations shipped. Migration generation and snapshot tooling remain. |
| Wiki related-section migration, its private parser and parser tests | [PR #348](https://github.com/SebastianGarces/everyfield_v2/pull/348) records 96 articles migrated, 358 links resolved and a no-op second run. The guard against seeds overwriting the resulting links stays. |
| Benchmark wording rewrite | [PR #551](https://github.com/SebastianGarces/everyfield_v2/pull/551) records all 13 edits applied and a no-op second run. The read-only benchmark audit stays. |
| `db:push` package alias | Repository conventions prohibit it. Use versioned migrations through `db:generate` and `db:migrate`. |

To inspect or recover any file retired by the follow-up, use its path at the last main commit before it:

```sh
git show a94276a01978e360ffa4cceba8c736dd8f16395c:<repository-relative-path>
```

## Maintained tools

The remaining one-off-looking runners have concrete dependencies or distinct current checks: discovery's database runner is required by its live suite; task, RSVP and leadership proofs exercise native persistence and races; mutation checks prove that regression guards detect deliberate breakage. The marketing contact repair preserves existing fixtures without reseeding their saved assessments.

### Scripts

| File | Current use |
| --- | --- |
| [`scripts/audit-benchmark-language.ts`](../scripts/audit-benchmark-language.ts) | Read-only audit of methodology benchmark wording in the database corpus. |
| [`scripts/backfill-snapshot.ts`](../scripts/backfill-snapshot.ts) | Migration diagnostics and snapshot/order repair; referenced by migration tests, commands or invariants. |
| [`scripts/check-document-exports.py`](../scripts/check-document-exports.py) | Generate document samples and inspect PDF, Word and spreadsheet exports offline. |
| [`scripts/cleanup-mcp-browsers.sh`](../scripts/cleanup-mcp-browsers.sh) | Current agent workflow utility, referenced by skills or worktree tests. |
| [`scripts/cs013-mutation-check.test.ts`](../scripts/cs013-mutation-check.test.ts) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/cs013-mutation-check.ts`](../scripts/cs013-mutation-check.ts) | Mutation proof that regression guards reject broken sharing or leaked storage keys. |
| [`scripts/db-migrate.test.ts`](../scripts/db-migrate.test.ts) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/db-migrate.ts`](../scripts/db-migrate.ts) | Migration diagnostics and snapshot/order repair; referenced by migration tests, commands or invariants. |
| [`scripts/discovery-db-endpoint.test.ts`](../scripts/discovery-db-endpoint.test.ts) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/discovery-db-endpoint.ts`](../scripts/discovery-db-endpoint.ts) | Run the discovery live suite with an owned database and local Neon endpoint. |
| [`scripts/embed-methodology-corpus.ts`](../scripts/embed-methodology-corpus.ts) | Refresh methodology embeddings after changes to the Playbook or database wiki corpus. |
| [`scripts/evry-latency-report.ts`](../scripts/evry-latency-report.ts) | Current Evry latency fixture and model benchmark package commands. |
| [`scripts/evry-model-benchmark.ts`](../scripts/evry-model-benchmark.ts) | Current Evry latency fixture and model benchmark package commands. |
| [`scripts/export-document-catalog.ts`](../scripts/export-document-catalog.ts) | Generate document samples and inspect PDF, Word and spreadsheet exports offline. |
| [`scripts/live-db-endpoint.ts`](../scripts/live-db-endpoint.ts) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/live-db-names.ts`](../scripts/live-db-names.ts) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/live-db-preflight.ts`](../scripts/live-db-preflight.ts) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/live-db-prepare.sh`](../scripts/live-db-prepare.sh) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/live-db-run.ts`](../scripts/live-db-run.ts) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/live-db-stack.sh`](../scripts/live-db-stack.sh) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/patch-contact-info.ts`](../scripts/patch-contact-info.ts) | Repairs existing marketing contacts without reseeding or discarding approved assessments. The seed handles new rows but does not replace this repair; backfill completion is unverified. |
| [`scripts/preview-url.sh`](../scripts/preview-url.sh) | Current agent workflow utility, referenced by skills or worktree tests. |
| [`scripts/proofs/team-leader-provenance-830.mjs`](../scripts/proofs/team-leader-provenance-830.mjs) | Native leadership and concurrent seat-removal proofs; see team-leader-provenance-native-830.md. |
| [`scripts/proofs/team-leader-provenance-races-830.mjs`](../scripts/proofs/team-leader-provenance-races-830.mjs) | Native leadership and concurrent seat-removal proofs; see team-leader-provenance-native-830.md. |
| [`scripts/proofs/team-leader-provenance-races-830.sh`](../scripts/proofs/team-leader-provenance-races-830.sh) | Native leadership and concurrent seat-removal proofs; see team-leader-provenance-native-830.md. |
| [`scripts/prove-discovery-profile.mjs`](../scripts/prove-discovery-profile.mjs) | Run the discovery live suite with an owned database and local Neon endpoint. |
| [`scripts/prove-picture-key-fence.sh`](../scripts/prove-picture-key-fence.sh) | Mutation proof that regression guards reject broken sharing or leaked storage keys. |
| [`scripts/restamp-migration.test.ts`](../scripts/restamp-migration.test.ts) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/restamp-migration.ts`](../scripts/restamp-migration.ts) | Migration diagnostics and snapshot/order repair; referenced by migration tests, commands or invariants. |
| [`scripts/run-eval-v1-pass.ts`](../scripts/run-eval-v1-pass.ts) | Re-run the phase-engine fleet against the active rubric; the filename does not freeze the rubric version. |
| [`scripts/seed-dev-db.ts`](../scripts/seed-dev-db.ts) | Recreate development, marketing, notification, evaluation or communication-template fixtures. |
| [`scripts/seed-marketing-church.ts`](../scripts/seed-marketing-church.ts) | Recreate development, marketing, notification, evaluation or communication-template fixtures. |
| [`scripts/seed-phase-engine-eval.ts`](../scripts/seed-phase-engine-eval.ts) | Recreate development, marketing, notification, evaluation or communication-template fixtures. |
| [`scripts/seed-system-templates.ts`](../scripts/seed-system-templates.ts) | Recreate development, marketing, notification, evaluation or communication-template fixtures. |
| [`scripts/task-native-concurrency-proof.ts`](../scripts/task-native-concurrency-proof.ts) | Behavioral proofs for storage, settings redirects, wiki tenancy, task races and own RSVP permissions. |
| [`scripts/verify-own-rsvp.ts`](../scripts/verify-own-rsvp.ts) | Behavioral proofs for storage, settings redirects, wiki tenancy, task races and own RSVP permissions. |
| [`scripts/worktree-add.sh`](../scripts/worktree-add.sh) | Current agent workflow utility, referenced by skills or worktree tests. |
| [`scripts/worktree-env.sh`](../scripts/worktree-env.sh) | Current agent workflow utility, referenced by skills or worktree tests. |

### Operations

| File | Current use |
| --- | --- |
| [`ops/board.sh`](../ops/board.sh) | Current issue/PR coordination and label setup, referenced by delivery skills and tests. |
| [`ops/codex-session-context.sh`](../ops/codex-session-context.sh) | Current agent setup and hook adapters, referenced by host configuration and tests. |
| [`ops/evry-cost-audit.mjs`](../ops/evry-cost-audit.mjs) | Current cost-audit and trace smoke package commands. |
| [`ops/evry-cost-audit.test.mjs`](../ops/evry-cost-audit.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`ops/evry-langfuse-smoke.test.ts`](../ops/evry-langfuse-smoke.test.ts) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`ops/evry-langfuse-smoke.ts`](../ops/evry-langfuse-smoke.ts) | Current cost-audit and trace smoke package commands. |
| [`ops/evry/communication-inventory.ts`](../ops/evry/communication-inventory.ts) | Generate and validate Evry capability inventories; support modules are imported by generators and tests. |
| [`ops/evry/generate-communication-inventory.ts`](../ops/evry/generate-communication-inventory.ts) | Generate and validate Evry capability inventories; support modules are imported by generators and tests. |
| [`ops/evry/generate-inventory.ts`](../ops/evry/generate-inventory.ts) | Generate and validate Evry capability inventories; support modules are imported by generators and tests. |
| [`ops/evry/generate-people-inventory.ts`](../ops/evry/generate-people-inventory.ts) | Generate and validate Evry capability inventories; support modules are imported by generators and tests. |
| [`ops/evry/inventory.ts`](../ops/evry/inventory.ts) | Generate and validate Evry capability inventories; support modules are imported by generators and tests. |
| [`ops/evry/people-inventory.ts`](../ops/evry/people-inventory.ts) | Generate and validate Evry capability inventories; support modules are imported by generators and tests. |
| [`ops/format-agent-edit.sh`](../ops/format-agent-edit.sh) | Current agent setup and hook adapters, referenced by host configuration and tests. |
| [`ops/guard-worktree-pnpm-hook.sh`](../ops/guard-worktree-pnpm-hook.sh) | Current agent setup and hook adapters, referenced by host configuration and tests. |
| [`ops/guard-worktree-pnpm.sh`](../ops/guard-worktree-pnpm.sh) | Current agent setup and hook adapters, referenced by host configuration and tests. |
| [`ops/langfuse/manage.sh`](../ops/langfuse/manage.sh) | Manage the documented local Langfuse stack. |
| [`ops/merge-hold.sh`](../ops/merge-hold.sh) | Current issue/PR coordination and label setup, referenced by delivery skills and tests. |
| [`ops/principles-context.sh`](../ops/principles-context.sh) | Current agent setup and hook adapters, referenced by host configuration and tests. |
| [`ops/script-inventory.mjs`](../ops/script-inventory.mjs) | Re-run this repository script reference inventory without executing the scripts. |
| [`ops/setup-labels.sh`](../ops/setup-labels.sh) | Current issue/PR coordination and label setup, referenced by delivery skills and tests. |
| [`ops/sync-codex-setup.mjs`](../ops/sync-codex-setup.mjs) | Current agent setup and hook adapters, referenced by host configuration and tests. |
| [`ops/tests/board-query.test.mjs`](../ops/tests/board-query.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`ops/tests/ci-test-parity.test.mjs`](../ops/tests/ci-test-parity.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`ops/tests/codex-setup.test.mjs`](../ops/tests/codex-setup.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`ops/tests/guard-worktree-pnpm.test.mjs`](../ops/tests/guard-worktree-pnpm.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`ops/tests/merge-hold-parity.test.mjs`](../ops/tests/merge-hold-parity.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`ops/tests/requirement-ids.test.mjs`](../ops/tests/requirement-ids.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`ops/tests/worktree-env.test.mjs`](../ops/tests/worktree-env.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |

### Host adapters

| File | Current use |
| --- | --- |
| [`.cursor/hooks/format.sh`](../.cursor/hooks/format.sh) | Cursor adapters to the shared ops hooks. |
| [`.cursor/hooks/guard-worktree-pnpm.sh`](../.cursor/hooks/guard-worktree-pnpm.sh) | Cursor adapters to the shared ops hooks. |
