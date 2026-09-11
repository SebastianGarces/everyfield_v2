import { z } from "zod";

import {
  taskCategories,
  taskPriorities,
  taskRelatedTypes,
  taskStatuses,
} from "@/db/schema/tasks";
import { isCalendarDate } from "@/lib/validations/tasks";

import type { TaskEffectExport } from "./effect-contracts";

const uuid = z.string().uuid();
const UUID =
  "([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";

export type TaskEvryEffectSelection = Readonly<{
  kind: "effect";
  exportName: TaskEffectExport;
  values: Readonly<Record<string, unknown>>;
}>;

function effect(
  exportName: TaskEffectExport,
  values: Readonly<Record<string, unknown>> = {}
): TaskEvryEffectSelection {
  return { kind: "effect", exportName, values };
}

function uuidList(value: string): string[] | null {
  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 &&
    ids.length <= 100 &&
    ids.every((id) => uuid.safeParse(id).success) &&
    new Set(ids).size === ids.length
    ? ids
    : null;
}

const TASK_FIELDS = new Set([
  "title",
  "description",
  "status",
  "priority",
  "dueDate",
  "dueTime",
  "assignedToId",
  "category",
  "relatedType",
  "relatedId",
  "parentTaskId",
  "recurrence",
  "recurrenceEndDate",
  "prerequisites",
]);

function taskFields(value: string): Readonly<Record<string, unknown>> | null {
  const result: Record<string, unknown> = {};
  for (const part of value.split("|").map((entry) => entry.trim())) {
    const separator = part.indexOf("=");
    if (separator < 1) return null;
    const key = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    if (!TASK_FIELDS.has(key) || key in result) return null;
    if (key === "status") {
      if (!taskStatuses.includes(raw as (typeof taskStatuses)[number]))
        return null;
      result.status = raw;
    } else if (key === "priority") {
      if (!taskPriorities.includes(raw as (typeof taskPriorities)[number]))
        return null;
      result.priority = raw;
    } else if (key === "category") {
      if (!taskCategories.includes(raw as (typeof taskCategories)[number]))
        return null;
      result.category = raw;
    } else if (key === "relatedType") {
      if (!taskRelatedTypes.includes(raw as (typeof taskRelatedTypes)[number]))
        return null;
      result.relatedType = raw;
    } else if (
      key === "assignedToId" ||
      key === "relatedId" ||
      key === "parentTaskId"
    ) {
      if (raw !== "none" && !uuid.safeParse(raw).success) return null;
      result[key] = raw === "none" ? null : raw;
    } else if (key === "prerequisites") {
      const ids = raw === "none" ? [] : uuidList(raw);
      if (!ids) return null;
      result.prerequisiteTaskIds = ids;
    } else if (key === "dueDate" || key === "recurrenceEndDate") {
      if (raw !== "none" && !isCalendarDate(raw)) return null;
      result[key] = raw === "none" ? null : raw;
    } else if (key === "dueTime") {
      if (raw !== "none" && !/^\d{2}:\d{2}(?::\d{2})?$/.test(raw)) return null;
      result.dueTime = raw === "none" ? null : raw;
    } else if (key === "recurrence") {
      if (
        ![
          "none",
          "daily",
          "weekly",
          "biweekly",
          "monthly",
          "quarterly",
          "yearly",
        ].includes(raw)
      ) {
        return null;
      }
      result.recurrence = raw;
    } else {
      if (!raw && key === "title") return null;
      result[key] = raw === "none" ? null : raw;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** Closed Task grammar. No branch accepts JSON, URLs, SQL, or action names. */
export function selectTaskEvryEffect(
  literalUserText: string
): TaskEvryEffectSelection | null {
  const text = literalUserText.normalize("NFKC").trim();
  let match: RegExpExecArray | null;

  match = /^create task:\s*([\s\S]+)$/i.exec(text);
  if (match?.[1]) {
    const values = taskFields(match[1]);
    return values && typeof values.title === "string"
      ? effect("createTaskAction", values)
      : null;
  }
  match = /^quick add task:\s*([^|]+)(?:\|([^|]+))?(?:\|([^|]+))?$/i.exec(text);
  if (match?.[1]?.trim()) {
    const dueDate = match[2]?.trim() || null;
    const priority = match[3]?.trim() || "medium";
    return (dueDate === null || isCalendarDate(dueDate)) &&
      taskPriorities.includes(priority as (typeof taskPriorities)[number])
      ? effect("quickAddTaskAction", {
          title: match[1].trim(),
          dueDate,
          priority,
        })
      : null;
  }
  match = new RegExp(`^update task\\s+${UUID}:\\s*([\\s\\S]+)$`, "i").exec(
    text
  );
  if (match?.[1] && match[2]) {
    const values = taskFields(match[2]);
    return values
      ? effect("updateTaskAction", { taskId: match[1], ...values })
      : null;
  }

  const singleTask = (
    pattern: string,
    exportName: TaskEffectExport
  ): TaskEvryEffectSelection | null => {
    const selected = new RegExp(
      `^${pattern}\\s+(?:task\\s+)?${UUID}[.!?]*$`,
      "i"
    ).exec(text);
    return selected?.[1] ? effect(exportName, { taskId: selected[1] }) : null;
  };
  for (const [pattern, exportName] of [
    ["complete", "completeTaskAction"],
    ["reopen", "reopenTaskAction"],
    ["delete", "deleteTaskAction"],
  ] as const) {
    const selected = singleTask(pattern, exportName);
    if (selected) return selected;
  }

  match = new RegExp(
    `^set (?:task\\s+)?${UUID} status to ([a-z_]+)[.!?]*$`,
    "i"
  ).exec(text);
  if (
    match?.[1] &&
    match[2] &&
    taskStatuses.includes(match[2] as (typeof taskStatuses)[number])
  ) {
    return effect("updateTaskStatusAction", {
      taskId: match[1],
      status: match[2],
    });
  }

  match = new RegExp(
    `^add checklist item to (?:task\\s+)?${UUID}:\\s*([\\s\\S]+)$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]?.trim()) {
    return effect("addSubtaskAction", {
      parentTaskId: match[1],
      title: match[2].trim(),
    });
  }
  match = new RegExp(
    `^(check|uncheck) (?:subtask\\s+)?${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return effect("setSubtaskCompletionAction", {
      subtaskId: match[2],
      complete: match[1].toLowerCase() === "check",
    });
  }

  match = /^complete tasks\s+([0-9a-f,\s-]+)[.!?]*$/i.exec(text);
  if (match?.[1]) {
    const taskIds = uuidList(match[1].replace(/[.!?]+$/, ""));
    return taskIds ? effect("bulkCompleteTasksAction", { taskIds }) : null;
  }
  match =
    /^reschedule tasks\s+([0-9a-f,\s-]+)\s+to\s+(\d{4}-\d{2}-\d{2})[.!?]*$/i.exec(
      text
    );
  if (match?.[1] && match[2] && isCalendarDate(match[2])) {
    const taskIds = uuidList(match[1]);
    return taskIds
      ? effect("bulkRescheduleTasksAction", { taskIds, dueDate: match[2] })
      : null;
  }

  match = new RegExp(
    `^assign follow-up (?:task\\s+)?${UUID} to (?:user\\s+)?${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return effect("assignFollowUpAction", {
      taskId: match[1],
      assigneeId: match[2],
    });
  }
  match = new RegExp(
    `^create follow-up for person\\s+${UUID} named ([^|]+)\\|assigned to (?:user\\s+)?${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]?.trim() && match[3]) {
    return effect("createAndAssignFollowUpAction", {
      personId: match[1],
      personName: match[2].trim(),
      assigneeId: match[3],
    });
  }
  match = new RegExp(
    `^hand off follow-ups from (?:user\\s+)?${UUID} to (?:user\\s+)?${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return effect("handOffFollowUpsAction", {
      fromAssigneeId: match[1],
      toAssigneeId: match[2],
    });
  }

  match = /^import task checklist\s+([a-z0-9-]+)[.!?]*$/i.exec(text);
  if (match?.[1]) {
    return effect("importTaskTemplateAction", { templateKey: match[1] });
  }
  match = new RegExp(
    `^import phase checklists for transition\\s+${UUID}:\\s*([a-z0-9,\\s-]+)[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    const templateKeys = [
      ...new Set(
        match[2]
          .replace(/[.!?]+$/, "")
          .split(",")
          .map((key) => key.trim())
          .filter(Boolean)
      ),
    ];
    return templateKeys.length > 0
      ? effect("importPhaseTemplatesAction", {
          transitionId: match[1],
          templateKeys,
        })
      : null;
  }
  match = new RegExp(
    `^dismiss phase checklist for transition\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  return match?.[1]
    ? effect("dismissPhaseTemplatePromptAction", { transitionId: match[1] })
    : null;
}
