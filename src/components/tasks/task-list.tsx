import { Button } from "@/components/ui/button";
import { addCalendarDays, toCalendarDate } from "@/lib/datetime";
import type { TaskListRow } from "@/lib/tasks/service";
import { ListChecks } from "lucide-react";
import {
  BulkActionsBar,
  TaskGroupSelectAll,
  TaskSelectionProvider,
  TaskSelectionRow,
} from "./bulk-actions";
import { TaskCard } from "./task-card";

// ============================================================================
// Helpers
// ============================================================================

interface TaskGroup {
  label: string;
  tasks: TaskListRow[];
  variant: "overdue" | "today" | "upcoming" | "later" | "no_date" | "completed";
}

/**
 * Subtasks are never rows of their own here (T-016).
 *
 * `listTasks` already filters them out, so on the happy path this removes
 * nothing. It is here because the filter is an OPTION there (`includeSubtasks`)
 * and this list is the one place where letting them through would actively
 * mislead: six checklist items rendered beside their own parent read as seven
 * separate jobs, and the bulk-select checkbox would then hand a planter a
 * "select all" that spans two levels of the same task.
 */
function topLevelOnly(tasks: TaskListRow[]): TaskListRow[] {
  return tasks.filter((task) => task.parentTaskId === null);
}

/**
 * The five due-date buckets, decided in `APP_TIME_ZONE`.
 *
 * `now` is passed in rather than read here, and the arithmetic is UTC-day
 * arithmetic (`memory/invariants.md` → Date & Time Rendering). It used to floor
 * `new Date()` with `setHours` — the RUNTIME's midnight — and then call
 * `toISOString()`, which converts to UTC: on a machine east of UTC that pair
 * produces YESTERDAY's date string, so every task moved a bucket. The same
 * instant then reached the cards below, which were doing their own clock read.
 */
function groupTasksByDueDate(tasks: TaskListRow[], now: Date): TaskGroup[] {
  const todayStr = toCalendarDate(now);
  const weekEndStr = addCalendarDays(now, 7);

  const overdue: TaskListRow[] = [];
  const dueToday: TaskListRow[] = [];
  const upcoming: TaskListRow[] = []; // tomorrow through 7 days
  const later: TaskListRow[] = []; // beyond 7 days
  const noDate: TaskListRow[] = [];
  const completed: TaskListRow[] = [];

  for (const task of tasks) {
    if (task.status === "complete") {
      completed.push(task);
      continue;
    }

    if (!task.dueDate) {
      noDate.push(task);
      continue;
    }

    if (task.dueDate < todayStr) {
      overdue.push(task);
    } else if (task.dueDate === todayStr) {
      dueToday.push(task);
    } else if (task.dueDate <= weekEndStr) {
      upcoming.push(task);
    } else {
      later.push(task);
    }
  }

  const groups: TaskGroup[] = [];

  if (overdue.length > 0) {
    groups.push({
      label: `Overdue (${overdue.length})`,
      tasks: overdue,
      variant: "overdue",
    });
  }
  if (dueToday.length > 0) {
    groups.push({
      label: `Today (${dueToday.length})`,
      tasks: dueToday,
      variant: "today",
    });
  }
  if (upcoming.length > 0) {
    groups.push({
      label: `This Week (${upcoming.length})`,
      tasks: upcoming,
      variant: "upcoming",
    });
  }
  if (later.length > 0) {
    groups.push({
      label: `Later (${later.length})`,
      tasks: later,
      variant: "later",
    });
  }
  if (noDate.length > 0) {
    groups.push({
      label: `No Due Date (${noDate.length})`,
      tasks: noDate,
      variant: "no_date",
    });
  }
  if (completed.length > 0) {
    groups.push({
      label: `Completed (${completed.length})`,
      tasks: completed,
      variant: "completed",
    });
  }

  return groups;
}

const GROUP_STYLES: Record<string, string> = {
  overdue: "text-red-600",
  today: "text-orange-600",
  upcoming: "text-blue-600",
  later: "text-muted-foreground",
  no_date: "text-muted-foreground",
  completed: "text-green-600",
};

// ============================================================================
// Component
// ============================================================================

interface TaskListProps {
  tasks: TaskListRow[];
  total: number;
  nextCursor: string | null;
  personNotes?: Record<string, string>;
  /**
   * The instant every relative due date on this page is measured against.
   *
   * ONE read of the clock for the whole list, taken by the server component
   * that renders it and handed to every card. The cards hydrate, so a card that
   * read the clock itself would compute a different "3 days overdue" in the
   * browser and trip React #418 — and two cards could disagree with the group
   * heading above them across a midnight.
   */
  now: Date;
}

export function TaskList({
  tasks: allTasks,
  total,
  nextCursor,
  personNotes,
  now,
}: TaskListProps) {
  const tasks = topLevelOnly(allTasks);

  if (tasks.length === 0) {
    return (
      <div className="animate-in fade-in-50 flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
        <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-full">
          <ListChecks className="text-muted-foreground h-10 w-10" />
        </div>
        <h3 className="mt-4 text-lg font-medium">No tasks found</h3>
        <p className="text-muted-foreground mt-2 max-w-sm text-sm">
          No tasks match your current filters. Add a new task to get started.
        </p>
      </div>
    );
  }

  const groups = groupTasksByDueDate(tasks, now);

  return (
    // Selection is client state; the list itself stays a server component so
    // the due-date grouping is computed once, on the server.
    <TaskSelectionProvider>
      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.label} className="space-y-2">
            {/* gap-1 lines the group checkbox up with the per-row ones below,
                which sit in a gutter of the same width. */}
            <div className="flex items-center gap-1">
              <TaskGroupSelectAll
                taskIds={group.tasks.map((task) => task.id)}
                label={group.label}
                disabled={group.variant === "completed"}
              />
              <h3
                className={`text-sm font-semibold ${GROUP_STYLES[group.variant] ?? ""}`}
              >
                {group.label}
              </h3>
            </div>
            <div className="space-y-2">
              {group.tasks.map((task) => (
                <TaskSelectionRow
                  key={task.id}
                  taskId={task.id}
                  title={task.title}
                >
                  <TaskCard
                    task={task}
                    now={now}
                    personNote={
                      task.relatedType === "person" && task.relatedId
                        ? (personNotes?.[task.relatedId] ?? null)
                        : null
                    }
                  />
                </TaskSelectionRow>
              ))}
            </div>
          </div>
        ))}

        {nextCursor && (
          <div className="flex justify-center pt-4">
            <Button variant="outline" disabled>
              Load more (Pagination coming soon)
            </Button>
          </div>
        )}

        <div className="text-muted-foreground text-center text-xs">
          Showing {tasks.length} of {total} tasks
        </div>

        <BulkActionsBar />
      </div>
    </TaskSelectionProvider>
  );
}
