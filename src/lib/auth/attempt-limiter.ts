// ============================================================================
// THE SHARED GUARD, AS ONE OBJECT THE SELF-SERVICE FLOWS TAKE — CS-005 (#616).
//
// THIS IS NOT A SECOND RATE LIMITER. It is the SAME two functions
// (`@/lib/auth/rate-limit`), bound together so `requestEmailChange`,
// `confirmEmailChange` and `changeOwnPassword` can be handed them instead of
// reaching for the module directly. CS-005 says one implementation and never a
// second copy; this file adds no policy, no window, no threshold and no
// counting of its own, and the only thing it could ever be given is a different
// STORE for the same policy.
//
// WHY IT EXISTS. Both flows refuse before they ever touch a table — a wrong
// current password, a malformed address, an address that is already yours — and
// those refusals are the acceptance criteria. Without this seam none of them is
// reachable from a unit test, because the FIRST statement of each flow is a
// database count and `@/db` is a neon-http client that cannot answer one
// without a live Postgres. With it, `password-change.test.ts` drives the REAL
// `checkRateLimit` — the real thresholds, the real axes, the real window
// arithmetic — over an in-memory list of attempts, and the wrong-password
// refusal executes for real against a real argon2 hash.
//
// WHAT IT DOES *NOT* LET A CALLER REPLACE IS THE POLICY. The flows call
// `checkRateLimit` themselves and pass `limiter.count` into it, so the only
// thing substitutable is WHERE the attempts are stored. A member that stood in
// for `checkRateLimit` itself would have been a second answer to "is this
// caller over the limit", which is precisely what CS-005 forbids.
//
// THE DEFAULT IS PRODUCTION. Every call site takes `REAL_ATTEMPT_LIMITER`
// unless a test passes something else, so there is no branch in the flows and
// no environment check anywhere.
// ============================================================================

import {
  countAuthAttemptFailures,
  recordAttempt,
  type FailureCounter,
} from "./rate-limit";

export interface AttemptLimiter {
  /**
   * HOW FAILURES ARE COUNTED — handed straight to `checkRateLimit`, which is
   * still the thing that decides. ONE seam, not two: an interface member that
   * wrapped `checkRateLimit` itself would let a caller substitute the POLICY,
   * which is the one thing CS-005 says may never have a second copy.
   */
  count: FailureCounter;
  /** `recordAttempt` — the write that counts a failure and clears on success. */
  record: typeof recordAttempt;
}

/** The `auth_attempts` table, through the functions every auth flow already uses. */
export const REAL_ATTEMPT_LIMITER: AttemptLimiter = {
  count: countAuthAttemptFailures,
  record: recordAttempt,
};
