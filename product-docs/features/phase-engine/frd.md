# Feature Requirements Document: Phase Engine (Plant Intelligence)

> **Direction change (June 2026):** This feature was previously conceived as a deterministic *phase state machine* — track `current_phase`, validate hard exit criteria, gate transitions. It is being **reframed** as a **Plant Intelligence Engine**: an advisory system that continuously reads the plant's real activity, judges it against the church-planting methodology (the Launch Playbook + wiki) using an LLM-as-judge, and surfaces prioritized **insights and guidance** to planters and to sending networks/churches. The phase becomes *context for judgment*, not a gate. See `system-architecture.md` → Phase Engine, and the PRD changelog. This is the platform's primary differentiator ("the data backbone" thesis).

**Feature ID prefix:** PE
**Status:** Draft
**References:** `product-brief.md` (Phase Structure, Success Metrics), `system-architecture.md` (Phase Engine cross-cutting service, Core Canonical Models → Phase), `rubric-v0.md` (companion artifact: the evaluation rubric).

---

## 1. Feature Overview

The Phase Engine answers two questions, continuously, for every church plant:

1. **"What should I focus on right now, and why?"** — for the **planter** (coaching, prioritized next actions).
2. **"How healthy is this plant, and is it on track?"** — for the **sending network / sending church** (oversight, readiness).

It does this by judging the plant's **actual system activity** (core-group growth, vision-meeting cadence, leadership coverage, follow-up health, training progress, time-to-launch) against the **methodology** (the Launch Playbook and the 96-article wiki), expressed as a **versioned rubric** (`rubric-v0.md`). The judgment is produced by an **LLM-as-judge** grounded in retrieved methodology content (RAG), and stored as a **point-in-time assessment snapshot** that the UI reads instantly.

The engine also retains a lightweight **phase model**: it tracks `current_phase`, records **planter-confirmed transitions** with an audit trail, and emits `phase.changed`. But advancement is **soft-gated** — readiness is a *judgment surfaced as insight*, never a hard block.

### Core design principle: facts vs. judgment (non-negotiable)

The engine is two layers that must never blur:

- **Signal layer (deterministic):** every countable fact is computed from the database via SQL — never by the LLM. The LLM cannot be trusted to count; one hallucinated number destroys planter trust.
- **Judgment layer (LLM-as-judge):** receives the structured fact snapshot + current phase + rubric + retrieved methodology passages, and produces interpretation, prioritization, and phrasing. It reasons *only* over supplied facts.

### Non-Goals

- Not an automatic phase advancer — transitions are always planter-initiated/confirmed.
- Not a hard gate — it never blocks a planter from advancing or acting.
- Not a real-time/on-page LLM call — assessments are precomputed and cached; pages read snapshots.
- Does not own the dashboard or oversight UI surfaces (those are F4 Progress Dashboard); this feature *produces the insights those surfaces render*.

---

## 2. User-Visible Behavior

### Planter
- Sees a **current assessment** for their plant: a short prioritized list of insights ("here's what matters now"), each with a plain-language explanation grounded in facts, an urgency/severity, and (where relevant) a link to the wiki article that helps.
- Sees their **current phase** and, when the judge assesses they're ready, a **"ready to advance"** prompt — which they may accept (confirm transition) or ignore.
- Can **advance, regress, or correct** their phase at any time, always recording a short reason. No transition is ever blocked.
- Can **self-attest** facts the system can't observe (e.g., "values documented", "financial base in place", "systems tested") via simple toggles that feed the judge.
- Can **rate an insight** (useful / not useful, optional comment). This feedback tunes the rubric.
- Each assessment shows **"as of <date>"** and **what changed since the last assessment**.

### Sending Network / Sending Church (oversight)
- Sees a **health view** per plant: an evaluative-but-conservative summary (on track / watch / readiness), gated by the plant's existing privacy settings (`share_*`).
- Network-facing insights are framed as **observations, not verdicts**, and are **never** more granular than the plant's privacy settings allow (no individual-person insights to the network).
- The planter always sees their own assessment **before or concurrently with** the network — no plant is surprised by what their overseer was told.

---

## 3. Screens & Workflows

> UI rendering lives in **F4 Progress Dashboard** and the **Oversight** surfaces; this FRD defines the *behavior and content* those screens display, not their layout.

1. **Planter dashboard — "Focus" panel:** renders the latest assessment's planter-audience insights (prioritized, with severity + wiki links).
2. **Phase control:** displays current phase + readiness state; "Advance / Change phase" action with a reason field and (if advancing past open gates) a soft confirmation.
3. **Self-attestation:** a small set of manual signal toggles surfaced contextually (e.g., during onboarding and on the phase control).
4. **Insight feedback:** thumbs up/down + optional note on each insight.
5. **Oversight — plant health card / detail:** renders the latest assessment's network-audience insights, privacy-gated.

### Assessment lifecycle (system workflow)
1. A **material event** occurs in the plant (e.g., attendance finalized, member assigned, person added) → the plant is marked **dirty**.
2. A **scheduled job** (≈daily) selects plants that are dirty **or** whose last assessment is older than the max-staleness window (time itself is a signal — countdowns move).
3. For each selected plant: compute the **fact snapshot** (Signal layer) → retrieve relevant methodology passages (RAG) → run the **judge** against the **active rubric** → write a new **assessment snapshot** → emit `plant.assessment.created`.
4. UI reads the latest snapshot; no LLM call on page load.

---

## 4. Functional Requirements

### Must Have

- **PE-001 (Phase tracking & transitions):** Track `current_phase` per church. Support planter-initiated transitions **forward, backward, or skipping**, each requiring a short reason. No transition is ever blocked (soft gating).
- **PE-002 (Transition audit trail):** Every transition records: from/to phase, initiating user, timestamp, reason, the **fact snapshot at that moment**, and the **rubric version**. Immutable.
- **PE-003 (`phase.changed` event):** Emit `phase.changed` on every successful transition for downstream consumers (task templates, wiki recommendations, dashboard, notifications). This preserves the existing contract relied on by F5 and F1.
- **PE-004 (Signal layer / Fact snapshot):** Compute a deterministic fact snapshot per plant from existing feature data — at minimum: committed core-group count + growth delta, vision-meeting cadence & attendance trend, follow-up staleness, ministry-role coverage (which of the 8 filled), per-person engagement/leadership-readiness signals, training progress, `launch_date` countdown. **No fact is ever produced by the LLM.**
- **PE-005 (Manual signals / self-attestation):** Allow planters to attest facts the system cannot observe (e.g., values documented, financial base, systems tested). Stored with who/when; included in the fact snapshot.
- **PE-006 (Rubric artifact):** The judge evaluates against a **versioned rubric** (`rubric-v0.md` is v0). The rubric is editable without code changes to the engine logic, and each assessment records the rubric version used.
- **PE-007 (LLM-as-judge assessment):** Produce an assessment by running the judge over (fact snapshot + current phase + rubric + retrieved methodology). The judge must reason **only over supplied facts**, must not invent numbers, and must cite which facts drove each insight.
- **PE-008 (Methodology RAG):** Ground the judge in retrieved passages from the Launch Playbook and wiki corpus, so guidance uses the methodology's own language and can link the planter to the relevant article.
- **PE-009 (Assessment snapshot):** Persist each assessment as a snapshot: timestamp, phase, rubric version, fact snapshot, model identifier, and a list of insights. Each insight carries: audience (planter | network), category (e.g., CSF tag / phase-focus), severity, title, body, cited facts, and related wiki slugs.
- **PE-010 (Event-driven, debounced execution):** Re-assess a plant only when it is **dirty** (a material event occurred since the last assessment) **or** past a max-staleness window. Quiet plants are not re-assessed. Define which events are "material."
- **PE-011 (Instant reads):** All planter/oversight surfaces read the **latest cached snapshot**. No assessment performs an LLM call during a page request.
- **PE-012 (Two audiences):** Each assessment yields planter-facing and network-facing insights. Network-facing insights are conservative (observations, not verdicts) and **privacy-gated** by the plant's `share_*` settings; individual-person insights are **never** exposed to the network.
- **PE-013 (Planter-sees-first):** A plant's planter can always see their own assessment; network-facing content must not surface anything the planter has not been able to see.
- **PE-014 (Insight feedback capture):** Capture per-insight feedback (rating + optional comment) from planters/coaches. This is retained from day one as the rubric-tuning signal — even before it is acted on.

### Should Have

- **PE-015 (Readiness prompt):** When the judge assesses a plant meets a phase's readiness marks, surface a "ready to advance" insight on the phase control.
- **PE-016 ("What changed"):** Each assessment summarizes deltas since the prior snapshot.
- **PE-017 (Network health rollup):** Provide a per-plant health classification (e.g., on-track / watch) for oversight portfolio views, derived from the assessment.
- **PE-018 (Cold-start handling):** For brand-new plants with little data, produce onboarding-oriented guidance rather than empty or misleading assessments.

### Nice to Have

- **PE-019 (Rubric as data):** Move the rubric from a code-defined artifact to a fully data-backed, per-network-configurable form (enables P3 methodology configurability).
- **PE-020 (Reactive criteria nudges):** Emit a `phase.criteria.updated`-style signal when a readiness threshold is newly crossed, to drive proactive notifications (depends on the notification layer).
- **PE-021 (Outcome linkage):** Associate historical assessments with eventual launch outcomes, building the dataset for cross-plant benchmarking and rubric evaluation.

---

## 5. Acceptance Criteria

- **AC-PE-1:** A planter can advance/regress/correct phase with a reason; the action never blocks; an immutable audit row is written with the fact snapshot + rubric version; `phase.changed` is emitted. *(PE-001/002/003)*
- **AC-PE-2:** The fact snapshot for a plant is reproducible from the database and contains no LLM-generated values; given identical data it yields identical facts. *(PE-004)*
- **AC-PE-3:** A planter can toggle a manual signal and see it reflected in the next assessment's reasoning. *(PE-005)*
- **AC-PE-4:** An assessment references the exact rubric version used; changing the rubric and re-running changes the recorded version. *(PE-006/009)*
- **AC-PE-5:** Every insight cites the fact(s) that produced it; no insight contains a count or date not present in the fact snapshot. *(PE-007)*
- **AC-PE-6:** At least one insight in a representative assessment links to a relevant wiki article retrieved via RAG. *(PE-008)*
- **AC-PE-7:** Loading the planter Focus panel and the oversight health view performs **zero** LLM calls (served from the snapshot). *(PE-011)*
- **AC-PE-8:** A plant with no material events since its last assessment is **not** re-assessed by the scheduled job; a plant with a material event (or past max-staleness) **is**. *(PE-010)*
- **AC-PE-9:** Network-facing output contains no individual-person insight and respects `share_*` settings; toggling a share setting off removes the corresponding network content. *(PE-012)*
- **AC-PE-10:** Insight feedback is persisted and queryable, associated with the insight, assessment, and rubric version. *(PE-014)*

---

## 6. Data Entities (feature-owned)

> Field-level schema is owned here; other features reference `Phase`/`Church` conceptually only.

- **PhaseTransition** — audit log of phase changes. `church_id`, `from_phase`, `to_phase`, `initiated_by`, `reason`, `fact_snapshot` (JSON), `rubric_version`, `created_at`. Append-only.
- **PlantSignal** — manual attestations. `church_id`, `signal_key`, `value`, `attested_by`, `attested_at`. (Computed facts are *not* stored here — they are derived at assessment time.)
- **PlantAssessment** — the snapshot. `church_id`, `generated_at`, `phase`, `rubric_version`, `fact_snapshot` (JSON), `model_id`, `status`. The current/latest per church drives all reads.
- **PlantInsight** — one finding within an assessment. `assessment_id`, `audience` (planter|network), `category`, `severity`, `title`, `body`, `cited_facts` (JSON), `related_article_slugs` (array). (May be embedded in `PlantAssessment` as JSON rather than a separate table — an implementation choice.)
- **InsightFeedback** — `insight_id` (or `assessment_id`), `user_id`, `rating`, `comment`, `created_at`.
- **Rubric** (v0: code/markdown artifact `rubric-v0.md`; future: data-backed) — versioned. The active version id is recorded on every assessment.
- **Plant dirtiness** — a lightweight mechanism to know whether re-assessment is needed (e.g., `churches.last_material_event_at` compared to the latest `PlantAssessment.generated_at`). Exact representation is an implementation choice.

`launch_date` is added to the **Church** core entity (a cross-cutting addition, see System Architecture) and feeds the countdown signal.

---

## 7. Integration Points

**Reads (Signal layer) from:**
- **People/CRM (F2):** core-group size, person statuses, per-person activity/tenure.
- **Vision Meetings (F3):** meeting cadence, attendance, new-contact inflow.
- **Ministry Teams (F8):** the 8 role assignments, training programs & completions, per-person engagement.
- **Tasks (F5):** task/checklist completion.
- **Financial (F7, when present):** giving / budget base. Until then, manual signal.
- **Church:** `launch_date`, `current_phase`, privacy settings.

**Subscribes to events** (to mark plants dirty): `meeting.attendance.finalized`, `team.member.assigned`, `person.created`, `task.completed`, and similar material events.

**Emits:**
- `phase.changed` — on transition (consumers: F5 phase task templates, F1 wiki recommendations, F4 dashboard).
- `plant.assessment.created` — when a new snapshot is ready (consumers: F4 dashboard, the notification/digest layer).

**Provides to:**
- **F4 Progress Dashboard** — latest planter assessment + phase state.
- **Oversight** — latest network assessment (privacy-gated).
- **Notification/digest layer** — new high-severity insights for outbound surfacing.

> The `phase.changed` contract is **unchanged** by the direction shift; consumers relying on it continue to work. What changes is the *addition* of the intelligence/assessment layer alongside it.

---

## 8. Non-Functional Requirements

- **NFR-PE-1 (Trust):** The fact/judgment separation is mandatory. The judge prompt must constrain reasoning to supplied facts and forbid inventing figures.
- **NFR-PE-2 (Cost):** Assessment runs are bounded — dirty-or-stale selection only, at most ~once/day per plant, with a max-staleness floor (e.g., weekly). No per-pageview LLM calls.
- **NFR-PE-3 (Latency):** Planter/oversight reads served from cached snapshots return without model latency.
- **NFR-PE-4 (Data privacy):** Plant data (including person-level facts) is sent to an LLM provider during assessment. Use a provider/configuration with **zero data retention**; document the provider and data-handling in config. No data crosses tenant boundaries.
- **NFR-PE-5 (Auditability & reproducibility):** Every assessment and transition records the rubric version, model id, and fact snapshot, so any output can be explained and reproduced.
- **NFR-PE-6 (Tenant isolation):** All entities are `church_id`-scoped; assessments and signals never leak across tenants.

---

## 9. Success Metrics

- **Insight usefulness rate** — % of insights rated useful by planters/coaches (primary quality signal; also the rubric-tuning input).
- **Action rate** — % of insights followed by a corresponding plant action within N days (e.g., a "hold a vision meeting" insight followed by a logged meeting).
- **Weekly engaged assessments** — plants with a viewed, fresh assessment per week.
- **Network engagement** — oversight users viewing plant health.
- **Moat metric (long-term):** correlation between assessment signals/readiness and eventual launch outcomes — the basis for cross-plant benchmarking (P3-3) and rubric evaluation.

---

## 10. Resolved Technical Decisions (June 2026)

| Area | Decision | Notes |
|------|----------|-------|
| Judge orchestration | **Vercel AI SDK `generateObject`** (structured output) + plain TypeScript pipeline | The judge is a structured pipeline (facts → retrieve → one validated LLM call → persist), not an agentic graph. **No LangGraph.** Provider stays behind `judge/provider.ts` for one-line swaps. |
| LLM provider | **OpenAI GPT family** via the AI SDK | Confirm OpenAI **zero-data-retention** posture for plant data before go-live (NFR-PE-4). Judge inference ≈ **$0.03–0.05 / assessment** (~$30/mo at beta scale); the only cost that matters. |
| Observability | **Self-hosted Langfuse** | Trace each judge run tagged with rubric version + model id; correlate traces with insight feedback to evaluate and tune the rubric. |
| RAG store | **pgvector on Neon** (same DB) | Corpus ≈ **215k tokens** / low-thousands of chunks — Pinecone would be over-engineering. Hybrid retrieval with the existing wiki `tsvector` FTS. |
| Embeddings | **`text-embedding-3-small`** (1536 dims; reducible to 1024) | **Section/heading chunking** (~300–800 tok, small overlap) with `phase` / `section` / `article_slug` metadata for **phase-filtered retrieval**. One-time corpus embed ≈ **$0.004**. |
| Cron | **Vercel Cron** → secret-guarded route, ~daily | Selects dirty-or-stale plants only (NFR-PE-2). |
| Embed scope | **Wiki articles + playbook** | The **rubric is NOT embedded** — it goes into the judge context *whole* every run. Historical assessments are a *future* embed (benchmarking, PE-021). |

**Related future work (out of scope for this FRD):** the **Church Plant Agent** — a conversational, tool-calling agent (with human confirmation + generative UI) that *executes* multi-step operations — is the action half of the app's chat-first AI direction and forms an insight→action loop with this feature (the judge surfaces what to do; the agent does it). It is captured in `features/church-plant-agent/vision.md`, which is where the agent-framework decision (AI SDK agent primitives vs. LangGraph vs. Vercel Workflow DevKit) is framed. The Plant Intelligence judge itself needs none of those.

## 11. Open Questions

1. **Rubric governance:** who edits the rubric, how is it versioned/reviewed, and when does criteria content get finalized with Brett & Bryan? (External dependency — Bryan back next week.)
2. **Materiality:** the exact list of events that mark a plant dirty (avoid both over-running and staleness).
3. **Insight volume:** how many insights per assessment before "judge fatigue" sets in — and how to rank/cap.
4. **Network conservatism:** auto-generated network health signals are in for beta (decided); revisit thresholds after first-cohort feedback.
5. **Prayer/Generosity signals (CSF-5/6):** weak system representation today; how much to lean on manual attestation vs. building data capture.
6. **Phase name canonicalization:** `src/lib/constants.ts` phase names differ from the product brief (e.g., Phase 1 "Foundation" vs "Core Group Development"); align to the brief.
