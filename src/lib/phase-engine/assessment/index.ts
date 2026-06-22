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
  getLatestAssessment,
  getLatestCompleteSnapshot,
  type LatestAssessment,
  type SelectedPlant,
} from "./queries";

export {
  MAX_STALENESS_MS,
  isDirtyOrStale,
  filterDirtyOrStale,
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
