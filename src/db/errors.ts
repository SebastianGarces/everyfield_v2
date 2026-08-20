/** Postgres `unique_violation`. */
export const PG_UNIQUE_VIOLATION = "23505";

/**
 * True when `error` is a Postgres unique violation on EXACTLY `constraint` —
 * the canonical predicate for "the unique index is the concurrency guard, and
 * it just did its job" catches (`memory/invariants.md` → Transactions).
 *
 * Narrow on purpose: any unique violation on a DIFFERENT constraint is a real
 * bug and must still propagate, or a caller could swallow a failed insert as
 * an expected race. Drizzle wraps driver errors, so the cause chain is walked
 * (bounded, in case something ever builds a cycle) rather than just the top
 * error.
 *
 * THE `constraint` FIELD DECIDES, AND NOTHING ELSE (#323 WS1). This used to
 * fall back to `message.includes(constraint)`, which is a substring test over
 * text an attacker can steer: Postgres puts the offending VALUE into some
 * 23505 messages, so a row crafted to carry an index name in a unique column
 * made an unrelated violation read as "our index just did its job" — and a
 * swallowed violation is a meeting finalized with no follow-up tasks. The
 * fallback also bought nothing measurable: both shapes the drivers really
 * raise populate `constraint` on the error the walk reaches
 * (`membership-conflict.test.ts` pins both, captured against Postgres 16 over
 * neon-http), and the Drizzle wrapper that carries only the message carries
 * the real error on `cause` one level down.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;

  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (typeof current !== "object") return false;

    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };

    if (
      candidate.code === PG_UNIQUE_VIOLATION &&
      candidate.constraint === constraint
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}
