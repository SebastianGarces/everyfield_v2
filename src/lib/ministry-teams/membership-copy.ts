// ============================================================================
// The two seat refusals a team assignment can produce (#409 D1).
//
// AN IMPORT-FREE LEAF. Both sides of the refusal need the same sentence: the
// service throws it (`assignMember`, through `ExpectedError`) and the assign
// dialog reads it back to decide whether the roles tab it is sitting on has
// gone stale. The dialog is a `"use client"` module and
// `@/lib/ministry-teams/service` opens with `@/db`, so the wording lives here
// rather than there — the same rule as `src/lib/invitations/register-path.ts`,
// and for the same reason: a leaf whose contents are also served from the trunk
// is not a leaf, so neither `memberships.ts` nor `service.ts` re-exports these.
// ============================================================================

/**
 * The seat is taken. Produced by `team_memberships_role_active_unique_idx`
 * (migration 0038) and by the legible pre-check in front of it.
 *
 * WHAT THE PLANTER SHOULD DO ABOUT IT is not in the sentence, because the two
 * answers depend on what they meant: remove the current holder, or add a second
 * role to the team. The dialog refreshes the page underneath so the occupant
 * they did not know about is on screen when they read this.
 */
export const ROLE_ALREADY_FILLED_MESSAGE = "Role is already filled";

/** This person already holds this exact seat — a double-submitted assignment. */
export const PERSON_ALREADY_ASSIGNED_MESSAGE =
  "Person is already assigned to this role";

/**
 * Translate a unique-violation on either active-membership index into the user
 * copy it means. Returns `null` for anything else, so its caller rethrows real
 * faults untouched.
 *
 * WHY A TRANSLATION AND NOT A PRE-CHECK. The reactivation path in
 * `assignMember` is an UPDATE, and an UPDATE takes no `ON CONFLICT`. A
 * `WHERE NOT EXISTS (… active row …)` predicate would look like a guard and be
 * none — it is a snapshot read about rows other statements are writing, the trap
 * `memory/invariants.md` → Transactions describes — so the index stays the only
 * guard on both paths and this function is purely about what the planter reads.
 * The write itself is already correct without it: the violation aborts the whole
 * `db.batch`, so a refused reactivation leaves the role's status alone too.
 *
 * WHY IT LIVES IN THE LEAF AND IS EXPORTED. It is the ONLY thing standing
 * between a lost reactivation race and a raw `duplicate key value violates
 * unique constraint …` reaching a planter, and it decides that by matching
 * strings in a driver error — an assumption that has to be TESTED, not asserted
 * in a comment. Here it is a pure function over an error object with no `@/db`
 * import above it, so `membership-conflict.test.ts` pins it on every
 * `pnpm test`; inside `memberships.ts` the only test that could reach it was one
 * of the live opt-in suites.
 *
 * THE ERROR SHAPE, MEASURED RATHER THAN ASSUMED (2026-08-13, Postgres 16 with
 * migration 0038, over neon-http). BOTH halves below are load-bearing: a
 * `db.batch([...])` — which is what the reactivation is — throws the driver's
 * `NeonDbError` DIRECTLY, so the constraint name is in `message`; a
 * single-statement write is wrapped in Drizzle's `Failed query: <sql>` with
 * that error on `cause`, and the wrapper names no constraint at all. Reading
 * only `cause` would miss the reactivation. `membership-conflict.test.ts` pins
 * both shapes, hermetically.
 */
export function membershipConflictMessage(error: unknown): string | null {
  const text = [
    error instanceof Error ? error.message : String(error),
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "",
  ].join(" ");

  if (text.includes("team_memberships_role_active_unique_idx")) {
    return ROLE_ALREADY_FILLED_MESSAGE;
  }
  if (text.includes("team_memberships_active_unique")) {
    return PERSON_ALREADY_ASSIGNED_MESSAGE;
  }
  return null;
}
