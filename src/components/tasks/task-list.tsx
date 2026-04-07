import { Button } from "@/components/ui/button";
import type { TaskWithAssignee } from "@/lib/tasks/types";
import { ListChecks } from "lucide-react";
import { TaskCard } from "./task-card";

// ============================================================================
// Helpers
// ============================================================================

interface TaskGroup {
  label: string;
  tasks: TaskWithAssignee[];
  variant: "overdue" | "today" | "upcoming" | "later" | "no_date" | "completed";
}

function groupTasksByDueDate(tasks: TaskWithAssignee[]): TaskGroup[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().split("T")[0];

  const overdue: TaskWithAssignee[] = [];
  const dueToday: TaskWithAssignee[] = [];
  const upcoming: TaskWithAssignee[] = []; // tomorrow through 7 days
  const later: TaskWithAssignee[] = []; // beyond 7 days
  const noDate: TaskWithAssignee[] = [];
  const completed: TaskWithAssignee[] = [];

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
  tasks: TaskWithAssignee[];
  total: number;
  nextCursor: string | null;
  personNotes?: Record<string, string>;
}

export function TaskList({
  tasks,
  total,
  nextCursor,
  personNotes,
}: TaskListProps) {
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

  const groups = groupTasksByDueDate(tasks);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label} className="space-y-2">
          <h3
            className={`text-sm font-semibold ${GROUP_STYLES[group.variant] ?? ""}`}
          >
            {group.label}
          </h3>
          <div className="space-y-2">
            {group.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                personNote={
                  task.relatedType === "person" && task.relatedId
                    ? (personNotes?.[task.relatedId] ?? null)
                    : null
                }
              />
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
    </div>
  );
}
