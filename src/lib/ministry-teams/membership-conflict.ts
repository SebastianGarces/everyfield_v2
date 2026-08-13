import { TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE } from "@/db/schema/ministry-teams";
import { isUniqueViolation } from "@/db/errors";

// ============================================================================
// #409 D1 — RECOGNISING that the seat's guard refused a write BY THROWING.
// That is ONE of the shapes a refusal takes, not all of them: the INSERT path's
// `ON CONFLICT … DO NOTHING`, and the reactivation UPDATE's own
// `status = 'inactive'` predicate, both refuse with an empty `returning()` and
// never reach this function.
//
// IT RECOGNISES, IT DOES NOT TRANSLATE (corrected #411 round 2). This module
// used to return the user copy, which made it a second decider of "which
// sentence" beside `assignMember`'s `seatRefusalMessage` — and an index→sentence
// table is exactly the thing that drifts. It now answers one boolean; the caller
// reads the seat and names the holder, for both refusal paths.
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
 * True when `error` is a unique violation raised by THE index that stands over
 * an active team membership. Anything else is false, so its caller rethrows real
 * faults untouched.
 *
 * ONE INDEX, ONE NAME (#411 quality round 1). There were two for one round:
 * `team_memberships_active_unique` (team_id, person_id, role_id) sat beside the
 * seat index, strictly subsumed by it — `role_id` is NOT NULL and one active row
 * per role implies one per any triple containing that role — and this predicate
 * OR-ed the two names. It had to, because the subsumed index still RAISED: `ON
 * CONFLICT (role_id) WHERE status = 'active' DO NOTHING` arbitrates on the seat
 * index alone, so under a real race the insert proceeded past the arbiter's
 * pre-check, met the non-arbiter triple first (lower OID), blocked and raised a
 * unique violation where the DO NOTHING could not cover it. That raise was an
 * artefact of keeping a redundant index, not a guarantee it bought. Migration
 * 0039 drops it, the arbiter now covers every INSERT conflict, and this
 * predicate names one constant. Do not re-add the index to "catch more" — it caught nothing the seat
 * index does not, and it converted a designed `INSERT 0 0` into an exception.
 *
 * WHY A RECOGNITION AND NOT A PRE-CHECK, and why one is still needed at all. The
 * reactivation path in `assignMember` is an UPDATE, and an UPDATE takes no
 * `ON CONFLICT` — so WHEN ANOTHER PERSON HOLDS THE SEAT it meets the seat index
 * as a throw. (Not always: since #411 quality round 1 that UPDATE also carries
 * `status = 'inactive'` in its own `WHERE`, so a SAME-PERSON double submit onto
 * a previously-held seat is refused by an empty `returning()` instead, exactly
 * as the INSERT path is. Both refusals end in `seatRefusalMessage`, so which
 * shape arrives changes nothing a planter reads.) A
 * `WHERE NOT EXISTS (… active row …)` predicate would look like a guard and be
 * none: it is a snapshot read about rows other statements are writing, the trap
 * `memory/invariants.md` → Transactions describes. So the index and that
 * compare-and-set are the only guards, and this function is purely about what
 * the planter reads. The write itself is already correct without it: the
 * violation aborts the whole `db.batch`, so a refused reactivation leaves the
 * role's status alone too.
 *
 * THE ERROR SHAPE, MEASURED RATHER THAN ASSUMED (2026-08-13, Postgres 16 over
 * neon-http). BOTH shapes reach here and `isUniqueViolation` matches both: a
 * `db.batch([...])` — which is what both write paths are — throws the driver's
 * `NeonDbError` DIRECTLY (the match is at depth 0), while a single-statement
 * write is wrapped in Drizzle's `Failed query: <sql>` with that error on `cause`
 * and names no constraint itself (the match is at depth 1).
 * `membership-conflict.test.ts` pins both shapes, hermetically.
 */
export function isSeatConflict(error: unknown): boolean {
  return isUniqueViolation(error, TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE);
}
