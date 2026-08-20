# Decision Ledger

The single home for dated product and canon decisions. One rule set:

- **Every ruling lands here, once**, as a dated row keyed by its issue/PR number, with the
  decision and its consequence. Rationale worth keeping travels in the row.
- **FRDs absorb a ruling by becoming correct** — the requirement text is updated to the ruled
  end state (with at most a one-line *why*). Ruling dates, issue numbers, supersession chains,
  and status banners do not go into FRDs (`product-docs/product-values.md` §What this means
  for FRDs).
- **`product-brief.md` §Resolved Decisions** carries only decisions that change product canon,
  and each of its rows cites the issue number recorded here, so the two reconcile mechanically.
- **Settled rows are not re-litigated.** A new ruling supersedes by adding a new dated row —
  never by editing or deleting an old one. Challenges go through a spec-question hold
  (`ops/agent-os/README.md` § Rulings).
- The enforcement form of a ruling — the one-liner an agent must not silently break — lives in
  `memory/invariants.md`, tagged ⚖ and pointing back at the issue recorded here.

History: the ledger began as §4 of `docs-audit-2026-07.md` (the 2026-07-26 audit's 19
decisions) and was appended to through 2026-08-09 before moving here on 2026-08-10.

## The ledger

All 19 queue items were worked through with the planter. **These are settled — do not re-litigate
them in a future audit.** Three were converted into action items (evidence:
`docs-audit-2026-07.md` §5) because they needed evidence before they could be ruled on.

### Direction / roadmap

| # | Decision | Consequence |
|---|----------|-------------|
| 1 | **F6 — PR the branch through CI + the DoD.** Not a raw merge. | `feat/document-templates` merges clean (6 commits, 30 files, all-new paths, 0 conflict hunks). It predates every gate, so it goes through them rather than around them. |
| 2 | **F7 financial — deferred.** | Dated deferred banner on the FRD. Readiness stays attestation-only via the phase engine, as shipped. |
| 3 | **F10 facility — cut entirely.** | Off the roadmap, not deferred. FRD marked cut; its 26 requirements stop appearing as gaps. |
| 4 | **F4 — fold surviving requirements into the phase-engine FRD.** Retire F4 as a separate feature doc. | Not a deletion: the progress-dashboard *presentation* ideas (D-002 exit criteria, D-005 CSF scorecard, D-016 wiki links, D-017 drill-down) are judged useful and move across as display requirements on the phase engine, whose current presentation is the weaker half. |
| 6 | **Wiki — cut the video library (W-019). Keep templates/downloads. Keep the search-results page.** | Video is far-future own-content territory. Templates/downloads is wanted and pairs with F6: the catalog ships the documents, wiki articles explain which to use when. The Cmd+K palette does find-and-jump; a results page supports browsing a growing logistics section. |
| 7 | **SMS (COM-011) + scheduled send (COM-014) — keep, post-beta.** | Deferred banner, not a cut. |
| 9 | **T-020 phase-triggered task templates — keep.** | Rationale: *insights advise, tasks commit.* An insight is a suggestion; a task is tracked work. The two are complementary, not competing. |
| 13 | **People CRM P-021/P-022 — un-defer and build.** | The "blocked by F8" rationale is stale; F8 shipped and `getPersonTeams` + `getPersonTeamsAction` already exist. Frontend-only unit. |

### Canon

| # | Decision | Consequence |
|---|----------|-------------|
| 5 | **Add a `wiki` privacy toggle. Communication stays private.** | The shipped role model already answers most of this — see the note below. Needs a new `church_privacy_settings` column → migration → `risk:high`. |
| 8 | **Polymorphic Note stays the target.** | Per-entity `notes` columns (5 meeting tables, people, the four 4C fields) are interim, not canon. FRD keeps the unified Note entity. |
| 11 | **Delete the dead invitation subtree.** | Verified dead transitively: `invitation-tracker.tsx` has zero importers, and `invitation-leaderboard` + `createInvitationAction` are imported only by it. Remove the components and actions. **The `invitations` table is left in place** — dropping it is a migration for no user-visible benefit; fold it into a future high-risk unit if one comes along. |
| 12a | **Team-leader scoping.** | Planter + the team's designated leader may mutate; other members read-only. Builds on the `isLeadershipRole` flag already in the schema. See the security note below. |
| 15 | **F6 code-defined catalog is canon.** | Answered by the branch itself: `DOCUMENT_TEMPLATES` + `getTemplateById`, **zero schema changes**. DB-backed template tables are off the table. Also means F6 is not `risk:high`. |
| 16 | **NFR-PE-4 disclosure ships with the beta toggle flip.** | Keeps NFR-PE-4b (flip OpenAI sharing off) and 4c (write the disclosure) together, since the text changes when the posture does. `/phase` is the permanent home — settled by #4 folding F4 into the phase engine. |
| 17 | **Add ministry-team rosters to the recipient quick-select (COM-009).** | F8 shipped with rosters, so "message this team" is a natural ask. The picker already exists with status groups (`src/components/communication/recipient-picker.tsx:25`); the work is resolving `team:<id>` in `getRecipientsByGroup`. Tracked in issue #18. |

### Doc mechanics

| # | Decision |
|---|----------|
| 18 | **Archive the `wiki-articles` skill** until an authoring path exists. |
| 19 | **Extract memory maintenance from `work-in-progress`, retire the rest**, and re-point `.agents/memory-first.md`. |

### Where these land on the board

Most of the buildable outcomes were **already queued** before this audit — the decisions settle the
spec they build to, they don't create new work. Check the board before filing.

| Decision | Issue |
|----------|-------|
| #12a team-leader scoping | **#22** (`risk:high`) — derives leadership from `MinistryTeam.leader_id`; note there is no `team_leader` user role |
| #13 Teams tab | **#14** — replaces the placeholder at `people/[id]/teams/page.tsx:28-56` |
| #17 team rosters in quick-select | **#18** — resolves `team:<id>` in `getRecipientsByGroup` |
| #5 wiki privacy toggle | **#62** (`risk:high`) — new, no prior issue |
| #11 dead invitation subtree | **#63** — new, no prior issue |
| #10 divergence 4 (VM-006 roster auto-population) | **#19** — already queued as a build, so that divergence is a known gap rather than an open canon question |

### Two notes worth keeping

**"Coach" is a ubiquitous-language failure, not a missing feature.** The FRDs use "coach" loosely to
mean *whoever oversees a plant*. The shipped model is more precise, and already complete:

| Role | Sees |
|------|------|
| `planter` / `team_member` | own church |
| `coach` | plants via `coach_assignments` |
| `sending_church_admin` | plants where `sending_church_id` matches |
| `network_admin` | plants where `sending_network_id` matches |

`church_privacy_settings` then gates *what* they see, per feature: `sharePeople`, `shareMeetings`,
`shareTasks`, `shareFinancials`, `shareMinistryTeams`, `shareFacilities`. Wiki and communication have
no column, which is why #5 was a real decision rather than a doc fix. `/oversight` already ships plant
health, insight urgency and multi-plant comparison, so D-018's "coach dashboard" is substantially
delivered under a different name. **FRD wording should use the real role names.** This is the clearest
argument yet for a root `CONTEXT.md` glossary.

**#12a was never a decision.** Ministry-team server actions check only session + `churchId`, so any
authenticated user in a church can mutate any team. That is a live multi-tenant authorization hole,
filed as `risk:high` independently of what the FRD says.

### Resolved 2026-07-27 — the three holdouts (evidence: `docs-audit-2026-07.md` §5)

| # | Decision | Consequence |
|---|----------|-------------|
| 10.2 | **Follow-up tasks for first-time attendees only** (issue #96). Returning attendees are already in the pipeline; committed core group needs no 48-hour touch. | Matches the methodology's first-48-hours emphasis and the FRD's original wording. Changes shipped behaviour (today: every attendee, due finalization + 2 days) → build issue filed; the follow-up completion signal in the fact snapshot becomes *first-time follow-up rate* and its interpretation note must say so. The planter evaluation task is unchanged. |
| 12b | **Team-level training is canon** (issue #85). MT-011 reworded from per-role to per-team; no migration. | Already shipped and working across MT-012/MT-016/MT-017. A church plant's teams are small — per-role granularity is premature. Revisit only if real usage demands it (that would be the `risk:high` join-table migration). |
| 14 | **Shipped `wiki_articles` model is canon** (issue #112). FK section, slug relations, and the `overview`/`guide` content types all stand; `parent_article_id` is dropped from the FRD. **`related_template_ids` stays a build target** for W-010 (#73). | FRD data model rewritten to match the schema. Longer-term: sending networks and sending churches should be able to modify the wiki their planters see — that is a discovery session, filed as a `needs-spec` issue, not a schema tweak now. |

### Resolved 2026-07-27 — the alpha release decisions (#192, #193)

| # | Decision | Consequence |
|---|----------|-------------|
| 192 | **No payments in alpha.** The alpha cohort is **free while the early-access (alpha/beta) period lasts**; terms at general launch TBD. **The sending org pays, per plant** — entitlements attach to the org, seats flow to plants. Price point deferred to beta (comps logged in the issue). | ToS states free access "during the early access period" (#189 unblocked). Landing page (#188) makes no price claim. Billing/entitlements FRD is post-alpha work — filed as `needs-spec` **#213** on the Beta milestone. The Feb 3 model shape (Free = Wiki + Phase 0; Paid = create a church) stands. |
| 193 | **Alpha cohort: Brett & Bryan pick, ~10–15 planters, no hard cap** — the invite gate is control enough. **The end-to-end demo story is THE alpha exit condition, as written** in the plan of record. **Success criteria:** 3+ planters active weekly after 4 weeks; 1+ network admin checking `/oversight` unprompted; qualitative "would you tell another planter" yes. **Alpha and Beta stay separate milestones** — Beta is the parking lot for deferred scope. | The milestone has a concrete exit condition, not a vibe. The proposed out-of-alpha list in `alpha-release-2026-07.md` §4 stands as ruled. Feedback flows through the #190 bridge; Sebastian talks to the humans. |

### Resolved 2026-08-03 — oversight discovery (#186) and the association permission rulings (#274)

| # | Decision | Consequence |
|---|----------|-------------|
| 186 | **The oversight build-out is ruled and specced** (full discovery session): `/oversight/plants` = directory + per-plant detail with privacy-gated aggregate sections and explain-why empty states; planter gets a settings association area (accept/decline/leave) + a persistent dashboard reminder while an invitation is unanswered; decline notifies the inviting org; **disassociation works from both sides** (planter from settings, admin from plant detail), type-to-confirm, other side notified; a minimal expand-only `association_events` audit table records accept + both severing paths (risk:high); `/oversight/sending-churches` ships as a network-admin roster; **`/oversight/settings` is dropped from alpha** (org/admin management waits for #185). The broken register `invitationId` path was folded into #23, and #23 gained a blocked-by edge on #265 (the lockdown reshapes `service.ts` before UI builds on it). | FRD written: `product-docs/features/oversight/frd.md` (OV-001…OV-011). #186 converts from `needs-spec` to the feature parent; requirement sub-issues OV-001…OV-009 filed as queued units with dependency edges (severing + accept surfaces wait on #265 and on the audit table). |
| 274 | **(a) Planter only** may accept an invitation and bind the plant to an oversight org — ratifies #265's narrowing; same plant-level rule as the sharing toggle. **(b) Severing: both sides** — the plant's planter or the org's admin, each from their own surface, type-to-confirm, other side notified. An association created in error now has a repair path. | #274 closed with the ruling; behavior canon lives in the oversight FRD (OV-007, OV-010). #265's re-spec keeps the disassociate primitives out of the `"use server"` surface but must NOT treat them as dead — authenticated wrappers arrive with the OV units. |

### Resolved 2026-08-04 — Launch Sunday entity (#271)

| # | Decision | Consequence |
|---|----------|-------------|
| 271 | **Launch becomes a first-class entity** (full discovery): one live `launches` row per church (target date, status `planning/scheduled/completed/postponed`, outcome fields) + a date-change journal; **`churches.launch_date` is DROPPED, not mirrored** — the entity is the only owner and every reader (PE countdown, oversight health, launch-date milestone event, settings edits) migrates in one slice, with a dev-DB wipe/reseed accepted (no users yet); readiness = **hybrid**: fixed Playbook-derived milestone rows (operations / launch-team prep / promotion) each linking `launch_prep` tasks; **outcome lives on the launch row** (attendance, decisions, notes, capture-the-day) — no meeting row, the vision-meeting stand-in ends; surface = dedicated `/launch` page + dashboard countdown card; planter-only schedule/postpone/outcome; launch facts join the PE snapshot but completing a launch does NOT auto-advance phase. | FRD written: `product-docs/features/launch/frd.md` (LS-001…LS-009). #271 converts to feature parent with three units (schema+reader-migration risk:high → page → outcome/PE). Post-launch **Services** direction (Service meeting type vs light Services entity, the not-a-ChMS boundary, oversight-data-without-enforcement thesis) deliberately parked as its own `needs-spec` discovery issue. #187 notified: launch-date edits go through the launch entity. |

### Resolved 2026-08-04 — crawler preview polish (#292)

| # | Decision | Consequence |
|---|----------|-------------|
| 292 | **(a) `/dashboard` comes OFF `CRAWLER_PREVIEWABLE_ROUTE_PREFIXES`.** The list's contract is "listed ⇒ renders session-free"; `/dashboard` needs a session and 500s for crawlers, so shared dashboard links will preview as the login page instead — honest and clean. No session-free metadata shell is built. **(b) The `whatsapp` UA token is TIGHTENED** to match only WhatsApp's preview-fetcher (UA `WhatsApp/2.x`), not its in-app browser, so a human tapping a shared `/wiki` link inside WhatsApp gets the real page instead of the bare metadata shell. | One build unit against `src/lib/crawler.ts` + `proxy.test.ts` (both halves touch the same files): #297. #292 closed with the ruling. |

### Resolved 2026-08-09 — the #304/#306 retry blocks: audit subject shape (#351), re-declaration semantics

| # | Decision | Consequence |
|---|----------|-------------|
| 351 | **(a) `association_events` gets a discriminated subject**: `subject_type` (`church` \| `sending_church`) with per-subject nullable FKs and a CHECK that exactly one subject is set — `church_id` stops being NOT NULL, disambiguated by the discriminator, so "null church_id = global content" is never ambiguous here. **(b) The notifications rail is generalized the same way**: the recipient anchor becomes exactly-one-of church / sending church / network under a discriminator + CHECK, on the one existing table. Chosen for the long term (criterion set by Sebastian) over a parallel org-notifications table (duplicates dispatch/preference/read-state machinery) and over leaving org-only milestones off the rail; "a sending church joined your network" rides the same rail as every other milestone. **(c) Sever symmetry ships now**: a sending-church admin gets a Leave-network control (type-to-confirm, audited, network notified) in the same change. **(d) Scope: in-track on #304** — migrations land in the track worktree with HR1–HR3 evidence, and `scripts/g3-association-lifecycle.ts` §7 flips from asserting absence to asserting presence. | #351 closed with the ruling. #304's WS3 AC stands as written and becomes buildable; FRD gains OV-012/OV-013 and the generalized shapes; the `memory/invariants` multi-tenancy lines are updated by the implementing track. |
| 306 | **A second initial-stage declaration is REFUSED with a message** (not overwritten). The UI names the already-recorded stage, points at where to change it, and confirms the launch date DID save — the silent half-applied success is the defect. Matches the partial unique index migration 0033 already shipped on the branch. | #306 retry unblocked; the remaining HR4 fix set (kind-aware digest/milestone filtering, teams-init unique index, "No date yet" re-entry, distinct resume-path screenshot, report corrections) is mechanical per the exit comment. |

### Recorded 2026-08-10 — rulings previously held only in memory/invariants, FRD banners, or PR threads

Backfilled when the ledger moved here, so every standing ⚖ ruling has a row. The rulings
themselves are older; each row carries its original date.

| # | Decision | Consequence |
|---|----------|-------------|
| 90 | **Completing every subtask does NOT complete the parent task.** *Every item is ticked* and *this work is finished* are different claims; only the planter makes the second. | Deliberately no auto-complete code path; the UI says so and points at the Complete button. Enforcement line in `memory/invariants.md` (Tasks). |
| 370 | **A subtask is a checklist item, not a task** (2026-08-08): task counts exclude subtasks everywhere (badges mirror the list); a new subtask inherits its parent's assignee as a default, not a lock; a recurring task's checklist is part of its template — the successor copies every item unticked. Per-item carry-over was rejected. | `topLevelTasksOnly()` shared by list + counts, pinned by `subtasks.test.ts`; checklist progress reported separately. |
| PR&nbsp;371 | **Resend-to-non-openers policy** (2026-08-09): offered only after a 24h cooldown from `sent_at` AND at least one confirmed delivery; `bounced` and `failed` are both unreachable and never retried; **"delivery rate" names exactly one figure** (delivered/attempted, church-wide overview only) and a zero-denominator rate renders as unknown, never 0%. | `evaluateResendEligibility` is the single gate, re-checked server-side. Enforcement lines in `memory/invariants.md` (Communication). |
| 224/225 | **Oversight push is digest + three milestones only** (ruled 2026-07-27 at standup, superseding the earlier per-category model; amended 2026-08-01: dispatcher-scheduled digest, invitation-accepted exempt from the toggle as the org's own event). Single gate: `share_activity_with_oversight`, default off. | N-025/N-026/N-028 state the end state; the notifications FRD's stacked ruling banners collapse into this row (2026-08-10 cleanup). |
| 254&nbsp;ext | **A category an audience cannot receive is never offered to it** (2026-08-09), and the ruled presentation is shown-and-labelled: rows visible, switches inert, reason stated once and visibly — never tooltip-only. | Settings screen and action both derive from `OVERSIGHT_ELIGIBLE_CATEGORIES`; no second list. |
| PR&nbsp;354 | **What earns a route crawler-previewability** (2026-08-09): it renders with no session AND that render is the page, not a redirect. `/oversight` came off the list (redirects); `/dashboard` came off earlier (#297, 500s). Both stay protected explicitly, never via the spread of the previewable list. | `isCrawlerPreviewRequest` over `/wiki` only; pinned by `proxy.test.ts`. |
| 309 | **Notification cadence is not pinned by defaults** (2026-08-09): stop writing cadence defaults at preference-create; the inert oversight cadence control is retired rather than shipped disabled; failed preference saves surface to the user. | Shipped in PR #369. |
| seed&nbsp;guard | **The dev-seed wipe refuses to run against a database holding an alpha-cohort sentinel account** unless `--allow-protected-db` is passed (2026-08-09). Detection is positive (sentinel rows), never connection-string heuristics, which fail open. | `src/lib/dev-seed/protected-database.ts`; wipe order derived from `pg_constraint`; wiki corpus protected and never walked through. |

### Resolved 2026-08-10 — which contrast standard binds `--muted-foreground` (#386), and what darkening it costs (PR #387)

| # | Decision | Consequence |
|---|----------|-------------|
| 386 | **WCAG AA (4.5:1) binds `--muted-foreground`; APCA is advisory.** The token measures APCA Lc 68.2 on `--muted`, under the Lc 75 body-text guidance, and ships anyway: AA is the conformance target the product commits to, and APCA is still a draft that no obligation points at. Advisory means it may inform a future token move — never justify lightening one that clears AA. | #386 closed. Enforcement line in `memory/invariants.md` (Design Tokens — Contrast), tagged ⚖; `src/app/text-contrast.test.ts` continues to assert AA on all eight surfaces in both themes and nothing asserts an APCA floor. |
| PR&nbsp;387 | **The SC 1.4.1 cost of darkening is paid in CSS, not by capping the token — on every surface the product ships, marketing included.** Darkening `--muted-foreground` converges it on `--primary`, so an inline link in muted prose fell to 2.85:1 (light) / 2.06:1 (dark) against its surrounding text — under the 3:1 WCAG SC 1.4.1 asks when colour is the only distinguisher, and `hover:underline` is not a rest state. Ruled: give inline links a **permanent underline** rather than bound how far the token may darken. A non-colour cue holds at any lightness, so the two criteria stop competing. Options (b) "cap the darkening at the 1.4.1 boundary" and (c) "rule 1.4.1 out of scope" were both rejected. **The rule is not surface-specific**, ruled in round 2 on the PR thread ([comment 5244357976](https://github.com/SebastianGarces/everyfield_v2/pull/387#issuecomment-5244357976), 2026-08-10): *"the underline CSS stays everywhere, including the SHARP marketing pages — the 1.36:1 colour-only links were a real SC 1.4.1 failure."* `/terms` and `/privacy` had shipped four colour-only prose links at **1.36:1** (field green `#0b7a3f` on marketing body text `#4e584f`) — a worse violation than the `/login` case this ruling was written to fix, on pages every visitor sees. Exempting the marketing surface was rejected: SHARP (`DESIGN.md`) rules link *colour*, not decoration, and only prose links change — nav, CTA and card links keep the flat treatment. | `p a[href]` underlines in the base layer of `src/app/globals.css` (scoped to `p`, since `li` is nav), and `.marketing p a[href]` underlines in `src/app/(marketing)/marketing.css` itself — on the sheet that caused the conflict rather than via `!important` in `globals.css`. Why two: `@layer base` is the weakest place in the cascade, and an unlayered normal declaration beats a layered one at any specificity, so the unlayered `.marketing a { text-decoration: none }` had deleted the cue across the whole marketing route group. Lighthouse's `link-in-text-block` finding on `/login` clears. Enforcement lines in `memory/invariants.md` name link separation as the cost darkening carries, forbid deleting the rule or adding `no-underline` to prose links, and record that the underline is owed by every unlayered stylesheet under `src/app/` that touches `text-decoration` on a bare `a` — never "paid once". `src/app/text-contrast.test.ts` fails the build when a sheet strips it without restoring. |

### Recorded 2026-08-10 — phase-engine technical decisions (June 2026)

Moved out of the phase-engine FRD §10 when the ledger became the single home for decisions. The
rulings themselves are from June 2026.

| Area | Decision | Notes |
|------|----------|-------|
| Judge orchestration | **Vercel AI SDK `generateObject`** (structured output) + plain TypeScript pipeline | The judge is a structured pipeline (facts → retrieve → one validated LLM call → persist), not an agentic graph. **No LangGraph.** Provider stays behind `judge/provider.ts` for one-line swaps. |
| LLM provider | **OpenAI GPT family** via the AI SDK | Data posture per NFR-PE-4: API data is not trained on by default, abuse-monitoring retention is up to 30 days, and the self-serve retention control is set at the project level. ZDR needs a sales agreement and waits for enterprise eligibility — it does **not** gate go-live. Judge inference ≈ **$0.03–0.05 / assessment** (~$30/mo at beta scale); the only cost that matters. |
| Observability | **Self-hosted Langfuse** | Trace each judge run tagged with rubric version + model id; correlate traces with insight feedback to evaluate and tune the rubric. |
| RAG store | **pgvector on Neon** (same DB) | Corpus ≈ **215k tokens** / low-thousands of chunks — Pinecone would be over-engineering. Hybrid retrieval with the existing wiki `tsvector` FTS. |
| Embeddings | **`text-embedding-3-small`** (1536 dims; reducible to 1024) | **Section/heading chunking** (~300–800 tok, small overlap) with `phase` / `section` / `article_slug` metadata for **phase-filtered retrieval**. One-time corpus embed ≈ **$0.004**. |
| Cron | **Vercel Cron** → secret-guarded route, ~daily | Selects dirty-or-stale plants only (NFR-PE-2). |
| Embed scope | **Wiki articles + playbook** | The **rubric is NOT embedded** — it goes into the judge context *whole* every run. Historical assessments are a *future* embed (benchmarking, PE-021). |

**Related future work.** The **Church Plant Agent** — a conversational, tool-calling agent (with
human confirmation + generative UI) that *executes* multi-step operations — is the action half of
the app's chat-first AI direction and forms an insight→action loop with the phase engine (the judge
surfaces what to do; the agent does it). It is captured in
`product-docs/features/church-plant-agent/vision.md`, which is where the agent-framework decision
(AI SDK agent primitives vs. LangGraph vs. Vercel Workflow DevKit) is framed. The Plant Intelligence
judge itself needs none of those.

### Ruled 2026-08-10 — the onboarding flow's `?step=` URL (#373, PR 390)

Two spec-questions raised on PR 390 and ruled by Sebastian on the thread the same day. The comment,
verbatim:

> **RULINGS (2026-08-10, Sebastian):** (1) **Suppress the Guide button on the OB-015 finish screen**
> without giving it its own ?step= value — honors the #367 option-C intent; no reopenable URL.
> (2) **replaceState off step 1** once the church exists, so browser Back skips the non-re-enterable
> step; the same ruling covers the deep-link /dashboard?step=basics. Both fixes in this PR before merge.

| # | Decision | Consequence |
|---|----------|-------------|
| PR&nbsp;390 (a) | **The contextual wiki guide is suppressed on the OB-015 finish screen by REMOVING `?step=`, not by giving the screen a URL of its own.** Chosen over accepting the guide there (PR #367 scoped it to *the one step that raises the question*, and the finish screen does not raise it) and over inventing a fifth `?step=` value — which was rejected because it would hand a planter a shareable, bookmarkable URL that reopens an offer whose gate they already answered. | The finish screen is `/dashboard` with the param removed, so it matches no guide entry and no second "is the guide on?" mechanism is added. Reloading it resumes the flow rather than reopening the offer. Enforcement line in `memory/invariants.md` (Onboarding). |
| PR&nbsp;390 (b) | **Step 1 is not in the browser history.** Once the church exists the 1→2 transition `replaceState`s instead of pushing, and the same rule declines the deep link `/dashboard?step=basics` — "step 1 is not re-enterable" becomes true everywhere instead of only in-app, where `backTarget` already said so. Option C (a read-only done state for step 1) was rejected as the largest change for a state only ever seen travelling backwards. | **Accepted cost, in the ruling's own terms: browser Back from step 2 now leaves the flow** — the behaviour issue #373's AC 5 was originally written to stop. AC 5 is amended on the issue so the next reader does not file it as a regression. The rule lives in `resolveOnboardingStepRequest` (server) and `addressableOnboardingStep` (client mirror); enforcement line in `memory/invariants.md` (Onboarding). |

### Ruled 2026-08-10 / 2026-08-12 — how a manual attestation may be cited (#319, PR 394)

The fact snapshot writes every manual attestation TWICE — `manual.byKey.<signal>` and
`manual.attestations[]` — and the judge's citable ledger is the whole flattened snapshot, so both
spellings are legal citations of one fact. Ruled by Sebastian on the PR thread across three rounds.
The round-2 comment, verbatim:

> **RULING round 2 (2026-08-10, Sebastian):** unify the drill-down wording — the formatter resolves
> the signalKey (as the normalizer already does), so byKey and attestations-array citations read the
> same specific sentence. The raw citation path (data-path) stays verbatim. Also land the owed
> bookkeeping the PR names: the citation-normalisation ruling into product-docs/decisions.md.
> Amend this PR.

Round 2 unified the drill-down and stopped there, which left the other two surfaces on the same
page speaking differently about the same citation. The round-3 comment, verbatim:

> **RULING (2026-08-12, Sebastian): Option A — extend the unification to both surfaces, mixed
> signals collapse to a count.** Resolve `signalKey` where the insight-card and CSF-scorecard
> projections are built, carry it to the components, and pass it through a context-aware plural
> formatter. One resolved signal reads the same specific sentence the drill-down reads; MIXED
> signals collapse to a count ("3 things you confirmed") — the counting path stays a counter, never
> a lister. All three surfaces on /phase then read one voice for one citation. The raw citation path
> (data-path) stays verbatim, per the round-2 ruling. Confirm the owed decisions.md bookkeeping row
> from round 2 actually landed; if not, it lands in this amendment.

| # | Decision | Consequence |
|---|----------|-------------|
| PR&nbsp;394 (a) | **A citation is normalised onto its signal at parse time, by resolving the row.** `manual.attestations.N.…` is rewritten to `manual.byKey.<signal>` for ATTRIBUTION, reading entry N's `signalKey` out of the assessment's own snapshot — so which of two equally legal spellings the model happened to emit cannot decide whether a gate reads "Not addressed". Widening the three attested criteria to the bare `manual` prefix was rejected: each measures ONE signal, so a prefix rule would tell a planter the engine addressed their financial base because it mentioned an unrelated one. An unresolvable row (out-of-range index, non-numeric index, no `signalKey`) attributes to NOTHING rather than guessing a gate. | `normalizeManualCitation` in `src/lib/phase-engine/assessment/exit-criteria.ts`, applied by `citedPathsOf`, over `attestationSignalKey` in `assessment/snapshot-fact.ts`. The criteria keep declaring only the keyed spelling. `buildEvidence` is deliberately untouched, so the drill-down still shows the citation as the judge wrote it. |
| PR&nbsp;394 (b) | **Having landed on the same gate, both spellings must also READ the same** (round 2). The formatter resolves the signal the same way the normaliser does and phrases the array spelling with the `MANUAL_SIGNAL_CLAUSES` sentence the keyed one uses — "you confirmed your financial base is in place", not "something you confirmed" beside it. Same evidence told twice, once vaguely, is what makes a planter doubt the specific telling. The RAW citation path is unchanged: `data-path` stays verbatim, and an unresolved row keeps the generic self-report phrasing rather than borrowing a signal. | The resolved signal rides on `CitedFactEvidence.signalKey` and reaches `formatCitedFact(fact, { signalKey })` (`src/lib/phase-engine/fact-format.ts`); nothing rewrites `path`. Pinned by `fact-format.test.ts` (the two spellings render the identical sentence) and `exit-criteria.test.ts` (the rendered `data-path` is still the judge's own). |
| PR&nbsp;394 (c) | **The unification reaches ALL THREE surfaces, and it is a READ-LAYER fix** (round 3, option A). The insight card and the CSF scorecard fold a whole `cited_facts` column and hold no snapshot, so the projection that feeds them resolves each citation's signal and carries it; the components pass it to a context-aware plural formatter. Option (b), accepting the divergence, was rejected because all three cards sit on `/phase` at once — a planter could read one attestation named by the drill-down and called "something you confirmed" by the card above it, in one screenful. Widening the formatter's own guesswork was rejected for the same reason the prefix rule was in (a): resolving a row is a read of the snapshot, not a syntax rule. | **The counting path stays a counter.** One resolved signal in a group reads the drill-down's sentence; MIXED signals — two different attestations, or one resolved beside one that is not — collapse back to "3 things you confirmed" rather than listing them. **The fold is keyed on the resolved SIGNAL, never on the rendered phrase**, which is what makes the rule spelling-independent at every N: two attestations count the same whether the model cited them by key or by row, and one attestation cited both ways is one thing, never a named sentence beside a count that already included it. That takes TWO keys, and round 4 had to add the second: a group's IDENTITY is an explicit `attestationGroupKey` (template plus value-class — `attestation:value:true`, `attestation:signalKey`, `attestation:attestedAt`), and its MEMBERS are the distinct resolved signals. Keying the group on the rendered phrase looked signal-independent and was not — two of the four attestation templates bake the signal or the date into the phrase, so at N=2 the `signalKey` and `attestedAt` leaves put every attestation in a group of its own and the counter printed each one's sentence. The counter had become a lister on three of the four leaves, and a valueless array `signalKey` fell out of the templates entirely and printed the ledger's own label. `resolveCitedFactSignals` + `AssessedInsight.citedFactSignals` (`assessment/snapshot-fact.ts`), read by `formatCitedFacts(citedFacts, signals)` (`fact-format.ts`). `data-path` is still verbatim. Pinned by `fact-format.test.ts`, `assessment/exit-criteria.test.ts` (the real projections) and `components/phase-engine/citation-voice.test.ts`, which renders all three components from ONE assessment and asserts they say the same sentence. |

## 2026-08-12 — Debt-sweep rulings (#403, PRs #404–#410)

Sebastian ruled all 34 sweep DECISIONs in one session (recommendation ledger adopted in full).
The structural/code-only choices live in the PR bodies as "Rulings applied"; the rows below are
the product- and canon-shaping subset. Deferred implementations are pinned: migrations → #411,
`template_key` → #378 WS1, assign-dialog search → #320.

| # | Decision | Consequence |
|---|----------|-------------|
| 404-2 | **`src/components/ui` is vendored shadcn CLI output.** The contract is "matches what the CLI generates": defects are fixed in place; unused registry surface is never hand-pruned. | `pnpm dlx shadcn add` stays non-destructive; readers treat the folder as vendor code, not product code. |
| 405-1 | **Client IP is read from platform-written `x-real-ip`, falling back to the LAST hop of `x-forwarded-for`.** The first hop is client input and nothing may branch on it. | Both IP-based rate limits become spoof-resistant. Enforcement line joins the Authentication invariant. |
| 405-2 | **Session freshness is deliberately unwired until the first sensitive operation ships.** The column stays; the helpers and the invariant line claiming a live control are removed. | Documentation stops describing a control that does not run. Re-adding freshness is the first AC of whichever flow needs it (password change, association accept). |
| 405-4 | **A successful login clears that identifier's failure window.** | The fail-4-times-succeed-then-lock trap is gone; lockout counts only consecutive failures. |
| 406-1 | **Template catalog wiki links point at the published corpus; response-card and sign-in-sheet map to `running-the-meeting`.** A guard test pins every `relatedWikiSlug` to a resolvable article. | Seven dead links become live; a future slug rename fails the suite instead of the user. |
| 407-3 | **Relative timestamps standardize on `formatRelativeTimestamp`** ("12m ago" / "3d ago", absolute past a week) everywhere date-fns wording survived. | One formatter authority; the hub and history match the notifications feed. |
| 408-2 | **A signed-in user with no church and no oversight role sees an explicit "not attached to a plant yet" state on /dashboard** — never a silently empty dashboard. | The undesigned state is designed; the null-scoped reads and `!` assertions behind it are gone. |
| 408-3 | **`?step=leadership` is never scrubbed, even when it cannot be honoured.** An inert param is harmless; scrubbing would cost a permission read on every dashboard render. | The #373/#367 scrub rule keeps its one deliberate exception, now recorded. |
| 409-Δ | **The five #409 behavior deltas are accepted as fixes** — most notably: client-supplied foreign keys are proven against the caller's church, so a forged POST that used to write a row now throws. | Tenant isolation holds at the service layer (V2). The remaining deltas: wider revalidation, `ON CONFLICT` duplicate guard, no zero-row staffing event, schema-level coercion. |
| 409-1 | **A team role holds one active member.** Partial unique index on active `(role_id)` + `ON CONFLICT` (#411). | The invisible-second-assignee state becomes impossible at the DB (V4: a role is a slot). |
| 409-2 | **A predefined team's identity is `template_key`, never its display name.** Lands as #378 WS1 schema work, before the "Leadership" rename. | Renaming a template team becomes a pure display change; the org-chart root and responsibilities lookups stop keying on copy. |
| 409-4 | **Team attendance rate counts only active team members in the numerator.** | The figure can no longer exceed 100% (V5). Existing dashboards read lower and truer. |
| 409-5 | **The team-card dot is a STAFFING signal; /teams/health is the HEALTH signal.** Two named signals, not one signal computed two ways. | Same team may legitimately show green staffing and yellow health; each surface says which question it answers (V5). |
| 409-6 | **Error copy policy: a service throws typed `ExpectedError` for messages a planter should read; everything else surfaces as the generic sentence.** | One action shell; "Role is already filled" stays useful, internals stop leaking into user copy. |
| 410-1 | **People search matches full names** ("Jane Smith"), on the live list path. | The only implementation of full-name search stops being dead code by becoming the product. |
| 410-2 | **Every person-creation path writes the `person_created` activity**, via the service. | Timelines agree regardless of which door a contact came in through. |
| 410-3 | **The import preview never ships matched contacts' full records to the browser** — matches are `{id, displayName}` only. | PII of existing contacts stops round-tripping through client state (V2). |
| 410-4 | **Creating a household with a head is one atomic action.** | The orphaned-empty-household state (second call fails) becomes impossible. |

## 2026-08-13 — The /people status-badge colour scale (#429, prototypes on draft PR #431)

Four directions were built as live prototypes behind the switcher and operated on a preview in
both themes; Sebastian ruled from the bench rather than from prose.

**The bench never merges, and its teardown is an OBLIGATION here, not a record.** As of this row
draft PR #431 is still OPEN and `proto/429-status-badge-scale` still exists. When this
implementation merges, that PR is closed UNMERGED, the branch is deleted (remote and local) and
the `proto-429` worktree is removed. Until that happens the branch is not inert: it carries a
commit that adds `proto-429-bench.tsx` to an exemption list inside
`src/lib/invitations/resend.test.ts`, which disarms the repo-wide "no prototype scaffolding
survives the ruling" guard for exactly the 609 lines of bench sitting next to it. Merging #431
would land the scaffolding AND the guard that was supposed to catch it, so #431 is never merged —
only closed.

| # | Decision | Consequence |
|---|----------|-------------|
| 429 | **The person-status badges adopt direction B — "tinted editorial".** Each status that carries colour paints ONE hue three ways — pale ground, deep same-hue ink, hairline same-hue border — and the dark theme mirrors it (deep ground, pale ink). Worst measured pair 6.64:1 light / 7.31:1 dark, against the 1.91:1 the raw 500-level fills shipped. Rejected: A (darkened solids — reads heavy at list density), C (neutral badge + colour dot — status stops being scannable across a long list), D (one green funnel ramp — spends the brand green everywhere and puts the ruled danger red on non-bad news). | `STATUS_BADGE_CONFIG` (`src/lib/people/status-colors.ts`) spells six classes per tinted status on `variant="outline"`, with no hover fill. The deferral ledger `DEFERRED_STATUS_BADGE_FILLS` is DELETED rather than emptied: `status-badge-scale.test.ts` (its own suite — the scale's colours come from Tailwind's palette and `badge.tsx`, not the token layer) requires AA of all fourteen status/theme pairs and pins the shape (six classes, one hue, the mirror measured by luminance). Lighthouse's `color-contrast` audit stops flagging the badge nodes on `/people`. |
| 429 (a) | **Prospect stays neutral** — the pipeline's zero keeps the token-backed `secondary` variant and declares no colour of its own. | Part of B as ruled, so a later "complete the set" tint is a change to the ruling, not a polish pass. Pinned by name in the suite. |
| 429 (b) | **Attendee and Launch Team stay on ONE hue, separated by tint level** (blue 50/200 against 100/300, mirrored) — the hue split was offered in the decision comment and declined. | The two adjacent pipeline rungs read as one family told apart by weight. Splitting them onto different hues needs a new ruling; the suite fails with that sentence if a commit tries. |

## 2026-08-13 — Risk policy, and provenance stays out of the code (#435, from reviewing #432)

| # | Decision | Consequence |
|---|----------|-------------|
| 435 | **`risk:high` means auth/permissions, multi-tenant isolation, or payments — not schema.** Pre-release there is no separate production database holding client data, so a migration is ordinary work. **Revert condition:** the day alpha or beta serves real client data from its own production DB, schema and migrations return to `risk:high`. | Schema tracks stop being held for an attended pass, and `dispatch` no longer skips them. The migration proofs — applies and rolls back, DDL delta in the PR body — re-key from the risk tier to the diff: they fire whenever a migration is present, at any tier (`ops/agent-os/dod.md`). Never-auto-merge and the reviewer's security lens stay keyed to `risk:high`. |
| 432 | **Provenance never lives in a source comment.** A comment states a constraint the code cannot show; issue numbers, ruling dates and review-round stamps go in the commit message, the PR body and `memory/`. | Enforced as a REVIEWED-gate check on added non-test source lines (`ops/agent-os/dod.md` § 3), so the record survives where it is searchable and the code stops carrying a changelog. |

## 2026-08-14 — Delivery OS simplification (supersedes #430)

| # | Decision | Consequence |
|---|----------|-------------|
| 430 | **One code review and one fix round per PR — the per-review-site 2-round cap is retired, not re-read.** The 2026-08-13 ruling capped review-fix rounds per review site; the simplified loop has exactly one review site, so the cap collapses into the pipeline itself. | `QUALITY_ROUNDS` and the scoped per-workstream reviews are gone. Findings the single fix round does not resolve reach the PR body as recorded rulings or a DECISION comment — they are never re-reviewed by another agent. #430's request to record the per-site reading is answered by this row. |
| — | **The memory size budget has one authority: `memory/index.md`** — `invariants.md` ≤ 62 KB, the whole tree ≤ 175 KB, enforced by `ops/agent-os/tests/memory-budget.test.mjs`. (The rewrite pinned 50/140; re-pinned same day, ruled by Sebastian, when the #432 race-guard rulings and #434 wiki security rounds merged in — their memory additions were compressed into the rewritten register, every rule kept, and the pins moved to where the merged tree honestly lands: 60.8/172.) | `ops/agent-os/dod.md` points at it instead of restating numbers, so the contract cannot disagree with itself. The budget is deliberately tight: adding a rule may require shortening another, and raising the number is a new ruling rather than a fix for a red test. |

## 2026-08-15 — Recorded late: the deadline-truncated assessment failure (#389, ruled 2026-08-10)

Ruled on 2026-08-10 while reviewing #374/#375 and shipped in PR #389, but only ever written into
`memory/contracts/api.md` and the code — a grep of this ledger for #374, #375, #389 or "truncat"
returned nothing. It is recorded here, keyed to its own PR, because the ledger is where a ruling
is looked up (follow-up #396). Nothing above is edited: this row is the ruling's first entry, not
a supersession.

| # | Decision | Consequence |
|---|----------|-------------|
| 389 | **A judge failure whose 5xx retry ladder the RUN's own clock cut short stays `failed`; only its WARNING softens.** The provider answered and the answer was broken, so the status is unchanged and `plant_assessments` records `failed` exactly as before — what changes is that the run outcome carries `truncatedByDeadline` and logs on `console.warn` rather than `console.error`. Rejected: a fifth status, and recording it as `deferred` — both would have filed a broken judge into a bucket nobody is paged on. | Since #375 bounded the 5xx retry branch by the run deadline, a truncated ladder can report a failure after a SINGLE attempt, which on its own is indistinguishable from a provider that is genuinely down; the 07:00 Actions log now tells the two apart. **The property the ruling was not allowed to lose:** a ladder that spent its LAST attempt is deliberately NOT marked, so `console.error` still means a genuinely down provider. Enforcement lives in `memory/invariants.md` (⚖, Phase Engine — Assessment Status). The mark is carried by OBJECT IDENTITY through a module-level `WeakSet`, so a rethrow that wraps the error drops it silently — proven over the real judge → orchestrator → runner chain by the guard added in #396. |

## 2026-08-15 — The memory byte budget is removed (supersedes the 2026-08-14 budget row)

| # | Decision | Consequence |
|---|----------|-------------|
| — | **`memory/` has no size cap.** The two byte budgets — `invariants.md` and the whole tree — are removed, and `ops/agent-os/tests/memory-budget.test.mjs` is deleted. Ruled by Sebastian: the cap had stopped governing size and started taxing unrelated work. It was re-pinned four times in two days (50/140 → 60.8/172 → ~175.5 → 64/181), and every raise cost a compression negotiation inside a pass that had nothing to do with `memory/` — the last one bought 1.8 KB back out of wording to fit 2.0 KB of genuine new contract. A budget that is re-pinned on contact is measuring the wrong thing. | The discipline the cap enforced survives as review, not as a test: each rule is 1–3 sentences, a non-derivable *why* goes down into `memory/invariants/<domain>.md`, and nothing mirrors source (`ops/agent-os/dod.md` § Memory). `memory/index.md` states the no-cap rule. CI drops its `memory/` carve-out from the docs-only shortcut — that carve-out existed only to keep this test live, and no test reads `memory/` now. **Open, not ruled:** whether `memory/` should be read whole on every pass at all, or retrieved per-domain — the real lever on its cost, and the reason a cap felt necessary. Recorded as the successor question, not answered here. |

## 2026-08-15 — The weekly digest lands Sunday 16:00 church-local (supersedes the Monday ruling in #447)

| # | Decision | Consequence |
|---|----------|-------------|
| 135 | **The weekly planter digest lands SUNDAY at 16:00 in the church's local zone.** Ruled by Sebastian, overruling the Monday default that PR #447's loop chose under delegation. Monday's reasoning was that Sunday is a planter's busiest ministry day; the ruling accepts that and answers it with the HOUR — 16:00 is after the gathering, when the week ahead is what the reader is thinking about. **The hour is load-bearing, not decoration:** the shipped code has no send-hour at all and emits on the 15-minute dispatcher tick that first crosses the period boundary, i.e. 00:00 UTC, so Sunday-plus-UTC would deliver Saturday 8 PM Eastern — the failure this ruling exists to prevent. | `DEFAULT_WEEKLY_DIGEST_WEEKDAY` moves 1 → 0 and gains a send-hour gate; `digestPeriodFor`'s UTC-day arithmetic stops being valid once the anchor is a zone with DST, so the period boundary and the hour change together (`src/lib/notifications/digest-content.ts`, and the sibling assumption stated in `src/lib/datetime.ts`). Filed as **#448**, blocked by #166. |
| 166 | **The church-level timezone is build work, not `needs-spec`** — the digest's send hour is the caller that finally needs it. The 2026-07-26 ruling (add an IANA zone to `churches`; church-scoped surfaces render in it) stands unchanged; what closes here are the three sub-questions that held it. **(a) A fixed default of `America/Chicago`, changed in church settings — no inference from the address.** `city`/`state_region`/`country` are individually nullable by F12's own ruling, so inference fails open for exactly the planters who skipped them, and a silently-wrong zone is worse than an obviously-default one. **(b) Settings-only; onboarding gains no step** — F12 is 14/14 and the demo path stays tight. **(c) The relative-day badge renders in church time,** as #166 itself recommended: consistent for the church, at the cost of differing for a traveling viewer. | #166 → `agent:queued` with the sub-questions answered in its body. Unblocks F11 **N-018** (quiet hours and send-time-of-day), which the FRD gated on a timezone existing — N-018 itself stays out of alpha. The default zone is one line to change per church and is the assumption most worth correcting early. |

| 448 | **The digest's send day and hour are a CHURCH SETTING, defaulting to Sunday 16:00 local.** Extends the row above the same day: the default is the ruling, not the mechanism. A church changes both in church settings. **The split matters more than the default:** the RECIPIENT still owns whether they get a digest and how often (the per-user `digest` category preference, untouched); the CHURCH owns when it lands. The weekday governs the weekly cadence only; the hour governs daily and weekly alike. Whole hours only — the 15-minute tick would allow quarter-hours, but an hour is the unit a planter reasons in. | Two columns on `churches`, beside the `inactivity_*` thresholds already there. **The consequence worth naming:** ⚖ the church is deliberately absent from the digest's dedupe key STRING, because the `(church_id, recipient_user_id, dedupe_key)` index scopes it — which is what keeps the sweep's owed-set test an `IN (two literals)`. A per-church anchor leaves the string alone but makes its VALUE church-dependent, so `currentDigestDedupeKeys` must take the church's anchor rather than computing a current key set globally. Recorded in `memory/invariants.md`. Placement: #187 will own the broader church-settings page, so the control goes where #187 absorbs it rather than becoming a second surface. |

## 2026-08-15 — Church settings (#187): the tab split, the invite-origin defaults, and the revoke notice

| # | Decision | Consequence |
|---|----------|-------------|
| 187 | **`/settings` is one route with two tabs. Account (every user): email, password, profile picture. Church (admin role only): name, city/state-region, street address (new nullable column, optional), timezone (#166), digest day+hour (#448), the two inactivity thresholds already on `churches`, and the sharing panel — the six pull toggles, #62's wiki row when it lands, and the push toggle.** Launch date is deliberately NOT on the page: LS-001 (#285, migration 0032) made the `launches` entity its only owner, and #187's original "nothing writes `launchDate`" finding predates that. Billing gets a section at Beta (#213). Danger zone (delete church / close account) is deferred past alpha — a support-email path serves a 10–15 church cohort. | Email change verifies the new address (email is the login identifier) and notifies the old one; password change requires the current password; both ride `src/lib/auth/rate-limit.ts`. The avatar upload uses the already-configured S3 bucket; a church logo waits for #67 and reuses the same plumbing. |
| 187 | **A plant that joins via a sending-church or network invitation defaults ALL sharing toggles ON — the six pull toggles and the push toggle alike. A self-started plant stays all-OFF.** Consent moves to the acceptance moment: the acceptance screen states in plain language what the overseer will see, before the planter accepts. The DB column defaults stay FALSE — the ON write is application-level in the acceptance flow (`acceptInvitation`, `src/lib/invitations/service.ts`), so the N-026 principle survives: nothing is shared that nobody was told about. Rationale: the sending org pays per plant (#193); paying and seeing nothing is the failure mode. | The planter can turn any toggle off at any time in settings. Turning one off notifies the overseer's admins with COARSE wording ("changed what it shares with you"), never per-toggle — per-toggle wording ("they hid financials") maximizes social pressure on the planter and poisons the relationship the product exists to serve. New notification type on the #447 rails. |

## 2026-08-20 — Accounts & seats (#185): five flat roles become three seats across three tenancies

Ruled by Sebastian in a live review of the #185 walkthrough. Supersedes the "there are exactly five
roles" framing that `CONTEXT.md` §1 carried since 2026-07-26; the five names survive only as
deprecated synonyms. The FRD is `product-docs/features/accounts-and-seats/frd.md`.

| # | Decision | Consequence |
|---|----------|-------------|
| 185 | **Three SEATS — Owner, Admin, Member — applied identically in all three tenancies (plant, sending church, sending network).** The shape is the one Slack, GitHub and Vercel already taught every user: one Owner who holds the relationship decisions, an Admin who runs the day-to-day, a Member who participates. A planter appointing a co-leader and a network director appointing a second staffer become the same act, learned once. Rejected: keeping five flat roles (each new tenancy adds a role and a matrix column), and a per-module permission grid in the Planning Center shape (drifts the moment two modules disagree). | `users.role` is replaced by `users.seat` (`owner`/`admin`/`member`, NULL for a coach-only account) read together with the three tenancy FKs already on the row. `planter` → owner, `team_member` → member, both `*_admin` → owner. **Every reader migrates in the same wave and `users.role` is DROPPED** — `getAccessibleChurchIds`, the nav, the notification audiences, the oversight pairing table. No compatibility layer, no dual read. |
| 185 (1) | **The Owner-only list, identical in every tenancy:** sharing toggles, association accept / leave / sever, launch scheduling, seat appointment AND seat removal, org settings and billing wherever those land. Everything else an Admin may do. | An Admin is refused each of them server-side and is shown no control for them — the appointment and removal controls are absent from `/settings/team` for an Admin, not disabled. |
| 185 (2) | **Coach is NOT a seat — it stays an assignment.** `coach_assignments`, planter-initiated, read-only on the assigned plant, orthogonal to any seat. | One account = one home tenancy (FK + seat) + any number of assignments; access is the UNION. A Member of plant A coaching plant B is representable by construction. An **oversight seat holder coaching a plant inside their own portfolio** reads that plant's own records through the assignment while every oversight surface the same session opens stays aggregate and `share_*`-gated — the two reaches come from different consents and neither borrows the other's scope. This is ruled, not discovered. Nav gains an **Assigned plants** section whenever assignments exist. |
| 185 (3) | **Org Member = FULL read parity with the org Owner** — plants directory, per-plant aggregate detail, the plant-health portfolio, a network's sending-church roster and drill-down — with zero admin actions, and never an individual person record. | Privacy is unchanged: org reads stay gated by each plant's `share_*` toggles. An org Member is an account, never a person record inside a plant. |
| 185 (4) | **One Owner per tenancy, enforced by the DATABASE** — three partial unique indexes, one per tenancy FK, each `WHERE seat = 'owner'`. | This also retires the OB-010 claim race recorded in `memory/invariants.md` ("it is a raced write"): a second Owner stops being a defect to detect and becomes a write that cannot commit. |
| 185 (5) | **Seat invitations are REGISTER-ONLY. An address that already holds an account is refused with the ONE neutral message**, reusing the org-invitation rulings whole: neutral account-existence copy, hashed token, the 3-per-window cap, the resend action, no copyable admin link — the same constants, one implementation. **Coach invitations KEEP the existing-account path** (they grant an assignment only, and the planter's invitation is the consent). Tenancy moves are a support email. | One `user_invitations` table: exactly-one-target CHECK across the three tenancy FKs (the `association_events` 0036 precedent), `kind` ∈ (seat, coach), `seat` ∈ (admin, member) with a CHECK tying `kind='seat'` ⟺ `seat NOT NULL`, token stored hashed. Acceptance grants tenancy FK + seat AT REGISTRATION, which keeps the invariant that outside registration a seat is granted in exactly ONE place. A plant invitee also gets a person row linked by the people directory's match-or-create recipe. |
| 185 (6) | **Removal is FULL IN-APP at alpha.** Sebastian overrode the lighter recommendation (support-email removal): an Owner deactivates any seat and ends any coach assignment from the product. | Deactivation semantics, pinned: sessions revoked; tenancy FK and seat cleared; the account row and the person record left intact (the person↔user link rule); **open tasks reassigned to the Owner** (an unassigned task disappears from every "my work" view, so the plant would silently lose the commitment); **ministry-team leadership cleared** so the team reads as an open leader slot (leadership is a decision about a person, not a queue that must drain). An Owner may not remove their own seat. Ownership transfer stays out of scope. |
| 185 (7) | **Read-only depth: HIDE EVERYWHERE.** Sebastian overrode the lighter recommendation (hide on primary surfaces, rely on the server guard elsewhere): write affordances are hidden — not disabled — on EVERY surface for a read-only context before shipping. | "Everywhere" is made verifiable rather than vibes: the FRD carries an enumerated read-only surface checklist, one row per surface, naming what must not render. The three read-only contexts are a coach on an assigned plant, an org Member anywhere, and a plant Member on a surface they may read but not write. |
| 185 (8) | **Enforcement is ONE permissions module and ONE guard.** The Owner-only and Admin-and-above sets are data; `requireSeat` is the single call; a test walks every export of every `"use server"` module and fails when one reaches its work without the guard (the `ruled-guards.test.ts` precedent). | Rejected explicitly: a per-module permission matrix. The export list IS the auth surface, so the test is keyed to it. |
| 185 (9) | **Scope split.** #185 owns the seat model plus the plant-side flows. **Org-side Member/Admin invites are a SIBLING issue on the same schema**, buildable immediately after. The bespoke Member **duties dashboard is deferred out of alpha** and filed as its own `needs-spec` issue. | The plant invite flow is blocked by the person↔user link work; the seat migration is not. #187 gains one consequence: the church profile opens to plant **Admins**, while the sharing panel stays **Owner-only**. |
