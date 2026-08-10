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
  (`ops/agent-os/workflow.md` §4).
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
