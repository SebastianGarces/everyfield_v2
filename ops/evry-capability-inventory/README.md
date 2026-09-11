# Evry capability inventory

This is a proposed question and tool inventory for #758, not a declaration of feature completion. Source inspection is pinned to `a14cdbe870da4b16f9bd2fc1f61221e713c65e02`. The feature board was read on September 10, 2026. Every question has `evaluation: not_run`.

## Checking the implementation against this proposal

The saved HTML and `current-tools.json` above are the original proposal baseline, not a live registry view. To check the implementation in your current checkout without a model call:

```sh
DATABASE_URL=postgresql://ci:ci@localhost:5432/ci RESEND_API_KEY=re_ci_placeholder pnpm exec tsx scripts/evry-capability-coverage.ts --summary
```

The audit fails if a proposed query contract is not registered with its expected authorization and schema, if read identities conflict, if a read is wired to an effect executor, or if the eight recipe entries are not present. It also reports typed preparation counts and the size of the compact model catalog. Full schemas are discovered on demand, rather than sent on every model turn. Registration is not evidence that a natural-language question passed an evaluation.

The seven read workflows are daily work, interview review, meeting follow-up, staffing review, launch review, delivery recovery review, and import review. The eighth is the existing confirmed meeting/invitation workflow, now also reachable through typed preparation. Read workflows do not send messages or mutate records; a requested change must still pass through a fresh, confirmed plan.

Provider-free regression tests are in `src/lib/evry/capabilities/queries/`, `preparations/`, `model-conversation.test.ts`, `recipes/read-workflows.test.ts`, and `artifacts/read-result-mode.test.ts`. The query test files include opt-in PostgreSQL fixtures derived from the application schema. They must run only against the dedicated disposable `evry-758-people-query-proof` container, never the shared development database. Set `EVRY_PEOPLE_PROOF_CONTAINER`, `EVRY_OPERATIONS_SQL_CONTAINER`, and `EVRY_CONTENT_SQL_CONTAINER` to that container name to include those cases.

Deliberate limits remain explicit in the contracts: People import inspection supports CSV; PDF extraction requires a text layer and does not perform OCR; generated document content has byte/page/chunk limits; failed-delivery review cannot use the existing non-opener resend operation to retry failed or bounced recipients. Follow-up history means recorded completed person-linked follow-up tasks, not proof of a particular meeting's personal contact. The turn work budget stops further dispatch after its thresholds; it is not a hard cancellation of an in-flight database or provider request and is not a dollar-cost cap. Existing bounded model evidence projections remain in place.

## Rebuild without model calls

From the consolidated feature worktree:

```sh
DATABASE_URL=postgresql://ci:ci@localhost:5432/ci RESEND_API_KEY=re_ci_placeholder pnpm exec tsx scripts/evry-capability-coverage.ts > /tmp/evry-current-tools.json
node ops/evry-capability-inventory/build.mjs --audit /tmp/evry-current-tools.json
node ops/evry-capability-inventory/build.mjs --check
```

The first command imports the production registry with placeholder configuration. It does not query a database or call a model. The builder validates the corpus and snapshots the audit into this directory. It generates `.lavish/evry-capability-inventory.html` and `.lavish/evry-capability-inventory.json`. Rebuilding from the saved snapshot does not refresh evidence about a newer production registry. Supply a fresh audit when assessing a new revision and update the revision in `catalog.mjs` after inspection.

`catalog.mjs` is the editable question corpus, proposed tool catalog and recipe shortlist. `current-tools.json` is the source-contract snapshot, including JSON Schemas. `build.mjs` is the reusable validation and report generator. No production chat, database, seed or deployment changes are made by these files.

## What the source inspection establishes

- The production registry exposes 79 model reads and 115 confirmed-effect handlers across 12 supported families. Counts alone do not prove useful filtering, reliable routing, confirmation correctness or UI parity.
- `people.list` has name/search, stage, source, tags and cursor. Interview, assessment and commitment reads take one person ID. Bulk historical predicates are missing from that list contract.
- Tasks already expose due-date, assignee, status, priority and category filters. Preserve and evaluate these instead of rebuilding them from scratch.
- Meetings expose status, type, team and paging, but not a general date-range input. Related attendance is summarized in detail responses instead of exposed as a bulk relational query.
- Team readers have detail, health and training views, but broad cross-team role/people/training predicates are absent from their model contracts.
- Generated document reads return metadata and download links, not extracted file content. A content-comparison question requires a new supported extraction path, not a stronger prompt.
- Wiki article reads expose chunks of 500 code units. `model-conversation.ts` permits four sequential reads. Collection lookup followed by per-record inspection or long-article retrieval exhausts that budget quickly.
- The production reuse registry explicitly lists the meeting-invitation reference recipe. The other recipes in this inventory are proposals.
- #758 excludes Settings, account-seat management, coaching/oversight tenancy, sessionless work, autonomous initiation and spiritual counsel. These remain boundary cases. Financial Tracking is deferred in #114, and Facility Management was cut in #113. Existing meeting locations are still in scope.

## Recommended query design

Use domain-specific typed queries built on the application's existing services and authorization. The model chooses filters and evidence needed to answer the question. It does not write SQL, select a tenant, invent joins or run an unbounded database scan.

The proposed names in the report describe target contracts, not a demand to rename every working reader. Extend working reads and consolidate duplicate adapters when the replacement is ready. Existing deterministic authorization, schemas, confirmation and execution rules stay. Deterministic phrase routing must not decide which ordinary questions can be answered.

### Shared contract

Each domain query has an explicitly validated resource kind and a discriminated mode: `list`, `count`, or `group`. Only modes the domain implements appear in its schema. A count query does not accept a cursor. A get-many query takes one to fifty known IDs of one resource kind; a one-record lookup is the same contract with one ID. The proposed bounded content readers accept at most five documents or articles at a time. These are initial engineering limits to measure, not product guarantees.

List inputs carry approved filters, named sort fields, safe projections and a bounded page size, initially at most 50. Filter expressions support AND/OR, typed equality/range/membership and registered `exists`/`notExists` relationships. Relation depth is initially limited to two. Group queries accept only allowlisted dimensions and measures with explicit distinct-count semantics. The server rejects unsupported predicates; it never silently drops one.

Identity lookup and bulk selection are different operations. Search returns candidate IDs with distinguishing labels. Get-many hydrates known IDs. A bulk query selects a whole cohort by predicates without first enumerating every person in the model. Interview, assessment, commitment, note, attendance and training queries accept person IDs or a validated cohort from a related query. No N+1 model-call loop is needed.

Results include structured rows, source references, applied filters, `asOf`, coverage/completeness, total semantics and continuation. A stable, expiring, actor-bound result reference may represent a large cohort for a later authorized query or action plan; it must retain predicates, not silently freeze stale membership. Display pages and evidence pages are separate. The UI can show five rows and a count while the model receives a bounded evidence summary for the whole filtered population.

Counts are computed after filters and before pagination in the database. `total` is either exact, estimated with a clear label, or unavailable. A page length is never presented as the total. Sort and cursor use the same stable ordering with an ID tie-breaker. Cohort predicates and authorization are applied to every continuation.

Single-record absence and foreign IDs both return unavailable without revealing tenant membership. Bulk results preserve an unavailable result for each requested ID without exposing why a foreign record is missing. Projection allowlists keep private storage keys and unauthorized fields out of model context. Unknown, absent and failed are distinct result states.

### Relationships that need explicit domain meaning

| Question concept | Evidence contract |
|---|---|
| Interviewed | A qualifying interview record. Current People stage alone is not proof of history. |
| Received follow-up | Named recorded event types agreed with the app's follow-up service. Planned tasks, completed tasks, meeting follow-up completion, note mentions and email delivery are distinct evidence; state which definition the query used. |
| Attended | Actual recorded attendance for qualifying meetings. RSVP or guest-list membership is not attendance. |
| Needs training | The person's current role has a recorded requirement with no matching completion. No requirement is not a missing completion. |
| Unstaffed | Open required slots, not simply team size minus member count. Count people, assignments and slots separately. |
| My tasks | Authenticated account assignment. Person and account IDs require the real account-person link. |
| Today | Plant-local calendar date by default for task questions; use the existing date resolver. Never include overdue work unless asked. |
| No document evidence | No extracted readable content, not proof that an authorized stored file is empty. |

### Composition and response behavior

Replace the four-read ceiling with a measured per-turn work budget, not an unlimited loop. Initial experiment: up to eight read decisions, a bounded row/token budget, a wall-clock deadline and a provider-cost cap. Batch within each query and run independent reads concurrently after authorization. Detect repeated equivalent calls and lack of progress. Do not increase budgets to conceal a missing bulk query. Choose final limits from traces before release.

The model can ask a follow-up when identity or consequential intent is genuinely ambiguous. It should proceed with a stated reasonable interpretation for a safe read when useful, rather than ask the user to know the database filters. Multi-turn refinements preserve prior constraints unless explicitly replaced. Every new turn reauthorizes and refreshes relevant facts; persisted old chat cards are historical evidence, not current truth.

Answer composition remains flexible: explanation, evidence cards, comparison and a next step when useful. A simple lookup may need one sentence; a cohort recommendation needs its selection criteria and limitations. Only retrieved evidence supports claims. Keep current streaming, compact lists and panel/full-page continuity. Tool events and trace IDs belong in observability, not raw database attributes in the chat.

### Actions and recipes

`actions.prepare` represents model-facing preparation of existing typed, permitted effects. It is not a universal write escape hatch. The confirmation control, not the model, invokes the existing executor with an actor-bound, expiring plan reference and idempotency key. At execution, reauthorize, revalidate target versions and exact content, and require renewed review on meaningful drift. Never auto-confirm. Read questions never acquire write intent from a recipe.

Use a recipe when the workflow is repeated, multi-step and stable, or has shared consequential failure/retry handling. A recipe accepts structured intent and adjustable criteria; it must not depend on an exact phrase. Ordinary searches, counts, comparisons and one-off joins stay with composable tools. The recipe catalog proposes eight workflows, but only meeting invitations need immediate recipe work alongside P0 query improvements. Validate demand before implementing the others.

## Priority and delivery sequence

Priority is a judgment combining likely use, user impact, reuse across questions, prerequisite relationships and safety. It is not a synthetic numerical score. Low-frequency authorization and duplicate-send cases are release blockers.

1. **P0: query correctness and evidence.** Preserve working task filters; add people/history/attendance bulk predicates, meeting dates, get-many, count semantics and source evidence. Prove the reported interview and due-today questions plus negative and pagination fixtures. Keep the current UI unchanged.
2. **P0: orchestration and action entry.** Replace phrase-only preparation with model-selected typed operations; add bounded multi-read planning, meaningful continuation and exact-plan execution integration. Prove no writes before confirmation and no duplicate effects on retry.
3. **P1: breadth using the same contracts.** Ministry roles/training, communications, launch, stored intelligence, wiki retrieval, document metadata and notifications. Reuse domain services; expose every needed relation rather than create a question-specific recipe.
4. **P1/P2: retrieval and proven recipes.** Add supported generated-document content extraction, improve wiki evidence chunks, then implement recipe candidates supported by actual demand. Historical comparisons that lack stored snapshots remain honest limitations until persistence is explicitly added.
5. **Release evidence for #758.** Reconcile every in-scope route/action with the existing parity inventory, exact-plan/executor/eval coverage and migration/recovery gates. This question corpus supplements that audit; it does not replace the FRD or close #758 by itself.

## Evaluation without surprise spend

### Stage A, free and deterministic

This inventory builder checks unique IDs, complete domain coverage, valid tool and recipe references, current registration references, source paths and evaluation labels. This only proves inventory integrity.

Next, create a fixed-clock fixture dataset with expected IDs/counts for each query. Include empty/1/5/6/24/25/50/51/200 records, multiple matching history rows, duplicate names, mixed memberships, records on later pages, NULL dates, boundary times, foreign IDs and insufficient permissions. Include known-unavailable historical snapshots and unreadable files. Deterministic reference queries establish expected results independently of the new tool implementation. Do not invent expected live data from the model response.

For every action fixture, assert exact plan, zero effects before confirmation, fresh permission checks, content/recipient stability and retry idempotency. Use fake outbound delivery and provider adapters. No emails to real contacts, real imports or production mutations are needed.

### Stage B, small paid smoke only after a spend decision

Select 16 cases spanning all query shapes, the reported task/interview failures, cross-feature reads, a wiki comparison, one confirmed-action preparation and safety boundaries. Run one candidate model, one attempt per case initially. Estimate input/output tokens and maximum total calls, including planning/composition/retries, then obtain a run budget. The earlier $9.94 balance is not assumed current and is not consumed by this planning task.

The proposed first smoke is checked in as `smokeCaseIds`: people-01, people-02, interviews-01, tasks-01, tasks-05, cross-01, wiki-03, meetings-08, edges-03, edges-04, edges-05, cross-04, edges-12, documents-04, teams-04 and training-01. Run only after the corresponding tool/fixture work is ready. Unimplemented content retrieval must be reported as a gap, not counted as a passed document comparison.

Score factual set/count correctness, filter retention, relation semantics, source support, unnecessary clarification, permission adherence, no unintended effects and response usefulness. Accept multiple valid tool sequences; do not require a golden exact phrase or exact call order. Measure first visible status separately from first grounded text token, total latency, tool/DB work and total provider cost.

### Stage C, expanded regression

After tool correctness and the small smoke pass, run this corpus plus paraphrases, multi-turn variants, long-history and navigation/reconnect scenarios. Use a held-out set and seeded evaluation fixtures. Set acceptance thresholds before comparing models. Every safety case must pass; a high average cannot hide cross-tenant access, unsupported claims or duplicate sends. Report failures by domain and operation, not just an overall percentage.

### Observe real demand before promoting recipes

With appropriate privacy controls, classify actual user turns by intent, query shape and selected tools. Review aggregate frequency, completion rate, retries, clarification burden and cost per successful task. Avoid retaining unnecessary people notes or sensitive content in analytics. Promote a recipe when repeated successful tool sequences save meaningful latency/cost or simplify a recurring confirmed workflow. Label the initial high/medium/low judgments as provisional until this evidence exists.

## Scope decisions already made

- Recommend composable domain tools plus a small recipe catalog, not one recipe per question and not raw SQL access.
- Preserve current product exclusions. Settings deep links are allowed; reading or changing settings through Evry is not.
- Keep all production work on the consolidated branch and preserve approved UI polish.
- This pass adds planning artifacts only. No runtime feature changes, paid evaluations, seeds, new issues, deployments, PR edits or merges.

## Evidence

The report links source files at the pinned revision. Runtime tool inputs come from the actual production registry snapshot, not hand-entered counts. Board scope was verified at [#758](https://github.com/SebastianGarces/everyfield_v2/issues/758), [#114](https://github.com/SebastianGarces/everyfield_v2/issues/114), and [#113](https://github.com/SebastianGarces/everyfield_v2/issues/113). Demand estimates, proposed names, budgets and delivery priority are recommendations, not measured findings.
