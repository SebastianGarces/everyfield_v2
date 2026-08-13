import {
  TEAM_MEMBERSHIPS_ACTIVE_UNIQUE,
  TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE,
} from "@/db/schema/ministry-teams";
import { isUniqueViolation } from "@/db/errors";

import {
  PERSON_ALREADY_ASSIGNED_MESSAGE,
  ROLE_ALREADY_FILLED_MESSAGE,
} from "./membership-copy";

// ============================================================================
// #409 D1 — the translation from a driver unique-violation to the seat copy.
//
// WHY IT IS NOT IN `membership-copy.ts`. That module is an IMPORT-FREE leaf
// because a `"use client"` dialog imports the two SENTENCES from it; this
// function is server-only and needs `isUniqueViolation`, so it lives one module
// out. Both of its imports are themselves import-free leaves — `@/db/errors`
// opens with no import at all and the schema module ships no client — so the
// leaf's guard (`ruled-guards.test.ts` §4b) is untouched and no database client
// reaches a browser chunk through this file.
//
// WHY IT DOES NOT MATCH STRINGS ITSELF. It used to: a hand-rolled substring
// test for the index name over the error's own text plus one level of `cause`,
// with no SQLSTATE check at all. That was a SECOND implementation of "the
// unique index is the concurrency guard and it just did its job" — the same
// decision `src/db/errors.ts` owns for every other domain, and the same
// decision THIS TRACK consolidated (#411 AC5). A duplicate of that predicate is
// the shape that goes stale in one place and not the other: a driver that stops
// populating `constraint`, a wrapping one level deeper, a `LIKE` in some
// unrelated error text that happens to name the index. `isUniqueViolation`
// requires the unique-violation SQLSTATE *and* the constraint, and walks five
// levels of cause. Never re-inline it — `ruled-guards.test.ts` §4c fails if the
// substring form comes back, or if a second module spells the SQLSTATE.
// ============================================================================

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
 * THE ERROR SHAPE, MEASURED RATHER THAN ASSUMED (2026-08-13, Postgres 16 with
 * migration 0038, over neon-http). BOTH shapes reach here and `isUniqueViolation`
 * matches both: a `db.batch([...])` — which is what the reactivation is — throws
 * the driver's `NeonDbError` DIRECTLY (the match is at depth 0), while a
 * single-statement write is wrapped in Drizzle's `Failed query: <sql>` with that
 * error on `cause` and names no constraint itself (the match is at depth 1).
 * `membership-conflict.test.ts` pins both shapes, hermetically.
 */
export function membershipConflictMessage(error: unknown): string | null {
  if (isUniqueViolation(error, TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE)) {
    return ROLE_ALREADY_FILLED_MESSAGE;
  }
  if (isUniqueViolation(error, TEAM_MEMBERSHIPS_ACTIVE_UNIQUE)) {
    return PERSON_ALREADY_ASSIGNED_MESSAGE;
  }
  return null;
}
