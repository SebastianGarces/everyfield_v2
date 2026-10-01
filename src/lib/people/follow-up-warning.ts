import { toCalendarDate } from "@/lib/datetime";

export type PersonFollowUpTask = { id: string; dueDate: string | null };

/** Date-only obligations become overdue after their church-local calendar day. */
export function getFollowUpInfo(
  tasks: PersonFollowUpTask[] = [],
  now: Date,
  timeZone: string
) {
  if (tasks.length === 0) return null;
  const dated = tasks
    .filter(
      (task): task is PersonFollowUpTask & { dueDate: string } =>
        task.dueDate !== null
    )
    .sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)
    );
  const first = dated[0];
  const today = toCalendarDate(now, timeZone);
  return {
    count: tasks.length,
    taskId: first?.id ?? tasks[0].id,
    dueDate: first?.dueDate ?? null,
    overdueCount: dated.filter((task) => task.dueDate < today).length,
  };
}
