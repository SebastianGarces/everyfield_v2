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

test("recurring completion binds the exact checklist source lineage", () => {
  const successorId = "00000000-0000-4000-8000-000000000006";
  const childId = "00000000-0000-4000-8000-000000000007";
  const cloneId = "00000000-0000-4000-8000-000000000008";
  const base = taskEffectPlanFixture("completeTaskAction");
  const before = {
    ...base.taskWrites[0]!.before!,
    isRecurring: true,
    recurrenceRule: {
      interval: "weekly" as const,
      endDate: null,
      seriesId: null,
    },
  };
  const completed = {
    ...base.taskWrites[0]!,
    before,
    after: {
      ...base.taskWrites[0]!.after,
      ...before,
      status: "complete" as const,
    },
  };
  const sourceChild = {
    ...taskFixtureSnapshot(childId),
    title: "Repeat this exact checklist item",
    parentTaskId: TASK_FIXTURE_ID,
  };
  const successor = {
    taskId: successorId,
    before: null,
    after: {
      ...before,
      id: successorId,
      status: "not_started" as const,
      dueDate: "2026-09-08",
      parentTaskId: null,
      recurrenceRule: {
        interval: "weekly" as const,
        endDate: null,
        seriesId: TASK_FIXTURE_ID,
      },
      completedAt: null,
      completedById: null,
    },
  };
  const clone = {
    taskId: cloneId,
    before: null,
    after: {
      ...taskFixtureSnapshot(cloneId),
      title: sourceChild.title,
      parentTaskId: successorId,
    },
  };
  const arguments_ = {
    ...base,
    subjectTasks: [before],
    sourceTasks: [sourceChild],
    childSets: [{ parentTaskId: TASK_FIXTURE_ID, taskIds: [childId] }],
    taskWrites: [completed, successor, clone],
    notifications: {
      ...base.notifications,
      scopedTaskIds: [TASK_FIXTURE_ID, successorId, cloneId],
    },
    disclosure: {
      ...base.disclosure,
      targets: [completed, successor, clone].map(
        ({ taskId, after }) => `Task ${taskId}: ${after.title}`
      ),
    },
  };
  const schema = TASKS_EFFECT_ARGUMENT_SCHEMAS.completeTaskAction;
  assert.equal(schema.safeParse(arguments_).success, true);
  assert.equal(
    schema.safeParse({ ...arguments_, sourceTasks: [] }).success,
    false
  );
  assert.equal(
    schema.safeParse({ ...arguments_, childSets: [] }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...arguments_,
      taskWrites: [
        completed,
        successor,
        { ...clone, after: { ...clone.after, title: "Stale clone" } },
      ],
    }).success,
    false
  );
});
