"use client";

// ============================================================================
// TaskCard — the behaviour, and nothing else.
//
// The card's markup, its config tables (PRIORITY_CONFIG, CATEGORY_CONFIG,
// STATUS_CONFIG) and its due-date formatting all moved to task-card-view.tsx,
// which is server-safe and is now the single definition of what a task row
// looks like. Import them from there, not from here: this module is a client
// boundary, so anything re-exported through it becomes a client reference and
// stops being callable on the server.
//
// What is left is the only thing a task row actually *does* — complete/reopen
// — plus the checkbox that fires it, handed to the view as a slot.
// ============================================================================

import { Checkbox } from "@/components/ui/checkbox";
import type { TaskWithAssignee } from "@/lib/tasks/types";
import { useTransition } from "react";
import {
  completeTaskAction,
  reopenTaskAction,
} from "@/app/(dashboard)/tasks/actions";
import { toast } from "sonner";
import { TaskCardView } from "./task-card-view";

// ============================================================================
// Component
// ============================================================================

interface TaskCardProps {
  task: TaskWithAssignee;
  personNote?: string | null;
}

export function TaskCard({ task, personNote }: TaskCardProps) {
  const [isPending, startTransition] = useTransition();

  const isComplete = task.status === "complete";

  function handleToggleComplete() {
    startTransition(async () => {
      const result = isComplete
        ? await reopenTaskAction(task.id)
        : await completeTaskAction(task.id);

      if (!result.success) {
        toast.error(result.error);
      } else if (!isComplete) {
        toast.success("Task completed");
      }
    });
  }

  return (
    <TaskCardView
      task={task}
      personNote={personNote}
      isPending={isPending}
      checkboxSlot={
        <Checkbox
          checked={isComplete}
          onCheckedChange={handleToggleComplete}
          disabled={isPending}
          className="cursor-pointer"
          aria-label={isComplete ? "Reopen task" : "Complete task"}
        />
      }
    />
  );
}
