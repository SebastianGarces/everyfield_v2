# Phase Engine (Plant Intelligence) – Implementation Checklist

> Tracks implementation against `frd.md`. Update this file as work progresses; keep the FRD stable.

## Must Have
- [ ] PE-001: Phase tracking + planter-initiated transitions (forward/back/skip, reason, never blocked)
- [ ] PE-002: Immutable transition audit trail (fact snapshot + rubric version)
- [ ] PE-003: `phase.changed` event emitted on transition
- [ ] PE-004: Signal layer / deterministic fact snapshot (no LLM-produced facts)
- [ ] PE-005: Manual signals / self-attestation
- [ ] PE-006: Versioned rubric artifact (v0 = `rubric-v0.md`)
- [ ] PE-007: LLM-as-judge assessment (facts-only reasoning, cites facts)
- [ ] PE-008: Methodology RAG over playbook + wiki
- [ ] PE-009: Assessment snapshot persistence (insights with audience/severity/citations)
- [ ] PE-010: Event-driven, debounced execution (dirty-or-stale selection)
- [ ] PE-011: Instant reads from cached snapshot (no per-pageview LLM call)
- [ ] PE-012: Two audiences (planter / network), network privacy-gated, no individual insights to network
- [ ] PE-013: Planter-sees-first guarantee
- [ ] PE-014: Insight feedback capture (rubric-tuning signal)

## Should Have
- [ ] PE-015: "Ready to advance" readiness prompt
- [ ] PE-016: "What changed since last assessment"
- [ ] PE-017: Network health rollup for portfolio views
- [ ] PE-018: Cold-start handling for new plants

## Nice to Have
- [ ] PE-019: Rubric as data / per-network configurable
- [ ] PE-020: Reactive readiness nudges (`phase.criteria.updated`)
- [ ] PE-021: Assessment ↔ launch-outcome linkage (benchmarking dataset)

## Substrate notes (sequencing)
The deterministic substrate — PE-001/002/003/004/005 + `launch_date` + dirty-tracking + the snapshot table — is the foundation the judge needs and is the natural first slice (aligns with the gap report's Sprint B). The judge + rubric + RAG + cron (PE-006/007/008/009/010) is the headline AI layer that follows.
