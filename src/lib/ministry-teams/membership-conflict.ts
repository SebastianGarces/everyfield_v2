import {
  TEAM_MEMBERSHIPS_ACTIVE_UNIQUE,
  TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE,
} from "@/db/schema/ministry-teams";
import { isUniqueViolation } from "@/db/errors";

// ============================================================================
// #409 D1 — RECOGNISING that the seat's guards refused a write.
//
// IT RECOGNISES, IT DOES NOT TRANSLATE (corrected #411 round 2). This module
// used to return the user copy, which made it a second decider of "which
// sentence" beside `assignMember`'s `seatRefusalMessage` — and an index→sentence
// table is exactly the thing that drifts, because it has to predict WHICH index
// a race will raise on. It now answers one boolean; the caller reads the seat
// and names the holder, for both refusal paths.
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
 * True when `error` is a unique violation raised by ONE OF THE TWO INDEXES that
 * stand over an active team membership. Anything else is false, so its caller
 * rethrows real faults untouched.
 *
 * WHY BOTH INDEXES, AND WHY THE SUBSUMPTION ARGUMENT IS WRONG (#411 round 2,
 * measured on a freshly migrated Postgres 16 — `role-seat-race.test.ts`'s
 * same-person case failed 2 runs in 3 without this).
 * `team_memberships_role_active_unique_idx` is keyed on `role_id` alone, so it
 * is true that it SUBSUMES `team_memberships_active_unique`
 * (team_id, person_id, role_id): one active row per role implies one per any
 * triple containing that role. It does NOT follow that the older index can
 * never raise first, because ON CONFLICT does not consult every index — it
 * arbitrates on the one named as its target.
 *
 * `ON CONFLICT (role_id) WHERE status = 'active' DO NOTHING` asks the SEAT index
 * alone. Under a real race the arbiter's pre-check does not yet see the winner's
 * uncommitted tuple, so the INSERT proceeds and Postgres inserts the tuple into
 * every unique index in turn. `team_memberships_active_unique` has the lower OID
 * and is reached first; it is NOT the arbiter, so DO NOTHING does not cover it,
 * and it blocks on the winner's tuple and then raises. That is a live guard on
 * the INSERT path precisely BECAUSE it is not the ON CONFLICT arbiter.
 *
 * The subsumption argument holds only for the SEQUENTIAL second submit, which
 * `assignMember`'s `existing.status === 'active'` check intercepts before any
 * write. So it was never the case that describes production.
 *
 * Do not "fix" the raise by dropping the older index (0038 is already applied),
 * by widening the ON CONFLICT target, or by adding a pre-flight SELECT — the
 * last two are the SELECT-then-INSERT shape `memory/invariants.md` →
 * Transactions refuses by name. Recognising both indexes costs one predicate
 * call and is the whole remedy.
 *
 * WHY A RECOGNITION AND NOT A PRE-CHECK. The reactivation path in `assignMember`
 * is an UPDATE, and an UPDATE takes no `ON CONFLICT`. A
 * `WHERE NOT EXISTS (… active row …)` predicate would look like a guard and be
 * none — it is a snapshot read about rows other statements are writing, the trap
 * `memory/invariants.md` → Transactions describes — so the indexes stay the only
 * guards on both paths and this function is purely about what the planter reads.
 * The write itself is already correct without it: the violation aborts the whole
 * `db.batch`, so a refused reactivation leaves the role's status alone too.
 *
 * THE ERROR SHAPE, MEASURED RATHER THAN ASSUMED (2026-08-13, Postgres 16 with
 * migration 0038, over neon-http). BOTH shapes reach here and `isUniqueViolation`
 * matches both: a `db.batch([...])` — which is what both write paths are — throws
 * the driver's `NeonDbError` DIRECTLY (the match is at depth 0), while a
 * single-statement write is wrapped in Drizzle's `Failed query: <sql>` with that
 * error on `cause` and names no constraint itself (the match is at depth 1).
 * `membership-conflict.test.ts` pins both shapes for both indexes, hermetically.
 */
export function isSeatConflict(error: unknown): boolean {
  return (
    isUniqueViolation(error, TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE) ||
    isUniqueViolation(error, TEAM_MEMBERSHIPS_ACTIVE_UNIQUE)
  );
}
