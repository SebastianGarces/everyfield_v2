import assert from "node:assert/strict";
import test from "node:test";

import { TASK_ACTION_CONTRACTS } from "./contracts";
import {
  TASKS_EFFECT_ARGUMENT_SCHEMAS,
  type TaskEffectExport,
} from "./effect-contracts";
import {
  TASK_FIXTURE_ID,
  taskEffectPlanFixture,
  taskFixtureSnapshot,
} from "./test-fixtures";

test("every Task effect has one strict complete operation contract", () => {
  const exports = Object.entries(TASK_ACTION_CONTRACTS)
    .filter(([, contract]) => contract.operationKind === "effect")
    .map(([exportName]) => exportName as TaskEffectExport);
  assert.deepEqual(
    Object.keys(TASKS_EFFECT_ARGUMENT_SCHEMAS).toSorted(),
    exports.toSorted()
  );
  for (const exportName of exports) {
    const parsed = TASKS_EFFECT_ARGUMENT_SCHEMAS[exportName].safeParse(
      taskEffectPlanFixture(exportName)
    );
    assert.equal(parsed.success, true, `${exportName}: ${parsed.error}`);
  }
});

test("operation contracts refuse cross-operation and incomplete mutation shapes", () => {
  const deletion = taskEffectPlanFixture("deleteTaskAction");
  assert.equal(
    TASKS_EFFECT_ARGUMENT_SCHEMAS.createTaskAction.safeParse(deletion).success,
    false
  );
  assert.equal(
    TASKS_EFFECT_ARGUMENT_SCHEMAS.deleteTaskAction.safeParse({
      ...deletion,
      taskWrites: [
        {
          taskId: TASK_FIXTURE_ID,
          before: null,
          after: taskFixtureSnapshot(TASK_FIXTURE_ID),
        },
      ],
    }).success,
    false
  );
  const handoff = taskEffectPlanFixture("handOffFollowUpsAction");
  assert.equal(
    TASKS_EFFECT_ARGUMENT_SCHEMAS.handOffFollowUpsAction.safeParse({
      ...handoff,
      sourceAssertion: { kind: "none" },
    }).success,
    false
  );
});

test("completion contracts cannot omit or detach material and contact-log effects", () => {
  const completion = taskEffectPlanFixture("completeTaskAction");
  assert.equal(
    TASKS_EFFECT_ARGUMENT_SCHEMAS.completeTaskAction.safeParse({
      ...completion,
      completionEffects: { materialStamp: null, contactLogs: [] },
    }).success,
    false
  );
  assert.equal(
    TASKS_EFFECT_ARGUMENT_SCHEMAS.completeTaskAction.safeParse({
      ...completion,
      completionEffects: {
        ...completion.completionEffects,
        contactLogs: [
          {
            kind: "not_applicable",
            taskId: TASK_FIXTURE_ID,
            reason: "person_unavailable",
            personId: TASK_FIXTURE_ID,
          },
        ],
      },
    }).success,
    false
  );
});

test("create and update contracts bind every structural Task source fact", () => {
  const parentId = "00000000-0000-4000-8000-000000000004";
  const prerequisiteId = "00000000-0000-4000-8000-000000000005";
  const create = taskEffectPlanFixture("createTaskAction");
  const createdWrite = create.taskWrites[0]!;

  assert.equal(
    TASKS_EFFECT_ARGUMENT_SCHEMAS.createTaskAction.safeParse({
      ...create,
      taskWrites: [
        {
          ...createdWrite,
          after: { ...createdWrite.after, parentTaskId: parentId },
        },
      ],
    }).success,
    false,
    "an existing parent must be present as an exact Task source snapshot"
  );

  assert.equal(
    TASKS_EFFECT_ARGUMENT_SCHEMAS.createTaskAction.safeParse({
      ...create,
      dependencySets: [
        {
          taskId: TASK_FIXTURE_ID,
          beforePrerequisiteIds: [],
          afterPrerequisiteIds: [prerequisiteId],
        },
      ],
    }).success,
    false,
    "every prerequisite must be present as an exact Task source snapshot"
  );

  const update = taskEffectPlanFixture("updateTaskAction");
  const updatedWrite = update.taskWrites[0]!;
  assert.equal(
    TASKS_EFFECT_ARGUMENT_SCHEMAS.updateTaskAction.safeParse({
      ...update,
      sourceTasks: [taskFixtureSnapshot(parentId)],
      taskWrites: [
        {
          ...updatedWrite,
          after: { ...updatedWrite.after, parentTaskId: parentId },
        },
      ],
    }).success,
    false,
    "nesting an existing Task must bind its exact current child set"
  );
});
