import assert from "node:assert/strict";
import { test } from "node:test";
import {
  taskRelationQuery,
  assertTaskRelation,
  TASK_RELATION_ERROR,
} from "./relations";

const churchId = "11111111-1111-4111-8111-111111111111";
const entityId = "22222222-2222-4222-8222-222222222222";

for (const type of ["person", "meeting", "team"] as const) {
  test(`${type} choices and validation queries always constrain the church`, () => {
    const choices = taskRelationQuery(churchId, type).toSQL();
    const validation = taskRelationQuery(churchId, type, entityId).toSQL();
    assert.deepEqual(choices.params, [churchId]);
    assert.deepEqual(validation.params, [churchId, entityId]);
    assert.match(choices.sql, /"church_id" = \$1/);
    assert.match(validation.sql, /"id" = \$2/);
    if (type === "person") assert.match(choices.sql, /"deleted_at" is null/);
  });
}

test("empty relation is allowed, half-pairs and retired types fail before querying", async () => {
  await assertTaskRelation(churchId, null, null);
  for (const [type, id] of [
    ["person", null],
    [null, entityId],
    ["facility", entityId],
    ["meeting", "garbage"],
  ]) {
    await assert.rejects(assertTaskRelation(churchId, type, id), {
      message: TASK_RELATION_ERROR,
    });
  }
});
