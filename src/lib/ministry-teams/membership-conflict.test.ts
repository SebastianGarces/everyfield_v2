import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE } from "@/db/schema/ministry-teams";
import { isSeatConflict } from "@/lib/ministry-teams/membership-conflict";
import {
  PERSON_ALREADY_ASSIGNED_MESSAGE,
  ROLE_ALREADY_FILLED_MESSAGE,
} from "@/lib/ministry-teams/membership-copy";

// ----------------------------------------------------------------------------
// #409 D1 — RECOGNISING that the seat's guards refused a write.
//
// WHY THIS FILE EXISTS. One of `assignMember`'s write outcomes arrives as a
// THROWN driver error: the reactivation path is an UPDATE and takes no
// `ON CONFLICT` at all, so it meets the seat index as a violation.
// `isSeatConflict` is the only thing between that throw and a raw "duplicate key
// value violates unique constraint …" reaching a planter — the exact 500
// migration 0038's ON CONFLICT clauses exist to prevent — and it decides by
// inspecting an error whose SHAPE it assumes. An assumption written in a comment
// is not a guard: if the constraint name arrives somewhere the predicate does
// not look, it returns false, the raw error rethrows, and nobody finds out until
// a planter reads Postgres at them.
//
// It is a pure function over an error object, so this suite needs no database
// and runs on every `pnpm test`. That is the point: the only other tests that
// reach this path are in the opt-in live suite `role-seat-race.test.ts`.
//
// THE RECOGNITION ITSELF IS NOT THIS MODULE'S — it is `isUniqueViolation`
// (`src/db/errors.ts`), the one copy every domain shares (#411 AC5). What this
// file pins is that BOTH REAL SHAPES of that error are recognised through it,
// for the ONE index that stands over an active membership.
//
// BOTH FIXTURES ARE REAL BYTES, and there are two of them because the driver
// throws TWO shapes. Captured 2026-08-13 against Postgres 16 with migration
// 0038 applied, reached through neon-http (the local Neon proxy the live suites
// run on, via the `scripts/live-db-endpoint.ts` preload):
//
//   * a `db.batch([...])` — which is what both write paths are — throws the
//     driver's `NeonDbError` DIRECTLY, so the 23505 and the constraint are on
//     the top-level error and `cause` is undefined: matched at DEPTH 0 (§1);
//   * a single-statement write is wrapped by Drizzle in
//     `Failed query: <sql>\nparams: <…>` with that `NeonDbError` hung on
//     `cause`, and the wrapper carries neither the code nor the constraint:
//     matched at DEPTH 1, by walking the cause chain (§2).
//
// So a predicate that read only the cause would miss the reactivation, and one
// that read only the top-level error would miss every single-statement path.
// Do not "simplify" `isUniqueViolation` to one of them — that is precisely the
// regression this file exists to see.
//
// THE INDEX NAME IS IMPORTED FROM THE SCHEMA THAT DECLARES IT, never re-typed
// here: a fixture naming an index nothing creates would pass while the
// production call matched nothing.
// ----------------------------------------------------------------------------

const ROLE_INDEX = TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE;

/** The `NeonDbError` the driver raises, with the fields it really carries. */
function neonUniqueViolation(constraint: string): Error {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { name: "NeonDbError", severity: "ERROR", code: "23505", constraint }
  );
}

/** Drizzle's wrapper: the driver error on `cause`, no constraint of its own. */
function drizzleWrapped(constraint: string): Error {
  return Object.assign(
    new Error(
      'Failed query: insert into "team_memberships" ("church_id", "team_id", ' +
        '"person_id", "role_id", "status") values ($1, $2, $3, $4, $5) ' +
        'on conflict ("role_id") where "team_memberships"."status" = \'active\' ' +
        'do nothing returning "id"\nparams: …'
    ),
    { cause: neonUniqueViolation(constraint) }
  );
}

test("§1 the batch shape — the constraint name in `message`, no cause (the reactivation path)", () => {
  assert.equal(isSeatConflict(neonUniqueViolation(ROLE_INDEX)), true);
});

test("§2 the wrapped shape — Drizzle's `Failed query:` with the driver error on `cause`", () => {
  const wrapped = drizzleWrapped(ROLE_INDEX);

  assert.doesNotMatch(
    wrapped.message,
    new RegExp(`"${ROLE_INDEX}"`),
    "the premise of this case: the wrapper names no constraint, so reading only `message` finds nothing"
  );
  assert.equal(isSeatConflict(wrapped), true);
});

test("§3 recognising the seat refusal does NOT decide the wording — one read does", () => {
  // Both sentences exist and differ — the planter's next move differs — and
  // which one is read comes from ONE place: `assignMember` reads who holds the
  // seat, for the empty-`returning()` refusal and the thrown one alike. An
  // index→sentence table was the earlier design and it had to predict which
  // index a race raises on; since migration 0039 there is only one unique index
  // over an active membership, and the sentence is still not read off it.
  assert.notEqual(PERSON_ALREADY_ASSIGNED_MESSAGE, ROLE_ALREADY_FILLED_MESSAGE);
  const memberships = readFileSync(
    path.join(process.cwd(), "src/lib/ministry-teams/memberships.ts"),
    "utf8"
  );
  assert.match(
    memberships,
    /holder\?\.personId === personId[\s\S]{0,80}PERSON_ALREADY_ASSIGNED_MESSAGE/,
    "#411 round 1: the same-person refusal is decided by reading the seat's active holder, not by a branch over an index name"
  );
  assert.equal(
    memberships.match(/await seatRefusalMessage\(churchId, roleId, personId\)/g)
      ?.length,
    2,
    "#411 round 2: BOTH refusal paths — the empty returning() and the recognised conflict — end in the one holder read"
  );
});

test("§4 anything else stays false, so assignMember rethrows real faults", () => {
  assert.equal(isSeatConflict(new Error("connection reset")), false);
  assert.equal(
    isSeatConflict(neonUniqueViolation("teams_church_predefined_unique_idx")),
    false,
    "a violation on somebody else's index is not a seat refusal — swallowing it would report the wrong cause"
  );
  assert.equal(isSeatConflict("not an error at all"), false);
  assert.equal(isSeatConflict(undefined), false);
});
