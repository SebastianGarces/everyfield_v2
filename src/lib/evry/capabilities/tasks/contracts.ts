export type TaskOperationKind = "read" | "effect";

export type TaskMutationShape =
  | "single_create"
  | "single_update"
  | "single_soft_delete"
  | "compound_write"
  | "bulk_write";

export type TaskActionContract = Readonly<{
  operationId: string;
  domain:
    | "checklist"
    | "follow_up"
    | "lifecycle"
    | "list"
    | "phase_template"
    | "template";
  operationKind: TaskOperationKind;
  label: string;
  actionLabel: string | null;
  argumentKeys: readonly string[];
  difficultToReverse: boolean;
  mutationShape: TaskMutationShape | null;
}>;

function effect(
  operationId: string,
  domain: TaskActionContract["domain"],
  actionLabel: string,
  argumentKeys: readonly string[],
  mutationShape: TaskMutationShape,
  difficultToReverse = false
): TaskActionContract {
  return Object.freeze({
    operationId,
    domain,
    operationKind: "effect",
    label: actionLabel,
    actionLabel,
    argumentKeys: Object.freeze([...argumentKeys]),
    difficultToReverse,
    mutationShape,
  });
}

function read(
  operationId: string,
  domain: TaskActionContract["domain"],
  label: string,
  argumentKeys: readonly string[]
): TaskActionContract {
  return Object.freeze({
    operationId,
    domain,
    operationKind: "read",
    label,
    actionLabel: null,
    argumentKeys: Object.freeze([...argumentKeys]),
    difficultToReverse: false,
    mutationShape: null,
  });
}

/** One closed semantic operation for every authenticated Task action export. */
export const TASK_ACTION_CONTRACTS = {
  addSubtaskAction: effect(
    "tasks.checklist.add",
    "checklist",
    "Add checklist item",
    ["parentTaskId", "subtaskId", "task", "expectedParentUpdatedAt"],
    "compound_write"
  ),
  assignFollowUpAction: effect(
    "tasks.follow-up.assign",
    "follow_up",
    "Assign follow-up",
    ["taskId", "before", "afterAssignee", "notificationChange"],
    "compound_write"
  ),
  bulkCompleteTasksAction: effect(
    "tasks.bulk.complete",
    "lifecycle",
    "Complete selected tasks",
    ["tasks", "completedAt", "recurrenceSuccessors", "notifications"],
    "bulk_write"
  ),
  bulkRescheduleTasksAction: effect(
    "tasks.bulk.reschedule",
    "lifecycle",
    "Reschedule selected tasks",
    ["dueDate", "tasks", "notifications"],
    "bulk_write"
  ),
  completeTaskAction: effect(
    "tasks.lifecycle.complete",
    "lifecycle",
    "Complete task",
    ["task", "completedAt", "recurrenceSuccessor", "notifications"],
    "compound_write"
  ),
  createAndAssignFollowUpAction: effect(
    "tasks.follow-up.create-and-assign",
    "follow_up",
    "Create and assign follow-up",
    ["taskId", "person", "assignee", "title", "notifications"],
    "compound_write"
  ),
  createTaskAction: effect(
    "tasks.create",
    "lifecycle",
    "Create task",
    ["taskId", "task", "prerequisites", "notifications"],
    "compound_write"
  ),
  deleteTaskAction: effect(
    "tasks.lifecycle.delete",
    "lifecycle",
    "Delete task and checklist",
    ["task", "subtasks", "notifications"],
    "compound_write",
    true
  ),
  dismissPhaseTemplatePromptAction: effect(
    "tasks.phase-template.dismiss",
    "phase_template",
    "Dismiss phase checklist suggestions",
    ["transition", "answerId"],
    "single_create",
    true
  ),
  handOffFollowUpsAction: effect(
    "tasks.follow-up.handoff",
    "follow_up",
    "Hand off follow-ups",
    ["fromAssigneeId", "toAssignee", "tasks", "notifications"],
    "bulk_write"
  ),
  importPhaseTemplatesAction: effect(
    "tasks.phase-template.import",
    "phase_template",
    "Import phase checklists",
    ["transition", "templateKeys", "answerId", "tasks", "notifications"],
    "compound_write"
  ),
  importTaskTemplateAction: effect(
    "tasks.template.import",
    "template",
    "Import task checklist",
    ["templateKey", "templateName", "importedOn", "tasks", "notifications"],
    "bulk_write"
  ),
  loadMoreTasksAction: read("tasks.read.list", "list", "List tasks", [
    "filters",
    "cursor",
  ]),
  quickAddTaskAction: effect(
    "tasks.quick-create",
    "lifecycle",
    "Quick add task",
    ["taskId", "title", "dueDate", "priority", "notifications"],
    "compound_write"
  ),
  reopenTaskAction: effect(
    "tasks.lifecycle.reopen",
    "lifecycle",
    "Reopen task",
    ["task", "notifications"],
    "compound_write"
  ),
  setSubtaskCompletionAction: effect(
    "tasks.checklist.completion",
    "checklist",
    "Update checklist item",
    ["parentTask", "subtask", "afterStatus", "notifications"],
    "compound_write"
  ),
  updateTaskAction: effect(
    "tasks.lifecycle.update",
    "lifecycle",
    "Update task",
    [
      "task",
      "after",
      "beforePrerequisites",
      "afterPrerequisites",
      "notifications",
    ],
    "compound_write"
  ),
  updateTaskStatusAction: effect(
    "tasks.lifecycle.status",
    "lifecycle",
    "Update task status",
    ["task", "afterStatus", "notifications"],
    "compound_write"
  ),
} as const satisfies Readonly<Record<string, TaskActionContract>>;

export type TaskActionExport = keyof typeof TASK_ACTION_CONTRACTS;
