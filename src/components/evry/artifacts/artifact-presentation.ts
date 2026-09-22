import { formatDateWithoutWeekday } from "@/lib/datetime";
import {
  taskEffectSnapshotSchema,
  TASKS_EFFECT_ARGUMENT_SCHEMAS,
} from "@/lib/evry/capabilities/tasks/effect-contracts";
import {
  CATEGORY_CONFIG,
  PRIORITY_CONFIG,
  STATUS_CONFIG,
} from "@/lib/tasks/presentation";

type ReviewTarget = Readonly<{
  label: string;
  value: string;
  sourceLink: Readonly<{ label: string; href: string }> | null;
}>;

type ContentPreview = Readonly<{
  label: string;
  content: string;
  format?: "plain_text" | "rich_text";
}>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_TARGET =
  /(^|\s)(id|ids|type|version|mode|baseline|rows?|targets?|fields?|exclusions?|recipient source|audience|expected.*|created by)(\s|$)/i;
const INTERNAL_PREVIEW =
  /complete immutable plan|immutable task plan evidence|identity|notification(?:\s+\d+)?$/i;
const MEETING_INTERNAL_TARGET =
  /^(datetime|timezone|status|estimated attendance|duration minutes|agenda|meeting number|checklist items)$/i;

const CUSTOMER_TARGET_LABELS = new Map([
  ["title", "Meeting"],
  ["location name", "Location"],
  ["location address", "Address"],
]);

function readableLabel(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function looksLikeStructuredData(value: string): boolean {
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

type ReviewChange = Readonly<{
  label: string;
  before: string;
  after: string;
  count: number;
}>;
type TaskChange = Readonly<{ before: unknown; after: unknown }>;
type TaskTarget = Readonly<{
  title: string;
  changes: Record<string, TaskChange>;
}>;
type ReviewExclusion = Readonly<{ reason: string; count: number }>;
type TaskExclusionGroup = ReviewExclusion &
  Readonly<{
    label: string;
    tasks: readonly Readonly<{ title: string; href: string | null }>[];
  }>;
type TaskExclusions = Readonly<{
  groups: readonly TaskExclusionGroup[];
  contactLogNotes: readonly ReviewExclusion[];
}>;
const TASK_PREFIX = /^Task ([0-9a-f-]{36}): /i;
const TASK_EVIDENCE = /^Immutable Task plan evidence(?: \(\d+\))?$/;
const TASK_BOOKKEEPING = new Set([
  "id",
  "createdAt",
  "createdById",
  "updatedAt",
  "completedAt",
  "completedById",
]);
const TASK_FIELD_LABELS = new Map([
  ["dueDate", "Due date"],
  ["dueTime", "Due time"],
  ["assignedToId", "Assignee"],
  ["parentTaskId", "Parent task"],
  ["relatedId", "Related record"],
  ["relatedType", "Related record type"],
  ["isRecurring", "Repeats"],
  ["recurrenceRule", "Repeat schedule"],
  ["deletedAt", "Task availability"],
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function taskTarget(target: ReviewTarget): TaskTarget | null {
  if (!/^Task \d+$/.test(target.label) || !TASK_PREFIX.test(target.value))
    return null;
  try {
    const value: unknown = JSON.parse(target.value.replace(TASK_PREFIX, ""));
    if (
      !record(value) ||
      typeof value.title !== "string" ||
      !record(value.changes)
    )
      return null;
    const changes: Record<string, TaskChange> = {};
    for (const [key, change] of Object.entries(value.changes)) {
      if (!record(change) || !("before" in change) || !("after" in change))
        return null;
      changes[key] = { before: change.before, after: change.after };
    }
    return { title: value.title, changes };
  } catch {
    return null;
  }
}

// Large task edits use chunked evidence instead of the compact target. Read
// only the matching write; never render the snapshots or notification payload.
function taskPlanEvidence(previews: readonly ContentPreview[]): unknown {
  try {
    return JSON.parse(
      previews
        .filter((p) => TASK_EVIDENCE.test(p.label))
        .map((p) => p.content)
        .join("")
    );
  } catch {
    return null;
  }
}

function expandedTaskTargets(value: unknown): Map<string, TaskTarget> {
  const result = new Map<string, TaskTarget>();
  try {
    if (!record(value) || !Array.isArray(value.taskWrites)) return result;
    for (const write of value.taskWrites) {
      if (
        !record(write) ||
        typeof write.taskId !== "string" ||
        result.has(write.taskId)
      )
        return new Map();
      const afterSnapshot = taskEffectSnapshotSchema.safeParse(write.after);
      const beforeSnapshot = taskEffectSnapshotSchema
        .nullable()
        .safeParse(write.before);
      if (
        !afterSnapshot.success ||
        !beforeSnapshot.success ||
        afterSnapshot.data.id !== write.taskId ||
        (beforeSnapshot.data !== null &&
          beforeSnapshot.data.id !== write.taskId)
      )
        return new Map();
      const changes: Record<string, TaskChange> = {};
      for (const [field, after] of Object.entries(afterSnapshot.data)) {
        const before =
          beforeSnapshot.data === null
            ? "Absent"
            : Object.entries(beforeSnapshot.data).find(
                ([key]) => key === field
              )?.[1];
        if (JSON.stringify(before) !== JSON.stringify(after))
          changes[field] = { before, after };
      }
      result.set(write.taskId, { title: afterSnapshot.data.title, changes });
    }
  } catch {
    /* The caller discloses unavailable details instead of raw chunks. */
  }
  return result;
}

function customerTaskExclusions(
  evidence: unknown,
  exclusions: readonly ReviewExclusion[]
): { value: TaskExclusions | null; detailsUnavailable: boolean } {
  if (!record(evidence))
    return { value: null, detailsUnavailable: exclusions.length > 0 };
  const schema =
    evidence.operation === "bulkCompleteTasksAction"
      ? TASKS_EFFECT_ARGUMENT_SCHEMAS.bulkCompleteTasksAction
      : evidence.operation === "bulkRescheduleTasksAction"
        ? TASKS_EFFECT_ARGUMENT_SCHEMAS.bulkRescheduleTasksAction
        : null;
  const bulk =
    schema !== null ||
    (record(evidence.sourceAssertion) &&
      evidence.sourceAssertion.kind === "bulk_selection");
  if (!bulk) {
    const operationSchema = Object.entries(TASKS_EFFECT_ARGUMENT_SCHEMAS).find(
      ([operation]) => operation === evidence.operation
    )?.[1];
    return {
      value: null,
      // Missing discriminators must not turn an incomplete bulk review into
      // a valid non-bulk review. Existing non-bulk effects can retain their
      // ancillary notices only with a complete canonical argument contract.
      detailsUnavailable:
        exclusions.length > 0 && !operationSchema?.safeParse(evidence).success,
    };
  }
  const parsed = schema?.safeParse(evidence);
  if (!parsed?.success || parsed.data.sourceAssertion.kind !== "bulk_selection")
    return { value: null, detailsUnavailable: true };

  const counts = new Map<string, number>();
  for (const { reason } of parsed.data.exclusions)
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  if (
    exclusions.length !== counts.size ||
    new Set(exclusions.map((e) => e.reason)).size !== counts.size ||
    exclusions.some(({ reason, count }) => counts.get(reason) !== count)
  )
    return { value: null, detailsUnavailable: true };

  const groups = new Map<
    string,
    {
      reason: string;
      label: string;
      count: number;
      tasks: { title: string; href: string | null }[];
    }
  >();
  const labels = {
    "Task not found": "Unavailable tasks",
    "Task is already complete": "Already complete",
    "Task is complete — reopen it before rescheduling":
      "Complete; reopen before rescheduling",
    "That task is assigned to somebody else": "Assigned to someone else",
  };
  for (const { reason, expectedTask } of parsed.data.sourceAssertion
    .excludedTasks) {
    const group = groups.get(reason) ?? {
      reason,
      label: labels[reason],
      count: 0,
      tasks: [],
    };
    group.count++;
    group.tasks.push(
      expectedTask
        ? { title: expectedTask.title, href: `/tasks/${expectedTask.id}` }
        : { title: "Unavailable task", href: null }
    );
    groups.set(reason, group);
  }
  return {
    value: {
      groups: [...groups.values()],
      // The canonical bulk schema accounts for every other exclusion as a
      // skipped contact-log effect. It does not mean the task is unchanged.
      contactLogNotes: exclusions.filter(({ reason }) => !groups.has(reason)),
    },
    detailsUnavailable: false,
  };
}

function taskFieldValue(field: string, value: unknown): string {
  if (value === "Absent") return "Not created";
  if (field === "deletedAt") return value === null ? "Active" : "Deleted";
  if (value === null || value === undefined)
    return field === "assignedToId" ? "Unassigned" : "None";
  if (
    field === "dueDate" &&
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    )
      return formatDateWithoutWeekday(date, "short", "UTC");
  }
  if (typeof value === "string") {
    const labels =
      field === "status"
        ? STATUS_CONFIG
        : field === "priority"
          ? PRIORITY_CONFIG
          : field === "category"
            ? CATEGORY_CONFIG
            : null;
    return labels && Object.hasOwn(labels, value) ? labels[value].label : value;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return (
      value.map((item) => taskFieldValue(field, item)).join(", ") || "None"
    );
  if (record(value))
    return Object.entries(value)
      .map(
        ([key, item]) => `${readableLabel(key)}: ${taskFieldValue(key, item)}`
      )
      .join("; ");
  return String(value);
}

/** Display the exact task edits, without unchanged fields or storage metadata. */
export function customerTaskReview(input: {
  resolvedTargets: readonly ReviewTarget[];
  contentPreviews: readonly ContentPreview[];
  beforeAfter: readonly ReviewChange[];
  exclusions?: readonly ReviewExclusion[];
}): Readonly<{
  targets: readonly ReviewTarget[];
  changes: readonly ReviewChange[];
  detailsUnavailable: boolean;
  exclusions: TaskExclusions | null;
}> | null {
  const evidence = taskPlanEvidence(input.contentPreviews);
  const expanded = expandedTaskTargets(evidence);
  const exclusions = customerTaskExclusions(evidence, input.exclusions ?? []);
  const represented = new Map<string, number>();
  const changes: ReviewChange[] = [];
  let found = false;
  let detailsUnavailable = exclusions.detailsUnavailable;
  const targets = input.resolvedTargets.map((target) => {
    const id = /^Task \d+$/.test(target.label)
      ? TASK_PREFIX.exec(target.value)?.[1]
      : undefined;
    const task =
      id && (!target.sourceLink || target.sourceLink.href === `/tasks/${id}`)
        ? expanded.get(id)
        : undefined;
    if (!task) {
      if (!id) return target;
      found = true;
      detailsUnavailable = true;
      return { ...target, value: "Task details unavailable" };
    }
    found = true;
    for (const [field, change] of Object.entries(task.changes)) {
      if (
        TASK_BOOKKEEPING.has(field) ||
        JSON.stringify(change.before) === JSON.stringify(change.after)
      )
        continue;
      const label = TASK_FIELD_LABELS.get(field) ?? readableLabel(field);
      changes.push({
        label: `${task.title}: ${label}`,
        before: taskFieldValue(field, change.before),
        after: taskFieldValue(field, change.after),
        count: 1,
      });
      const legacyField =
        field === "dueDate"
          ? "due date"
          : field === "assignedToId"
            ? "assignee"
            : field === "status"
              ? "status"
              : null;
      if (legacyField) {
        const key = JSON.stringify([
          `${task.title} — ${legacyField}`,
          taskFieldValue(field, change.before),
          taskFieldValue(field, change.after),
        ]);
        represented.set(key, (represented.get(key) ?? 0) + 1);
      }
    }
    return { ...target, value: task.title };
  });
  if (!found) return null;
  const remaining = input.beforeAfter.filter((change) => {
    if (change.before === change.after) return false;
    const suffix = / — (status|due date|assignee)$/.exec(change.label)?.[1];
    if (!suffix) return true;
    const field =
      suffix === "due date"
        ? "dueDate"
        : suffix === "assignee"
          ? "assignedToId"
          : "status";
    const key = JSON.stringify([
      change.label,
      taskFieldValue(field, change.before),
      taskFieldValue(field, change.after),
    ]);
    const count = represented.get(key) ?? 0;
    if (count > 0) {
      represented.set(key, count - 1);
      return false;
    }
    detailsUnavailable = true;
    return true;
  });
  return {
    targets: customerReviewTargets(targets),
    changes: [...changes, ...remaining],
    detailsUnavailable,
    exclusions: exclusions.value,
  };
}

/** Keep immutable review evidence in storage while projecting only customer data. */
export function customerReviewTargets(
  targets: readonly ReviewTarget[],
  effectKind?: string
): readonly ReviewTarget[] {
  return targets.flatMap((target) => {
    const label = readableLabel(target.label);
    const value = taskTarget(target)?.title ?? target.value.trim();
    if (
      effectKind === "meeting" &&
      MEETING_INTERNAL_TARGET.test(label.toLocaleLowerCase("en-US"))
    ) {
      return [];
    }
    if (
      value.length > 0 &&
      value.toLocaleLowerCase("en-US") !== "null" &&
      !UUID.test(value) &&
      !looksLikeStructuredData(value) &&
      !INTERNAL_TARGET.test(label)
    ) {
      return [
        {
          ...target,
          label:
            CUSTOMER_TARGET_LABELS.get(label.toLocaleLowerCase("en-US")) ??
            label,
          value,
        },
      ];
    }
    return [];
  });
}

export function customerContentPreviews(
  previews: readonly ContentPreview[],
  taskDetailsUnavailable = false
): readonly ContentPreview[] {
  const seen = new Set<string>();
  const customerPreviews = previews.flatMap((preview) => {
    const readable = readableLabel(preview.label);
    if (
      INTERNAL_PREVIEW.test(readable) ||
      (preview.format === undefined && looksLikeStructuredData(preview.content))
    ) {
      return [];
    }
    let content = preview.content;
    if (preview.format === undefined) {
      try {
        const parsed: unknown = JSON.parse(content);
        if (typeof parsed === "string") content = parsed;
      } catch {
        // Plain text is already customer-readable.
      }
    }
    const label = /subject/i.test(readable)
      ? "Subject"
      : /message|body/i.test(readable)
        ? "Message"
        : readable;
    const identity = `${label}\u0000${content}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ ...preview, label, content }];
  });
  return taskDetailsUnavailable
    ? [
        ...customerPreviews,
        {
          label: "Task details unavailable",
          content:
            "Some task changes could not be displayed. Request a new review before confirming.",
          format: "plain_text",
        },
      ]
    : customerPreviews;
}

export function readResultLabel(count: number): string {
  return `${count.toLocaleString()} result${count === 1 ? "" : "s"}`;
}
