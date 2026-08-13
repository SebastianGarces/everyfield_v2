import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TEAM_MEMBERSHIPS_ACTIVE_UNIQUE,
  TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE,
} from "@/db/schema/ministry-teams";
import { membershipConflictMessage } from "@/lib/ministry-teams/membership-conflict";
import {
  PERSON_ALREADY_ASSIGNED_MESSAGE,
  ROLE_ALREADY_FILLED_MESSAGE,
} from "@/lib/ministry-teams/membership-copy";

// ----------------------------------------------------------------------------
// #409 D1 — the translation from a driver unique-violation to user copy.
//
// WHY THIS FILE EXISTS. `assignMember`'s reactivation path is an UPDATE, and an
// UPDATE takes no `ON CONFLICT`, so it meets
// `team_memberships_role_active_unique_idx` as a THROWN error.
// `membershipConflictMessage` is the only thing between that throw and a raw
// "duplicate key value violates unique constraint …" reaching a planter — the
// exact 500 migration 0038's ON CONFLICT clauses exist to prevent — and it
// decides by inspecting an error whose SHAPE it assumes. An assumption written
// in a comment is not a guard: if the constraint name arrives somewhere the
// predicate does not look, it returns null, the raw error rethrows, and nobody
// finds out until a planter reads Postgres at them.
//
// It is a pure function over an error object, so this suite needs no database
// and runs on every `pnpm test`. That is the point: the only other test that
// reaches this path ("REACTIVATING a past holder is refused too") is in the
// opt-in live suite `role-seat-race.test.ts`.
//
// THE RECOGNITION ITSELF IS NOT THIS MODULE'S — it is `isUniqueViolation`
// (`src/db/errors.ts`), the one copy every domain shares (#411 AC5). What this
// file pins is that BOTH REAL SHAPES still reach the right sentence through it.
//
// BOTH FIXTURES ARE REAL BYTES, and there are two of them because the driver
// throws TWO shapes. Captured 2026-08-13 against Postgres 16 with migration
// 0038 applied, reached through neon-http (`localNeonHttpEndpoint` + the local
// Neon proxy, the same seam the live suites run on):
//
//   * a `db.batch([...])` — which is what the reactivation actually is — throws
//     the driver's `NeonDbError` DIRECTLY, so the 23505 and the constraint are
//     on the top-level error and `cause` is undefined: matched at DEPTH 0 (§1);
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
// THE INDEX NAMES ARE IMPORTED FROM THE SCHEMA THAT DECLARES THEM, never
// re-typed here: a fixture naming an index nothing creates would pass while the
// production call matched nothing.
// ----------------------------------------------------------------------------

const ROLE_INDEX = TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE;
const PERSON_INDEX = TEAM_MEMBERSHIPS_ACTIVE_UNIQUE;

/** The `NeonDbError` the driver raises, with the fields it really carries. */
function neonUniqueViolation(constraint: string): Error {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { name: "NeonDbError", severity: "ERROR", code: "23505", constraint }
  );
}

test("§1 the batch shape — the constraint name in `message`, no cause (the reactivation path)", () => {
  assert.equal(
    membershipConflictMessage(neonUniqueViolation(ROLE_INDEX)),
    ROLE_ALREADY_FILLED_MESSAGE
  );
});

test("§2 the wrapped shape — Drizzle's `Failed query:` with the driver error on `cause`", () => {
  const wrapped = Object.assign(
    new Error(
      'Failed query: update "team_memberships" set "status" = $1, "updated_at" = $2 ' +
        'where ("team_memberships"."church_id" = $3 and "team_memberships"."id" = $4) ' +
        'returning "id", "church_id", "team_id", "person_id", "role_id"\nparams: active,…'
    ),
    { cause: neonUniqueViolation(ROLE_INDEX) }
  );

  assert.doesNotMatch(
    wrapped.message,
    new RegExp(ROLE_INDEX),
    "the premise of this case: the wrapper names no constraint, so reading only `message` finds nothing"
  );
  assert.equal(membershipConflictMessage(wrapped), ROLE_ALREADY_FILLED_MESSAGE);
});

test("§3 the person-level index maps to the other sentence, not the seat one", () => {
  const wrapped = Object.assign(
    new Error('Failed query: insert into "team_memberships" …\nparams: …'),
    { cause: neonUniqueViolation(PERSON_INDEX) }
  );

  assert.equal(
    membershipConflictMessage(wrapped),
    PERSON_ALREADY_ASSIGNED_MESSAGE,
    "#409 D1: the two refusals are different sentences and the planter's next move differs — never collapse them"
  );
  assert.equal(
    membershipConflictMessage(neonUniqueViolation(PERSON_INDEX)),
    PERSON_ALREADY_ASSIGNED_MESSAGE
  );
});

test("§4 anything else stays null, so assignMember rethrows real faults", () => {
  assert.equal(membershipConflictMessage(new Error("connection reset")), null);
  assert.equal(
    membershipConflictMessage(
      neonUniqueViolation("teams_church_predefined_unique_idx")
    ),
    null,
    "a violation on somebody else's index is not a seat refusal — swallowing it would report the wrong cause"
  );
  assert.equal(membershipConflictMessage("not an error at all"), null);
  assert.equal(membershipConflictMessage(undefined), null);
});
