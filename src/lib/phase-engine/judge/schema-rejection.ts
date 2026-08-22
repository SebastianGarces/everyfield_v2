// ============================================================================
// A REJECTED DRAFT, and the ladder that gives up on one (#605).
//
// The judge holds its own output to the rules in `JUDGE_RULES` (schema.ts):
// audience coverage, the observation budget, the network verdict register,
// planter-first pairing, and "unknown is not healthy". A draft that breaks one
// is refused by the parse, and `generateObject` reports that as
// `NoObjectGeneratedError`.
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

/** One thing wrong with a draft. */
export interface DraftIssue {
  /**
   * The rule that raised it, or null for a plain SHAPE violation (a body under
   * the minimum length, an unparseable response) — those still get a message,
   * they just have no rule to be counted under.
   */
  rule: JudgeRule | null;
  /**
   * The validation message, verbatim. These are written FOR the model — each
   * one states the rule and what to do instead — so they are what the retry
   * feeds back into the prompt.
   */
  message: string;
}

/** What the judge's own rules said about one draft. */
export interface DraftRejection {
  /** Everything wrong with it, one entry per validation issue. */
  issues: DraftIssue[];
  /**
   * The named rules among those issues, deduplicated and in the order they
   * fired. Derived at construction and never mutated — it is what the run log,
   * the summary and `SchemaRejectionError` all count.
   */
  rules: JudgeRule[];
}

/**
 * What a retry is told, once more than one draft has been rejected.
 *
 * A draft is told to fix ONE thing and often fixes it by breaking another. The
 * eval fleet showed it exactly: EVAL-05 was told its network language delivered
 * a verdict, softened it, and came back over the observation budget; told about
 * the budget, it dropped a planter item and left a network concern unpaired.
 * Every correction was right, every draft was rejected, and the plant was lost
 * — because the model was only ever holding the last message.
 *
 * So the correction carries both halves.
 */
export interface DraftCorrection {
  /** What the latest draft broke. Fix these. */
  fix: DraftIssue[];
  /**
   * What EARLIER drafts broke and the latest one did not. Keep these satisfied
   * — this is the half that stops the model trading one rule for another.
   */
  keep: DraftIssue[];
}

/**
 * Fold the newest rejection into what earlier drafts already broke.
 *
 * A rule leaves `keep` only by being broken again (it moves back to `fix`), so
 * a rule the model has been warned about stays in front of it for the rest of
 * the ladder. Shape issues are never carried: they are specific to the draft
 * that produced them and read as nonsense against the next one.
 */
export function carryCorrectionForward(
  previous: DraftCorrection | null,
  latest: DraftRejection
): DraftCorrection {
  // Keyed by rule, so "one entry per rule" and "never more than JUDGE_RULES
  // entries" are properties of the structure rather than of this loop — a
  // ladder cannot accumulate a growing list however many drafts it takes.
  const carried = new Map<JudgeRule, DraftIssue>();
  for (const issue of [...(previous?.keep ?? []), ...(previous?.fix ?? [])]) {
    if (issue.rule !== null) carried.set(issue.rule, issue);
  }
  for (const rule of latest.rules) carried.delete(rule);

  return { fix: latest.issues, keep: [...carried.values()] };
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
 * What a rejected draft cost, so the token pacer can still meter it.
 *
 * A rejection is a completed, billed call: the SDK hangs the provider's
 * response metadata and usage off the error rather than discarding them. Both
 * are `undefined` when the provider gave none, which `observeResponse` already
 * treats as "learned nothing".
 */
export function draftCost(error: unknown): {
  headers: Record<string, string> | undefined;
  totalTokens: number | undefined;
} {
  if (!NoObjectGeneratedError.isInstance(error)) {
    return { headers: undefined, totalTokens: undefined };
  }
  return {
    headers: error.response?.headers,
    totalTokens: error.usage?.totalTokens,
  };
}

/** Did the token cap end this draft rather than the model finishing it? */
function isTruncated(error: NoObjectGeneratedError): boolean {
  return error.finishReason === "length";
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

  // A DRAFT THE TOKEN CAP CUT OFF IS NOT WORTH RE-PROMPTING. The correction
  // block makes the next prompt LONGER than the one that already overflowed, so
  // all three drafts are guaranteed to fail and the plant pays for three
  // completions to learn nothing. Refusing the ladder here sends the provider's
  // own error up as itself, which reads correctly in the run log.
  if (NoObjectGeneratedError.isInstance(error) && isTruncated(error)) {
    return null;
  }

  const found = findIssues(error);
  if (found.length === 0) {
    // The SDK refused the response without a validation error behind it — an
    // unparseable body, or a provider-side refusal. There is no RULE to name,
    // so the message says so rather than being rendered as one: telling a model
    // it "broke the rule" quoted below, when the text below is "could not parse
    // the response", is an instruction it cannot act on.
    return {
      issues: [
        {
          rule: null,
          message: `Your previous response could not be read as the required object and was discarded: ${(error as Error).message} Return only the object the schema describes.`,
        },
      ],
      rules: [],
    };
  }

  const issues: DraftIssue[] = found.map((issue) => {
    const path = issue.path?.length ? `${issue.path.join(".")}: ` : "";
    return { rule: ruleOf(issue), message: `${path}${issue.message}` };
  });

  const rules: JudgeRule[] = [];
  for (const issue of issues) {
    if (issue.rule && !rules.includes(issue.rule)) rules.push(issue.rule);
  }

  return { issues, rules };
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
  issues: DraftIssue[];
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
  readonly issues: DraftIssue[];
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
        `. Last rejection: ${rejection.issues.map((issue) => issue.message).join(" | ")}`,
      { cause }
    );
    this.rules = rejection.rules;
    this.issues = rejection.issues;
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
