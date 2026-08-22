// ============================================================================
// A REJECTED DRAFT, and the ladder that gives up on one (#605).
//
// The judge holds its own output to four rules (schema.ts): audience coverage,
// the observation budget, the network verdict register, and planter-first
// pairing. A draft that breaks one is refused by the parse, and `generateObject`
// reports that as `NoObjectGeneratedError`.
//
// THAT IS NOT A TRANSPORT FAILURE, and the distinction is the whole bug. The
// provider answered; the answer broke a rule stated in the rubric. Re-sending
// the identical prompt draws the identical mistake — which is exactly what the
// throttle ladder (#36) was doing with it, because a `NoObjectGeneratedError`
// carries no status code and `isRetryableError` therefore answered yes. One
// rejected draft cost four gpt-4o calls and ~48s of backoff, spent the ladder
// that exists for real 429s, and then recorded the plant `failed`.
//
// So rejections get their own ladder (run-assessment.ts), and it re-prompts
// rather than repeats: the rule that rejected the draft goes back into the user
// message, so the model is correcting a stated rule instead of rolling again.
//
// This module is the vocabulary both ladders share, and it is pure: it reads
// errors and returns names. Nothing here calls a provider or sleeps.
// ============================================================================

import { NoObjectGeneratedError } from "ai";

import { JUDGE_RULES, type JudgeRule } from "./schema";

/** What the judge's own rules said about one draft. */
export interface DraftRejection {
  /**
   * The rules that rejected it, deduplicated and in the order they fired.
   * Empty when the draft failed the object SHAPE rather than a named rule (a
   * body under the minimum length, an unparseable response) — those still get
   * their messages, they just have no rule to be counted under.
   */
  rules: JudgeRule[];
  /**
   * The validation messages, verbatim. These are written FOR the model — each
   * one states the rule and what to do instead — so they are what the retry
   * feeds back into the prompt.
   */
  messages: string[];
}

/**
 * True when the provider answered but no valid object came out of it.
 *
 * The ONE spelling of "this belongs to the schema ladder, not the throttle
 * ladder". `paced-call.ts` asks it to stand down; `run-assessment.ts` asks it
 * to re-prompt. A second copy is how the two ladders start disagreeing about
 * whose failure this is.
 */
export function isDraftRejection(error: unknown): boolean {
  return NoObjectGeneratedError.isInstance(error);
}

/**
 * Read a rejected draft's error for the rules that rejected it.
 *
 * @returns null when `error` is not a rejected draft at all — a 429, a socket
 *          reset, a broken database write — so a caller can use this as the
 *          branch test and the description in one step.
 */
export function describeDraftRejection(error: unknown): DraftRejection | null {
  if (!isDraftRejection(error)) return null;

  const issues = findIssues(error);
  if (issues.length === 0) {
    // The SDK refused the response without a validation error behind it — an
    // unparseable body, or a provider-side refusal. There is no rule to name,
    // but the model can still be told what was wrong with what it sent.
    return { rules: [], messages: [(error as Error).message] };
  }

  const rules: JudgeRule[] = [];
  const messages: string[] = [];

  for (const issue of issues) {
    const rule = ruleOf(issue);
    if (rule && !rules.includes(rule)) rules.push(rule);
    const path = issue.path?.length ? `${issue.path.join(".")}: ` : "";
    messages.push(`${path}${issue.message}`);
  }

  return { rules, messages };
}

/** The shape a Zod error presents, without importing Zod's internals. */
interface ValidationIssue {
  code?: unknown;
  path?: unknown[];
  message: string;
  params?: Record<string, unknown>;
}

/**
 * The validation issues buried in an SDK error.
 *
 * `NoObjectGeneratedError` wraps a `TypeValidationError` which wraps the
 * `ZodError`, so the issues are two `cause` hops down. Walking rather than
 * reaching for `error.cause.cause` keeps this working if the SDK adds or drops
 * a wrapper — the same reason `rate-limit.ts` walks for its 429.
 */
function findIssues(error: unknown): ValidationIssue[] {
  let candidate: unknown = error;
  for (let depth = 0; candidate != null && depth < 5; depth++) {
    const issues = (candidate as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      return issues.filter(
        (issue): issue is ValidationIssue =>
          typeof issue === "object" &&
          issue !== null &&
          typeof (issue as { message?: unknown }).message === "string"
      );
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return [];
}

/** The rule a refinement issue was tagged with, or null for a shape issue. */
function ruleOf(issue: ValidationIssue): JudgeRule | null {
  const tag = issue.params?.rule;
  return typeof tag === "string" &&
    (JUDGE_RULES as readonly string[]).includes(tag)
    ? (tag as JudgeRule)
    : null;
}

/** Why the schema ladder stopped re-prompting. */
export type SchemaRejectionReason = "attempts_exhausted" | "run_budget";

/** Reported on every rejected draft, so a retry is visible and not inferred. */
export interface SchemaRejectionEvent {
  label: string;
  attempt: number;
  maxAttempts: number;
  rules: JudgeRule[];
  messages: string[];
  /** True when this was the last draft and the assessment is being failed. */
  exhausted: boolean;
}

/**
 * Thrown when every draft the judge produced was rejected by its own rules.
 *
 * A judge FAILURE, not a deferral — the provider answered every time and every
 * answer was unusable, so `assessmentStatusForFailure` records `failed` and the
 * run says the judge is misbehaving. That is the opposite reading from
 * `RateLimitDeferralError`, which means we never learned anything about the
 * judge at all.
 *
 * THE RULE IS IN THE MESSAGE, and that is the point (AC-3): before this, a
 * `failed` row said only "response did not match schema", so learning which of
 * four rules rejected it meant reproducing the run against a live model. The
 * message leads with the rule names for the same reason — log lines and
 * transcripts truncate, and the rule is the part worth keeping.
 */
export class SchemaRejectionError extends Error {
  readonly name = "SchemaRejectionError";
  readonly rules: JudgeRule[];
  readonly messages: string[];
  /** Drafts the model produced, all of them rejected. */
  readonly attempts: number;
  readonly reason: SchemaRejectionReason;

  constructor(
    label: string,
    attempts: number,
    rejection: DraftRejection,
    cause: unknown,
    reason: SchemaRejectionReason = "attempts_exhausted"
  ) {
    const named =
      rejection.rules.length > 0
        ? rejection.rules.join(", ")
        : "the judge output schema";
    super(
      `Judge output rejected by ${named} on all ${attempts} draft(s)` +
        `${label ? ` for ${label}` : ""}` +
        (reason === "run_budget"
          ? "; the run's time budget stopped further attempts"
          : "") +
        `. Last rejection: ${rejection.messages.join(" | ")}`,
      { cause }
    );
    this.rules = rejection.rules;
    this.messages = rejection.messages;
    this.attempts = attempts;
    this.reason = reason;
  }

  static isInstance(error: unknown): error is SchemaRejectionError {
    return error instanceof Error && error.name === "SchemaRejectionError";
  }
}

/** True when the judge's own rules, not the provider, ended the assessment. */
export function isSchemaRejection(
  error: unknown
): error is SchemaRejectionError {
  return SchemaRejectionError.isInstance(error);
}
