import assert from "node:assert/strict";
import test from "node:test";

import { TASK_ACTION_CONTRACTS } from "./contracts";
import { selectTaskEvryEffect } from "./selection";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";

const COMMANDS = {
  addSubtaskAction: `add checklist item to task ${A}: Prepare handout`,
  assignFollowUpAction: `assign follow-up task ${A} to user ${B}`,
  bulkCompleteTasksAction: `complete tasks ${A}, ${B}`,
  bulkRescheduleTasksAction: `reschedule tasks ${A}, ${B} to 2026-09-14`,
  completeTaskAction: `complete task ${A}`,
  createAndAssignFollowUpAction: `create follow-up for person ${A} named Ada Lovelace|assigned to user ${B}`,
  createTaskAction: `create task: title=Prepare launch|description=Complete the room plan|status=not_started|priority=high|dueDate=2026-09-14|dueTime=13:30|assignedToId=${B}|category=launch_prep|relatedType=person|relatedId=${C}|parentTaskId=none|recurrence=weekly|recurrenceEndDate=2026-12-31|prerequisites=${A}`,
  deleteTaskAction: `delete task ${A}`,
  dismissPhaseTemplatePromptAction: `dismiss phase checklist for transition ${A}`,
  handOffFollowUpsAction: `hand off follow-ups from user ${A} to user ${B}`,
  importPhaseTemplatesAction: `import phase checklists for transition ${A}: discernment-and-preparation`,
  importTaskTemplateAction: "import task checklist discernment-and-preparation",
  quickAddTaskAction: "quick add task: Call venue|2026-09-14|urgent",
  reopenTaskAction: `reopen task ${A}`,
  setSubtaskCompletionAction: `check subtask ${A}`,
  updateTaskAction: `update task ${A}: title=Updated title|priority=urgent|prerequisites=${B},${C}`,
  updateTaskStatusAction: `set task ${A} status to in_progress`,
} as const;

test("the closed Task grammar selects every registered effect exactly", () => {
  const selected = Object.entries(COMMANDS).map(([exportName, command]) => {
    const result = selectTaskEvryEffect(command);
    assert.ok(result, command);
    assert.equal(result.exportName, exportName);
    return result.exportName;
  });
  const expected = Object.entries(TASK_ACTION_CONTRACTS)
    .filter(([, contract]) => contract.operationKind === "effect")
    .map(([exportName]) => exportName)
    .toSorted();
  assert.deepEqual(selected.toSorted(), expected);
});

test("the Task grammar has no generic execution escape hatch", () => {
  for (const request of [
    "run server action completeTaskAction",
    "fetch https://example.com/tasks",
    "execute SQL: update tasks set status='complete'",
    `task command: {"taskId":"${A}","status":"complete"}`,
    "POST /tasks/actions",
  ]) {
    assert.equal(selectTaskEvryEffect(request), null, request);
  }
});

test("status-to-complete stays a typed status action for canonical completion", () => {
  assert.deepEqual(selectTaskEvryEffect(`set task ${A} status to complete`), {
    kind: "effect",
    exportName: "updateTaskStatusAction",
    values: { taskId: A, status: "complete" },
  });
});

test("Task arguments reject duplicate, invalid, and unknown fields", () => {
  assert.equal(selectTaskEvryEffect(`complete tasks ${A},${A}`), null);
  assert.equal(
    selectTaskEvryEffect("create task: title=Good|completionEvent=forged"),
    null
  );
  assert.equal(
    selectTaskEvryEffect(`update task ${A}: dueDate=2026-02-31`),
    null
  );
  assert.equal(selectTaskEvryEffect(`set task ${A} status to invented`), null);
});
