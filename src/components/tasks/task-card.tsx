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
import type { TaskListRow } from "@/lib/tasks/service";
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
  /** A LIST row: `description` is the stored markup and `descriptionPreview`
   *  the readable summary the card renders (T-021). Typed as the row the
   *  service actually returns, so the preview cannot be dropped on the way
   *  through this boundary without the compiler saying so. */
  task: TaskListRow;
  personNote?: string | null;
  /** The instant the due-date line is measured against — one for the whole
   *  list, from the server. See `TaskCardViewProps.now`. */
  now: Date;
}

export function TaskCard({ task, personNote, now }: TaskCardProps) {
  const [isPending, startTransition] = useTransition();

  const isComplete = task.status === "complete";
  const isBlocked = task.isBlocked;

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
      now={now}
      isPending={isPending}
      checkboxSlot={
        <Checkbox
          checked={isComplete}
          onCheckedChange={handleToggleComplete}
          disabled={isPending || (isBlocked && !isComplete)}
          className="cursor-pointer"
          aria-label={
            isComplete
              ? "Reopen task"
              : isBlocked
                ? "Complete task (waiting on prerequisites)"
                : "Complete task"
          }
        />
      }
    />
  );
}
