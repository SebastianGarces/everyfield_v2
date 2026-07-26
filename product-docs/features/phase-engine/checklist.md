# Phase Engine (Plant Intelligence) – Implementation Checklist

> Tracks implementation against `frd.md`. Update this file as work progresses; keep the FRD stable.

## Must Have
- [x] PE-001: Phase tracking + planter-initiated transitions (forward/back/skip, reason, never blocked) — `src/lib/phase-engine/transitions/service.ts`
- [x] PE-002: Immutable transition audit trail (fact snapshot + rubric version) — `phase_transitions` in `src/db/schema/phase-engine.ts`
- [x] PE-003: `phase.changed` event emitted on transition — `src/lib/phase-engine/events.ts`
- [x] PE-004: Signal layer / deterministic fact snapshot (no LLM-produced facts) — `src/lib/phase-engine/signals/build-fact-snapshot.ts`
- [x] PE-005: Manual signals / self-attestation — `src/lib/phase-engine/signals/attestation-service.ts` + `plant_signals` table
- [x] PE-006: Versioned rubric artifact (v0 = `rubric-v0.md`) — `src/lib/phase-engine/rubric.ts` (version recorded per assessment)
- [x] PE-007: LLM-as-judge assessment (facts-only reasoning, cites facts) — `src/lib/phase-engine/judge/run-assessment.ts` (`citedFacts` required in schema)
- [x] PE-008: Methodology RAG over playbook + wiki — `src/lib/phase-engine/rag/retrieve.ts` (hybrid pgvector + FTS, RRF)
- [x] PE-009: Assessment snapshot persistence (insights with audience/severity/citations) — `plant_assessments` + `plant_insights` tables
- [x] PE-010: Event-driven, debounced execution (dirty-or-stale selection) — `src/lib/phase-engine/dirty-handler.ts` + Vercel Cron → `src/app/api/phase-engine/assess/route.ts`
- [x] PE-011: Instant reads from cached snapshot (no per-pageview LLM call) — `src/lib/phase-engine/assessment/queries.ts` (`getLatestAssessment`)
- [x] PE-012: Two audiences (planter / network), network privacy-gated, no individual insights to network — `run-assessment.ts` audience guard + `src/lib/phase-engine/assessment/persist.ts` + `src/lib/phase-engine/oversight/read.ts` (`share_*` gating)
- [x] PE-013: Planter-sees-first guarantee — `src/lib/phase-engine/oversight/read.ts` (COMPLETE-snapshots-only reads)
- [x] PE-014: Insight feedback capture (rubric-tuning signal) — `insight_feedback` table + `src/lib/phase-engine/feedback/service.ts`

- [x] NFR-PE-4a: Provider + data-handling terms recorded in the feature's config documentation — `data-posture.md`
- [ ] NFR-PE-4b: Strongest retention/training controls enabled on the provider account
  - [x] Judge call opted out of OpenAI retention in code (`store: false`)
  - [ ] **Beta gate:** disable "Share inputs and outputs with OpenAI" — deliberately left ON pre-beta for the complimentary tokens; must be OFF before any real church uses the product
- [ ] NFR-PE-4c: Data processing disclosed in plain language to planters, coaches, and network users — must state the *current* posture, which includes sharing-for-training until the beta gate above is closed

## Should Have
- [ ] NFR-PE-4d: Zero data retention adopted once the account is contractually eligible (enterprise, post-revenue — not a go-live gate)
- [x] PE-015: "Ready to advance" readiness prompt — `deriveReadiness` in `src/lib/phase-engine/transitions/service.ts` + `src/components/phase-engine/phase-control.tsx`
- [x] PE-016: "What changed since last assessment" — `computeSnapshotDelta` in `src/lib/phase-engine/assessment/persist.ts`
- [x] PE-017: Network health rollup for portfolio views — `src/lib/phase-engine/oversight/health-presentation.ts` + `src/components/phase-engine/plant-health-portfolio.tsx`
- [x] PE-018: Cold-start handling for new plants — `isColdStart` signal + `onboarding` insight category (`src/lib/phase-engine/judge/schema.ts`)

## Nice to Have
- [ ] PE-019: Rubric as data / per-network configurable
- [ ] PE-020: Reactive readiness nudges (`phase.criteria.updated`)
- [ ] PE-021: Assessment ↔ launch-outcome linkage (benchmarking dataset)

## Substrate notes (sequencing)
The deterministic substrate — PE-001/002/003/004/005 + `launch_date` + dirty-tracking + the snapshot table — is the foundation the judge needs and is the natural first slice (aligns with the gap report's Sprint B). The judge + rubric + RAG + cron (PE-006/007/008/009/010) is the headline AI layer that follows.
