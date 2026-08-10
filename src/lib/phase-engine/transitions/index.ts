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
  declareInitialPhase,
  declareInitialPhaseStatement,
  deriveReadiness,
  hasInitialPhaseDeclaration,
  initialPhaseDeclarationSchema,
  INITIAL_DECLARATION_KIND,
  INITIAL_DECLARATION_REASON,
  isInitialDeclaration,
  TRANSITION_KIND,
  transitionPhaseSchema,
  ChurchNotFoundError,
  MIN_PHASE,
  MAX_PHASE,
  type BuildTransitionRowInput,
  type DeclareInitialPhaseResult,
  type InitialPhaseDeclarationInput,
  type PhaseReadiness,
  type TransitionDirection,
  type TransitionPhaseInput,
  type TransitionResult,
} from "./service";
