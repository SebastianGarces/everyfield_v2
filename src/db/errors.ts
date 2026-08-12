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
 * error; the constraint is matched by field or by message because which one
 * the driver populates varies by wrapping.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;

  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (typeof current !== "object") return false;

    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const message =
      typeof candidate.message === "string" ? candidate.message : "";

    if (
      candidate.code === PG_UNIQUE_VIOLATION &&
      (candidate.constraint === constraint || message.includes(constraint))
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}
