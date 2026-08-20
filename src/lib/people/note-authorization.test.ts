import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { stripComments } from "@/lib/testing/source-span";

import { authoredNoteCondition } from "./activity";

// ----------------------------------------------------------------------------
// WHO MAY REWRITE A NOTE (#320, P-010e).
//
// `activityId` is a uuid the CLIENT chose. Editing used to be impossible, so
// there was one predicate, on the delete; adding the edit is exactly the moment
// a second copy appears, and a second copy is a second place to leave the
// church term out. It is declared once now, and these tests are what say the
// four terms are all there and that both endpoints read it.
//
// The live half of this ran against the preview: `authoredNoteCondition` with
// EVERGREEN's church id and a note belonging to a DAYSPRING person matched zero
// rows, while the same predicate with Dayspring's matched exactly one.
// ----------------------------------------------------------------------------

const dialect = new PgDialect();

const CHURCH = "11111111-1111-1111-1111-111111111111";
const ACTIVITY = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";

test("the predicate names the row, the church, the kind and the author", () => {
  const { sql, params } = dialect.sqlToQuery(
    authoredNoteCondition(CHURCH, ACTIVITY, USER)
  );

  for (const column of [
    '"person_activities"."id"',
    '"person_activities"."church_id"',
    '"person_activities"."activity_type"',
    '"person_activities"."performed_by"',
  ]) {
    assert.ok(sql.includes(column), `missing ${column} in:\n${sql}`);
  }

  assert.deepEqual(params, [ACTIVITY, CHURCH, "note_added", USER]);
});

test("dropping the church term is what this test exists to catch", () => {
  const { params } = dialect.sqlToQuery(
    authoredNoteCondition(CHURCH, ACTIVITY, USER)
  );

  // Stated as its own assertion because it is the term with no local symptom:
  // without it every other term still passes for a note in another plant that
  // happens to carry the same author id.
  assert.ok(
    params.includes(CHURCH),
    "the church id must be bound into the predicate — it IS the tenancy boundary"
  );
});

test("both note endpoints read that one predicate", () => {
  const source = stripComments(
    readFileSync(
      path.join(
        process.cwd(),
        "src/app/(dashboard)/people/activity-actions.ts"
      ),
      "utf8"
    )
  );

  const uses = source.match(
    /authoredNoteCondition\(churchId, activityId, user\.id\)/g
  );
  assert.equal(
    uses?.length,
    2,
    "editNoteAction and deleteNoteAction must both authorize through it"
  );

  assert.ok(
    !/eq\(personActivities\.performedBy/.test(source),
    "a hand-written copy of the predicate is the drift this consolidation removes"
  );
});

test("an edit does not move the note in the timeline", () => {
  const source = stripComments(
    readFileSync(
      path.join(
        process.cwd(),
        "src/app/(dashboard)/people/activity-actions.ts"
      ),
      "utf8"
    )
  );
  const edit = source.slice(
    source.indexOf("export async function editNoteAction"),
    source.indexOf("export async function deleteNoteAction")
  );

  assert.ok(
    !edit.includes("createdAt"),
    "the timeline is ordered by created_at — touching it turns a correction " +
      "into a new event and rewrites the person's history"
  );
  assert.ok(
    edit.includes("editedAt"),
    "an edited note must say that it was edited, and when"
  );
});
