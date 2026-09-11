# Parallel implementation contract

Implement the accepted catalog in `catalog.mjs` and `README.md`. Read repository AGENTS.md, memory/invariants.md and the matching domain invariants before edits. Preserve all approved chat UI, current domain permissions, exact-plan confirmation, idempotency, and application exclusions. No phrase-matching gate for ordinary model requests.

## Ownership

The coordinator alone edits production.ts, model-conversation.ts, model-turn.ts, action preparation, recipes, shared contracts, package dependencies, generated inventories and this directory. Workers publish separate files under `src/lib/evry/capabilities/queries/` plus their own tests. No worker commits, resets, pushes, starts servers or modifies other workers' files. Request a shared change from the coordinator. All work stays in `/Users/sebastian/dev/everyfield_v2-worktrees/evry-recipe-reuse`, not the main checkout.

- people worker: `queries/people*.ts`, including tests. Exports `PEOPLE_QUERY_READS` from `queries/people.ts`.
- operations worker: `queries/operations*.ts`, including tests. Exports `OPERATIONS_QUERY_READS` from `queries/operations.ts`.
- content worker: `queries/content*.ts`, including tests. Exports `CONTENT_QUERY_READS` from `queries/content.ts`.

## Interface

Export readonly arrays of existing `EvryReadRegistration`, built with `defineEvryReadRegistration`. Use the proposed public IDs, binding each to an existing authoritative read capabilityIdentity in its family; report those bindings explicitly. Reuse `buildEvryReadArtifact` and existing artifact contracts so current UI remains intact. Inputs are strict Zod schemas, no tenant/actor/asOf supplied by the model. Use context.authorization.actor and context.now. Get-many accepts 1..50 IDs. Lists paginate with stable order; count/group run over the whole filtered set. Unsupported filters fail schema validation rather than disappearing.

Prefer existing domain services. Where their read interface cannot express a bulk query, write a tenant-scoped database reader in your owned module using Drizzle and allowlisted fields. Filter/aggregate in the database before pagination. Do not load an entire plant into memory or implement N+1 model queries. Bound result facts/content and expose completeness honestly. No arbitrary SQL, table/column names, URLs or filesystem paths from the model.

Use typed resource/mode variants for history and domain-specific query variants. Support AND/OR where the catalog requires it with explicit typed filters, not an unrestricted filter DSL. Missing records, unknown evidence and failed reads are distinct. Foreign IDs and unknown IDs must not reveal different existence information. Author/account IDs and person IDs are different; use actual relations.

## Verification and handoff

Implement working readers, not just names/schemas or empty adapters. Test representative catalog cases, negative predicates, multi-ID lookups, date boundaries, duplicate history rows, count-vs-page semantics, authorization scope and unsupported inputs. Use provider-free fixtures/mocks plus SQL-shape assertions where useful; do not call paid models, seed the shared database, send email or execute real user actions. Never pnpm format; targeted formatting is allowed. Tests can run with placeholder DATABASE_URL and RESEND_API_KEY, no env secrets printed.

Report files, exact tool IDs, test commands/results, existing capability bindings and concrete remaining gaps. A schema-only contract, truncated whole-cohort query, unexecuted adapter or guessed data source is not complete. Ask the coordinator for dependency changes instead of editing package files. The coordinator integrates and performs cross-domain and runtime proof.
