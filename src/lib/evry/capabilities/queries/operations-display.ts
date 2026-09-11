import { z } from "zod";
import {
  calendarTileParts,
  formatDateWithoutWeekday,
  formatDateTimeWithZone,
  instantsAtZonedTime,
  parseDateTimeLocalValue,
} from "@/lib/datetime";
import {
  CATEGORY_CONFIG,
  PRIORITY_CONFIG,
  STATUS_CONFIG,
} from "@/lib/tasks/presentation";
import {
  MEETING_STATUS_LABELS,
  MEETING_TYPE_LABELS,
} from "@/lib/meetings/labels";
import { STATUS_LABELS } from "@/lib/people/status.shared";

export const operationDisplayFormat = z.enum([
  "calendar",
  "month",
  "instant",
  "meeting_time",
  "task_status",
  "priority",
  "category",
  "meeting_status",
  "meeting_type",
  "person_status",
  "team_status",
  "boolean",
  "record_label",
]);
export type OperationDisplayFormat = z.infer<typeof operationDisplayFormat>;
export const operationLabels: Record<
  string,
  Readonly<Record<string, string>>
> = {
  task_status: Object.fromEntries(
    Object.entries(STATUS_CONFIG).map(([key, value]) => [key, value.label])
  ),
  priority: Object.fromEntries(
    Object.entries(PRIORITY_CONFIG).map(([key, value]) => [key, value.label])
  ),
  category: Object.fromEntries(
    Object.entries(CATEGORY_CONFIG).map(([key, value]) => [key, value.label])
  ),
  meeting_status: MEETING_STATUS_LABELS,
  meeting_type: MEETING_TYPE_LABELS,
  person_status: STATUS_LABELS,
  team_status: {
    forming: "Forming",
    active: "Active",
    paused: "Paused",
    pending: "Pending",
    inactive: "Inactive",
    open: "Open",
    filled: "Filled",
  },
  boolean: { true: "Yes", false: "No" },
};

/** Only fields explicitly authored as identities carry the name [UUID] encoding. */
export function operationRecordLabel(value: string) {
  const start = value.lastIndexOf(" [");
  const id = value.slice(start + 2, -1);
  return start >= 0 &&
    value.endsWith("]") &&
    z.string().uuid().safeParse(id).success
    ? { label: value.slice(0, start), id }
    : { label: value };
}

export function formatOperationValue(
  value: string,
  format: OperationDisplayFormat | undefined,
  timeZone: string
): string {
  if (!format || value === "Not recorded") return value;
  if (format === "record_label") return operationRecordLabel(value).label;
  if (format === "month")
    return `${calendarTileParts(new Date(`${value}-01T00:00:00Z`), "UTC")[0]} ${value.slice(0, 4)}`;
  if (format === "calendar")
    return formatDateWithoutWeekday(
      new Date(`${value.slice(0, 10)}T00:00:00Z`),
      "short",
      "UTC"
    );
  if (format === "instant")
    return formatDateTimeWithZone(
      new Date(
        /[zZ]|[+-]\d\d:\d\d$/.test(value)
          ? value
          : `${value.replace(" ", "T")}Z`
      ),
      timeZone
    );
  if (format === "meeting_time") {
    const local = parseDateTimeLocalValue(value.replace(" ", "T").slice(0, 16));
    if (!local) throw new Error("Stored meeting time is invalid");
    const instants = instantsAtZonedTime(
      value.slice(0, 10),
      local.getUTCHours(),
      local.getUTCMinutes(),
      timeZone
    );
    return instants.length
      ? formatDateTimeWithZone(instants[0], timeZone)
      : "Meeting time needs review";
  }
  return operationLabels[format]?.[value] ?? "Not recorded";
}
