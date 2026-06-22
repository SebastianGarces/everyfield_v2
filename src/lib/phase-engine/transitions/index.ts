// ============================================================================
// Phase Engine — phase transition public surface.
//
// Soft-gated phase control (PE-001/002/003) + readiness exposure (PE-015).
// Import `transitionPhase` / `getPhaseReadiness` from here; the validation
// schema and pure helpers are also re-exported for the action layer + tests.
// ============================================================================

export {
  transitionPhase,
  getPhaseReadiness,
  buildTransitionRow,
  classifyTransition,
  deriveReadiness,
  transitionPhaseSchema,
  ChurchNotFoundError,
  MIN_PHASE,
  MAX_PHASE,
  type BuildTransitionRowInput,
  type PhaseReadiness,
  type TransitionDirection,
  type TransitionPhaseInput,
  type TransitionResult,
} from "./service";
