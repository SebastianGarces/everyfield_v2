// ============================================================================
// Phase Engine — LLM-as-judge (judgment layer) public surface.
//
// The headline AI layer: turn a deterministic fact snapshot into grounded,
// audited insights via one validated `generateObject` call. Callers import
// `runAssessment` from here; the prompt/provider/observability internals are an
// implementation detail.
// ============================================================================

export { runAssessment } from "./run-assessment";
export type { RunAssessmentOptions } from "./run-assessment";

export {
  judgeOutputSchema,
  insightSchema,
  insightAudienceSchema,
  insightCategorySchema,
  insightSeveritySchema,
  hasBothAudiences,
} from "./schema";
export type {
  Insight,
  InsightAudience,
  InsightCategory,
  InsightSeverity,
  JudgeOutput,
  AssessmentResult,
} from "./schema";

export { JUDGE_MODEL_ID } from "./provider";
