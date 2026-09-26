# Script inventory

Reviewed 2026-09-26 for #851. This covers tracked executable and support files in `scripts/`, `ops/`, and `.cursor/hooks/`, including their tests. Package commands are also emitted by the inventory command. Application modules, framework configuration and SQL migrations remain in their owning directories.

Run from a checkout with the changes staged or committed:

```sh
node ops/script-inventory.mjs > /tmp/everyfield-script-inventory.json
```

The command reads tracked files only and reports textual references, including relative extensionless imports. It never runs a script or reads untracked environment files. References include comments and historical documents; they are leads to inspect, not a call graph. Test globs and dynamically built commands can invoke a file without naming it literally. No references is not sufficient evidence for deletion.

## Removed

The four files remain recoverable from Git history before this cleanup.

| File | Evidence for removal |
| --- | --- |
| `scripts/rename-invited-as.sh` | All six old identifiers are absent from TypeScript sources. The invitation vocabulary conversion is complete. |
| `scripts/rename-user-invitation-exports.sh` | All fifteen old export identifiers are absent from TypeScript sources. The shared user-invitation API is already in place. |
| `scripts/migrate-wiki-to-db.ts` | Its required repo-root `wiki/` input was deleted after the MDX-to-database migration, recorded in commit `6f9445a`. Historical mentions in the July docs audit and article checklist describe that completed migration. |
| `scripts/extract-pdf.js` | Its fixed `product-docs/Launch-Playbook.pdf` input is absent, `pdf-parse` is not a dependency, and the extracted `product-docs/launch-playbook.md` is tracked. No caller remains. |

## Retained

Age, issue numbers and one-off names do not establish obsolescence. The proofs below still describe useful regression checks or release evidence. This inventory checks their purpose and references; it does not claim every manual proof was executed. Database writers, browser automation, paid model calls and the live feedback-to-GitHub proof were not run for this cleanup.

102 retained files, including 20 test files and the new inventory command.

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
| [`scripts/discovery-schema-delta.ts`](../scripts/discovery-schema-delta.ts) | Read-only SQL diff from an operator-selected snapshot to the current schema; reusable beyond discovery. |
| [`scripts/embed-methodology-corpus.ts`](../scripts/embed-methodology-corpus.ts) | Refresh methodology embeddings after changes to the Playbook or database wiki corpus. |
| [`scripts/evry-latency-report.ts`](../scripts/evry-latency-report.ts) | Current Evry latency fixture and model benchmark package commands. |
| [`scripts/evry-model-benchmark.ts`](../scripts/evry-model-benchmark.ts) | Current Evry latency fixture and model benchmark package commands. |
| [`scripts/export-document-catalog.ts`](../scripts/export-document-catalog.ts) | Generate document samples and inspect PDF, Word and spreadsheet exports offline. |
| [`scripts/g3-association-lifecycle.ts`](../scripts/g3-association-lifecycle.ts) | Real database regression proofs. The historical G3 name alone does not make their assertions obsolete. |
| [`scripts/g3-coach-invite-check.ts`](../scripts/g3-coach-invite-check.ts) | Capture an invitation URL for browser validation, verify the resulting account, and remove the fixture. |
| [`scripts/g3-coach-invite-cleanup.ts`](../scripts/g3-coach-invite-cleanup.ts) | Capture an invitation URL for browser validation, verify the resulting account, and remove the fixture. |
| [`scripts/g3-coach-invite.ts`](../scripts/g3-coach-invite.ts) | Capture an invitation URL for browser validation, verify the resulting account, and remove the fixture. |
| [`scripts/g3-feedback-bridge.ts`](../scripts/g3-feedback-bridge.ts) | Real database regression proofs. The historical G3 name alone does not make their assertions obsolete. |
| [`scripts/g3-followup-generation.ts`](../scripts/g3-followup-generation.ts) | Real database regression proofs. The historical G3 name alone does not make their assertions obsolete. |
| [`scripts/g3-notifications-core.ts`](../scripts/g3-notifications-core.ts) | Real database regression proofs. The historical G3 name alone does not make their assertions obsolete. |
| [`scripts/g3-oversight-model.ts`](../scripts/g3-oversight-model.ts) | Real database regression proofs. The historical G3 name alone does not make their assertions obsolete. |
| [`scripts/live-db-endpoint.ts`](../scripts/live-db-endpoint.ts) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/live-db-names.ts`](../scripts/live-db-names.ts) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/live-db-preflight.ts`](../scripts/live-db-preflight.ts) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/live-db-prepare.sh`](../scripts/live-db-prepare.sh) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/live-db-run.ts`](../scripts/live-db-run.ts) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/live-db-stack.sh`](../scripts/live-db-stack.sh) | CI/local live-test infrastructure and per-suite database isolation. |
| [`scripts/migrate-wiki-related-sections.ts`](../scripts/migrate-wiki-related-sections.ts) | Database content migrations with dry-run support. Keep the exact transformation and recovery path; completion across every database is not established by the repository. |
| [`scripts/patch-contact-info.ts`](../scripts/patch-contact-info.ts) | Repairs existing marketing contacts without reseeding or discarding approved assessments. The seed handles new rows but does not replace this repair; backfill completion is unverified. |
| [`scripts/preview-url.sh`](../scripts/preview-url.sh) | Current agent workflow utility, referenced by skills or worktree tests. |
| [`scripts/proofs/alpha-migration-baseline.mjs`](../scripts/proofs/alpha-migration-baseline.mjs) | Pinned alpha migration reconciliation evidence from PR #850; retained to reproduce that release, not as a generic current-head check. |
| [`scripts/proofs/alpha-migration-baseline.sh`](../scripts/proofs/alpha-migration-baseline.sh) | Pinned alpha migration reconciliation evidence from PR #850; retained to reproduce that release, not as a generic current-head check. |
| [`scripts/proofs/discovery-preview-294-browser.mjs`](../scripts/proofs/discovery-preview-294-browser.mjs) | Discovery browser proof, fixture controls and evidence helpers; usage lives beside the files. |
| [`scripts/proofs/discovery-preview-294-evidence.mjs`](../scripts/proofs/discovery-preview-294-evidence.mjs) | Discovery browser proof, fixture controls and evidence helpers; usage lives beside the files. |
| [`scripts/proofs/discovery-preview-294-evidence.test.mjs`](../scripts/proofs/discovery-preview-294-evidence.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/proofs/discovery-preview-294-fixture.mjs`](../scripts/proofs/discovery-preview-294-fixture.mjs) | Discovery browser proof, fixture controls and evidence helpers; usage lives beside the files. |
| [`scripts/proofs/discovery-preview-294-fixture.test.mjs`](../scripts/proofs/discovery-preview-294-fixture.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/proofs/discovery-preview-294-logout.mjs`](../scripts/proofs/discovery-preview-294-logout.mjs) | Discovery browser proof, fixture controls and evidence helpers; usage lives beside the files. |
| [`scripts/proofs/discovery-preview-294-logout.test.mjs`](../scripts/proofs/discovery-preview-294-logout.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/proofs/discovery-preview-294-mail.mjs`](../scripts/proofs/discovery-preview-294-mail.mjs) | Discovery browser proof, fixture controls and evidence helpers; usage lives beside the files. |
| [`scripts/proofs/discovery-preview-294-mail.test.mjs`](../scripts/proofs/discovery-preview-294-mail.test.mjs) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/proofs/team-leader-provenance-830.mjs`](../scripts/proofs/team-leader-provenance-830.mjs) | Native leadership and concurrent seat-removal proofs; see team-leader-provenance-native-830.md. |
| [`scripts/proofs/team-leader-provenance-races-830.mjs`](../scripts/proofs/team-leader-provenance-races-830.mjs) | Native leadership and concurrent seat-removal proofs; see team-leader-provenance-native-830.md. |
| [`scripts/proofs/team-leader-provenance-races-830.sh`](../scripts/proofs/team-leader-provenance-races-830.sh) | Native leadership and concurrent seat-removal proofs; see team-leader-provenance-native-830.md. |
| [`scripts/prove-avatar-column.sh`](../scripts/prove-avatar-column.sh) | Apply/rollback and database constraint proofs for retained versioned migrations. |
| [`scripts/prove-avatar-roundtrip.ts`](../scripts/prove-avatar-roundtrip.ts) | Behavioral proofs for storage, settings redirects, wiki tenancy, task races and own RSVP permissions. |
| [`scripts/prove-discovery-profile.mjs`](../scripts/prove-discovery-profile.mjs) | Run the discovery live suite with an owned database and local Neon endpoint. |
| [`scripts/prove-evry-audit-migration.sh`](../scripts/prove-evry-audit-migration.sh) | Apply/rollback and database constraint proofs for retained versioned migrations. |
| [`scripts/prove-evry-audit-migration.test.ts`](../scripts/prove-evry-audit-migration.test.ts) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/prove-evry-conversation-migration.sh`](../scripts/prove-evry-conversation-migration.sh) | Apply/rollback and database constraint proofs for retained versioned migrations. |
| [`scripts/prove-evry-conversation-migration.test.ts`](../scripts/prove-evry-conversation-migration.test.ts) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/prove-evry-plan-migration.sh`](../scripts/prove-evry-plan-migration.sh) | Apply/rollback and database constraint proofs for retained versioned migrations. |
| [`scripts/prove-evry-plan-migration.test.ts`](../scripts/prove-evry-plan-migration.test.ts) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/prove-picture-key-fence.sh`](../scripts/prove-picture-key-fence.sh) | Mutation proof that regression guards reject broken sharing or leaked storage keys. |
| [`scripts/prove-settings-hash.ts`](../scripts/prove-settings-hash.ts) | Behavioral proofs for storage, settings redirects, wiki tenancy, task races and own RSVP permissions. |
| [`scripts/prove-wiki-migration.mjs`](../scripts/prove-wiki-migration.mjs) | Apply/rollback and database constraint proofs for retained versioned migrations. |
| [`scripts/prove-wiki-sharing.ts`](../scripts/prove-wiki-sharing.ts) | Behavioral proofs for storage, settings redirects, wiki tenancy, task races and own RSVP permissions. |
| [`scripts/reframe-benchmark-language.ts`](../scripts/reframe-benchmark-language.ts) | Database content migrations with dry-run support. Keep the exact transformation and recovery path; completion across every database is not established by the repository. |
| [`scripts/restamp-migration.test.ts`](../scripts/restamp-migration.test.ts) | Regression test for the adjacent script or operational contract; retained with the implementation it checks. |
| [`scripts/restamp-migration.ts`](../scripts/restamp-migration.ts) | Migration diagnostics and snapshot/order repair; referenced by migration tests, commands or invariants. |
| [`scripts/run-eval-v1-pass.ts`](../scripts/run-eval-v1-pass.ts) | Re-run the phase-engine fleet against the active rubric; the filename does not freeze the rubric version. |
| [`scripts/seed-dev-db.ts`](../scripts/seed-dev-db.ts) | Recreate development, marketing, notification, evaluation or communication-template fixtures. |
| [`scripts/seed-marketing-church.ts`](../scripts/seed-marketing-church.ts) | Recreate development, marketing, notification, evaluation or communication-template fixtures. |
| [`scripts/seed-notification-feed-dev.ts`](../scripts/seed-notification-feed-dev.ts) | Recreate development, marketing, notification, evaluation or communication-template fixtures. |
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

The `scripts/proofs/*.test.mjs` files are retained with their proof helpers. The current package test globs include `scripts/**/*.test.ts` and `ops/**/*.test.mjs`, so these proof `.mjs` tests require an explicit `node --test scripts/proofs/*.test.mjs` invocation.

All package commands are retained. Database setup, seeds, model evaluation and G3 commands still target existing tools. The `db:push` command remains subject to the repository prohibition on using it for migrations. No dependency or workflow configuration changed.
