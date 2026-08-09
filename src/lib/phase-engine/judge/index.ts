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

// Throttle surface (#36). The cron batch owns one `TokenPacer` per run and
// threads it through every plant; `isRateLimitDeferral` is how the runner tells
// throttling apart from a genuine judge failure.
export {
  TokenPacer,
  realClock,
  resolveTpmLimit,
  DEFAULT_TPM_LIMIT,
  DEFAULT_TOKENS_PER_ASSESSMENT,
  TPM_WINDOW_MS,
  type PacerClock,
  type PacerStats,
  type TokenPacerOptions,
} from "./token-pacer";

export {
  runPacedCall,
  isRateLimitDeferral,
  RateLimitDeferralError,
  DEFAULT_MAX_ATTEMPTS,
  type PacedCallOptions,
  type PacedCallResult,
  type RateLimitEvent,
} from "./paced-call";

export {
  isRateLimitError,
  isRetryableError,
  retryAfterMsFromError,
  readRateLimitSnapshot,
  parseDurationMs,
  normalizeHeaders,
  headersFromError,
  type HeaderLike,
  type RateLimitSnapshot,
} from "./rate-limit";
