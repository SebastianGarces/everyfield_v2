import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { assertBatchedWrites } from "@/lib/testing/db-atomicity";
import {
  assertInOrder,
  sourceReader,
  stripComments,
} from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// THE SHAPE OF THE REMOVAL CASCADE — #497, AS-016.
//
// WHAT BELONGS HERE AND WHAT BELONGS NEXT DOOR. `seat-removal-live.test.ts`
// runs the cascade against a real Postgres and asserts the five effects it
// leaves behind; it cannot see HOW they were written, and two properties of
// this module are properties of the source rather than of the result:
//
//   1. ATOMICITY. `db.transaction()` throws at runtime on neon-http, so all
//      four statements go in ONE `db.batch([...])` (`memory/invariants.md` →
//      Transactions / Atomicity). A cascade that ran them as four awaited
//      writes would pass every live assertion on a healthy database and leave a
//      half-removed account behind on the one request that failed in the
//      middle — the exact failure the invariant exists to prevent.
//   2. MARKER-LAST ORDERING. The live suite proves the end state, which is the
//      same whichever order the statements are in. What ordering buys is REDO
//      SAFETY: the tenancy clear is the marker, every earlier step is a no-op
//      on replay, and moving the marker up would silently trade that away.
//
// ANCHORS ARE DECLARATIONS, read through `sourceReader`, so a renamed or
// deleted function throws here instead of quietly asserting over some other
// function's body (a bare `indexOf` returning -1 makes the whole file the
// span). Comments are stripped first: prose naming `db.batch` is not a call,
// and a source-shaped test that feeds on its own documentation is green
// without being true.
// ----------------------------------------------------------------------------

const SOURCE = stripComments(
  readFileSync(path.join(process.cwd(), "src/lib/seats/roster.ts"), "utf8")
);

const reader = sourceReader(SOURCE, "src/lib/seats/roster.ts");

const removeSeatBody = reader.span(
  "export async function removeSeat",
  "export async function endCoachAssignment"
);

test("the removal cascade is one Neon batch, and nothing writes beside it", () => {
  assertBatchedWrites(removeSeatBody, "removeSeat");
});

test("the tenancy clear is the LAST statement in the batch", () => {
  // The four statements, in the order redo safety requires. `assertInOrder`
  // reads each needle after the previous one, so this fails if any pair swaps.
  assertInOrder(
    removeSeatBody,
    "removeSeat",
    [
      "db.delete(sessions)",
      "db\n      .update(tasks)",
      "db\n      .update(ministryTeams)",
      "db\n      .update(users)",
    ],
    "sessions, tasks and leadership are all redo-safe; the tenancy clear is the marker and must come last, so a replayed request re-runs three no-ops instead of a half-cascade"
  );
});

test("every statement in the cascade carries the actor's plant", () => {
  // THE TENANCY LEAK GUARD, ASSERTED AS A COUNT rather than statement by
  // statement, so a fifth effect added to the batch without one fails here.
  // Four statements, four `actor.churchId` in their predicates: the sessions
  // delete reaches it through an `exists` (its own subject is keyed by the
  // account, not the plant), and the other three name a plant-scoped column
  // directly.
  const scoped = removeSeatBody.match(/actor\.churchId/g) ?? [];
  assert.ok(
    scoped.length >= 4,
    `every statement in the removal batch must scope to the actor's own plant; found ${scoped.length} references`
  );

  const sessionDelete = sourceReader(
    removeSeatBody,
    "removeSeat's session delete"
  ).span("db.delete(sessions)", "db\n      .update(tasks)");

  assert.match(
    sessionDelete,
    /exists \(/,
    "the sessions delete is keyed by the ACCOUNT, so its tenancy scope has to come from an exists — without it a target that moved plant is still signed out by this actor"
  );
  assert.match(
    sessionDelete,
    /users\.churchId\} = \$\{actor\.churchId\}/,
    "and that exists must name the actor's own plant"
  );
});

test("the marker clears EVERY tenancy FK, not only church_id", () => {
  // A REMOVAL MUST NEVER WIDEN REACH. A row naming two tenancies reaches
  // nothing (`oversightOrgOf` answers only for exactly one FK); clearing
  // `church_id` alone would leave it naming exactly one and hand the account
  // that org's oversight surface, which `requireOversightUser` admits on the FK
  // alone without asking the seat.
  const marker = sourceReader(removeSeatBody, "removeSeat's marker").after(
    "db\n      .update(users)"
  );

  for (const column of ["churchId", "sendingChurchId", "sendingNetworkId"]) {
    assert.match(
      marker,
      new RegExp(`${column}: null`),
      `the marker must clear ${column} — a removed account may name no tenancy at all`
    );
  }
  assert.match(marker, /seat: null/, "and must clear the seat");
});

test("the removal answers on the marker's rowcount", () => {
  // `db.batch` is all-or-nothing on FAILURE only: a zero-row UPDATE succeeds
  // and statements 1–3 commit. So the marker has to RETURN, and the body has to
  // read what it returned, or a stale removal reports success having changed
  // nothing.
  assert.match(
    removeSeatBody,
    /\.returning\(\{ id: users\.id \}\)/,
    "the marker must return its rows so the call can tell a real removal from a no-op"
  );
  assert.match(
    removeSeatBody,
    /marked\.length === 0/,
    "and the body must refuse on an empty one — reporting success for a removal that changed nothing is the failure this guards"
  );
});

test("the marker re-asserts the plant it was allowed to act on", () => {
  // A stale pre-read must commit nothing. The marker's own `WHERE` carries the
  // actor's plant AND the not-an-Owner rule, so it is a compare-and-set on the
  // same row rather than a blind write of whatever the earlier SELECT saw.
  const marker = sourceReader(removeSeatBody, "removeSeat's marker").after(
    "db\n      .update(users)"
  );

  assert.match(
    marker,
    /eq\(users\.churchId, actor\.churchId\)/,
    "the marker must re-assert the actor's own plant"
  );
  assert.match(
    marker,
    /ne\(users\.seat, "owner"\)/,
    "the marker must refuse an Owner row even if the pre-read said otherwise"
  );
});

test("nothing in the cascade writes to persons or team_memberships", () => {
  // EFFECT (3) IS AN ABSENCE, and this is the assertion that keeps it one. The
  // live suite checks the two rows are unchanged after a removal; this checks
  // there is no statement that could change them, so a future effect added to
  // the batch has to argue with a test rather than slip in.
  for (const table of ["persons", "teamMemberships"]) {
    assert.doesNotMatch(
      removeSeatBody,
      new RegExp(`\\.(insert|update|delete)\\(${table}\\)`),
      `AS-016: the person record and its team memberships survive the account — the cascade must not write ${table}`
    );
  }

  // The one `persons` READ is the subquery naming which team the account leads.
  assert.match(
    removeSeatBody,
    /select \$\{persons\.id\} from \$\{persons\}/,
    "the only reach into persons is the leadership subquery"
  );
});

test("only open tasks move, and they move to the actor", () => {
  const taskWrite = sourceReader(
    removeSeatBody,
    "removeSeat's task write"
  ).span("db\n      .update(tasks)", "db\n      .update(ministryTeams)");

  assert.match(
    taskWrite,
    /ne\(tasks\.status, "complete"\)/,
    "AS-016: a completed task keeps its assignee — it is a record of who did the work"
  );
  assert.match(
    taskWrite,
    /assignedToId: actor\.id/,
    "AS-016: open tasks go to the Owner, who is the actor on this verb"
  );
  assert.match(
    taskWrite,
    /eq\(tasks\.churchId, actor\.churchId\)/,
    "and the reassignment stays inside the actor's own plant"
  );
});
