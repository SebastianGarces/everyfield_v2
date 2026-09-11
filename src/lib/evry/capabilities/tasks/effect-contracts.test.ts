import assert from "node:assert/strict";
import test from "node:test";

import { TASK_ACTION_CONTRACTS } from "./contracts";
import {
  TASKS_EFFECT_ARGUMENT_SCHEMAS,
  type TaskEffectExport,
} from "./effect-contracts";
import {
  TASK_FIXTURE_ACTOR_ID,
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
  const originalCreatorId = "00000000-0000-4000-8000-000000000009";
  const successorId = "00000000-0000-4000-8000-000000000006";
  const childId = "00000000-0000-4000-8000-000000000007";
  const cloneId = "00000000-0000-4000-8000-000000000008";
  const base = taskEffectPlanFixture("completeTaskAction");
  const before = {
    ...base.taskWrites[0]!.before!,
    createdById: originalCreatorId,
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
      createdById: originalCreatorId,
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
  assert.equal(
    schema.safeParse({
      ...arguments_,
      taskWrites: [
        completed,
        {
          ...successor,
          after: {
            ...successor.after,
            createdById: TASK_FIXTURE_ACTOR_ID,
          },
        },
        clone,
      ],
    }).success,
    false,
    "the completing actor cannot replace the recurring Task's creator"
  );
  assert.equal(
    schema.safeParse({
      ...arguments_,
      taskWrites: [
        completed,
        successor,
        {
          ...clone,
          after: { ...clone.after, createdById: TASK_FIXTURE_ACTOR_ID },
        },
      ],
    }).success,
    false,
    "fresh checklist rows must inherit the recurring Task's creator"
  );
});

test("bulk contracts preserve one exact actionable and excluded partition", () => {
  const completeId = "00000000-0000-4000-8000-000000000010";
  const otherId = "00000000-0000-4000-8000-000000000011";
  const missingId = "00000000-0000-4000-8000-000000000012";
  const base = taskEffectPlanFixture("bulkCompleteTasksAction");
  const complete = taskFixtureSnapshot(completeId, "complete");
  const other = {
    ...taskFixtureSnapshot(otherId),
    assignedToId: "00000000-0000-4000-8000-000000000013",
  };
  const sourceAssertion = {
    kind: "bulk_selection" as const,
    requestedTaskIds: [TASK_FIXTURE_ID, completeId, missingId, otherId],
    actionableTaskIds: [TASK_FIXTURE_ID],
    excludedTasks: [
      {
        taskId: completeId,
        reason: "Task is already complete" as const,
        expectedTask: complete,
      },
      {
        taskId: missingId,
        reason: "Task not found" as const,
        expectedTask: null,
      },
      {
        taskId: otherId,
        reason: "That task is assigned to somebody else" as const,
        expectedTask: other,
      },
    ],
  };
  const exclusions = sourceAssertion.excludedTasks.map((excluded) => ({
    target: excluded.expectedTask
      ? `Task ${excluded.taskId}: ${excluded.expectedTask.title}`
      : `Task ${excluded.taskId}`,
    reason: excluded.reason,
  }));
  const arguments_ = {
    ...base,
    sourceAssertion,
    exclusions: [...exclusions, ...base.exclusions],
  };
  const schema = TASKS_EFFECT_ARGUMENT_SCHEMAS.bulkCompleteTasksAction;
  assert.equal(schema.safeParse(arguments_).success, true);
  assert.equal(
    schema.safeParse({
      ...arguments_,
      exclusions: arguments_.exclusions.slice(1),
    }).success,
    false,
    "a named partial failure cannot disappear from confirmation"
  );
  assert.equal(
    schema.safeParse({
      ...arguments_,
      sourceAssertion: {
        ...sourceAssertion,
        actionableTaskIds: [TASK_FIXTURE_ID, missingId],
      },
    }).success,
    false,
    "a missing Task cannot be relabeled actionable"
  );
});

test("status-to-complete admits the canonical recurring completion shape", () => {
  const completion = taskEffectPlanFixture("completeTaskAction");
  assert.equal(
    TASKS_EFFECT_ARGUMENT_SCHEMAS.updateTaskStatusAction.safeParse({
      ...completion,
      operation: "updateTaskStatusAction",
    }).success,
    true
  );
});
