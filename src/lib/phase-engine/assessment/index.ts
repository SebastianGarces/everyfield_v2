// ============================================================================
// Phase Engine — assessment orchestrator public surface.
//
// Ties the Signal layer + LLM-as-judge to persistence and the event bus:
// generate a snapshot, run the judge, write a privacy-safe, ranked, delta-aware
// assessment, and emit `plant.assessment.created`. Also owns dirty/stale plant
// selection and the instant-read queries for the latest complete snapshot.
// ============================================================================

export {
  generateAssessment,
  type GenerateAssessmentDeps,
  type GenerateAssessmentResult,
} from "./generate-assessment";

export {
  selectPlantsForAssessment,
  assessmentReleasedToOversight,
  getLatestAssessment,
  markAssessmentSeenByPlanter,
  PLANTER_FIRST_WINDOW_HOURS,
  getLatestCompleteSnapshot,
  type LatestAssessment,
  type SelectedPlant,
} from "./queries";

// The attestation → signal resolution the surfaces read a citation through
// (ruled 2026-08-12 on #319). `AssessedInsight` is a `PlantInsight` carrying
// that map; every component that renders `cited_facts` takes one, so the words
// a planter reads cannot depend on which of two legal spellings the judge
// happened to emit.
export { resolveCitedFactSignals, type AssessedInsight } from "./snapshot-fact";

// The 8-factor CSF scorecard (PE-023) — a pure projection of the persisted
// snapshot plus its DB-backed convenience read.
//
// `getCsfScorecard` has no caller anywhere in `src/`, and that is correct — do
// NOT prune it as dead code. It is the regeneration step for the landing
// page's frozen scorecard fixture,
// `src/app/(marketing)/_components/vignettes/csf-fixture.ts`, whose header
// tells the next person to re-run it against the source church and paste the
// result back over the constant. That fixture already imports `CsfScorecard`
// from this barrel, so this is the surface its note points at. The full
// rationale — including why the function takes no `audience` argument — lives
// on the definition in `./queries.ts`.
export {
  buildCsfScorecard,
  getCsfScorecard,
  csfStandingUrgency,
  isCsfCategory,
  standingForSeverity,
  CSF_CATEGORIES,
  CSF_DEFINITIONS,
  CSF_DEFINITION_BY_CATEGORY,
  CSF_STANDINGS,
  type CsfCategory,
  type CsfDefinition,
  type CsfFactorStanding,
  type CsfScorecard,
  type CsfStanding,
  type RaisedCsfStanding,
} from "./queries";

// The current phase's exit criteria with their fact drill-down (PE-022 +
// PE-025) — a second pure projection of the same persisted snapshot the CSF
// scorecard reads.
export {
  buildExitCriteriaProgress,
  EXIT_CRITERION_MEASURE_STATUSES,
  EXIT_CRITERION_STANDINGS,
  PHASE_EXIT_CRITERIA,
  type CitedFactEvidence,
  type ExitCriteriaProgress,
  type ExitCriterionDefinition,
  type ExitCriterionMeasureStatus,
  type ExitCriterionProgress,
  type ExitCriterionStanding,
} from "./exit-criteria";

// `readSnapshotFact` is exported alongside that projection because it is the one
// path-reader the criteria are defined against; a caller wanting a raw fact out
// of a stored snapshot must use it rather than reaching into the JSON, or
// "every value is SQL-derived" stops being checkable.
export { readSnapshotFact, type SnapshotFact } from "./snapshot-fact";

export {
  MAX_STALENESS_MS,
  isDirtyOrStale,
  filterDirtyOrStale,
  orderByAssessmentAge,
  selectionReasonFor,
  type PlantSelectionInput,
  type SelectionReason,
} from "./dirty";

export {
  mapSeverity,
  filterInsightsForPersistence,
  isIndividualPersonFinding,
  buildInsightRows,
  computeSnapshotDelta,
  type SnapshotDelta,
  type SnapshotDeltaField,
} from "./persist";

export {
  emitPlantAssessmentCreated,
  emitPhaseChanged,
  type PlantAssessmentCreatedEvent,
  type PhaseChangedEvent,
} from "../events";
