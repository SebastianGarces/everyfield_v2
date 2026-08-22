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
  JUDGE_RULES,
} from "./schema";
export type {
  Insight,
  InsightAudience,
  InsightCategory,
  InsightSeverity,
  JudgeOutput,
  AssessmentResult,
  JudgeRule,
} from "./schema";

// The judge's own rules refusing its own output (#605). `isSchemaRejection` is
// how the batch runner tells "the judge would not follow a rule" apart from
// "the provider would not talk to us" (`isRateLimitDeferral`) and from a plain
// broken call — three different sentences in the 07:00 log.
//
// The PREDICATE and the event shape are the whole surface, on purpose. The
// error class, `describeDraftRejection` and `draftCost` stay directory-internal
// so nothing outside this module can start classifying rejections for itself —
// the vocabulary has one owner, the way the ban-list does (#538).
export {
  isSchemaRejection,
  type SchemaRejectionEvent,
} from "./schema-rejection";

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
