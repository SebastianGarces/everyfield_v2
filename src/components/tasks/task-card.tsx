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

import { useCan } from "@/components/shared/viewer-capabilities";
import { Checkbox } from "@/components/ui/checkbox";
import type { TaskListRow } from "@/lib/tasks/service";
import { mayActOnTaskRow } from "@/lib/tasks/own-duty";
import { Check } from "lucide-react";
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
  /**
   * The viewer's own `users.id` — the other half of `tasks.own` (AS-006).
   *
   * IDENTITY, NOT A PERMISSION DECISION, which is why it is threaded rather
   * than asked from the capability context. "May the viewer complete a task?"
   * is answered by the seat table; "is THIS task theirs?" needs the row and the
   * account, and `assignedToId` is already on every row while the session's id
   * is server-side only. The rule below is `mayActOnTask`
   * (`@/lib/tasks/service`) — the same predicate the action enforces.
   */
  currentUserId: string;
}

export function TaskCard({
  task,
  personNote,
  now,
  currentUserId,
}: TaskCardProps) {
  const [isPending, startTransition] = useTransition();

  const isComplete = task.status === "complete";

  // THE SWEEP'S ONE SURVIVOR. `completeTaskAction` and `reopenTaskAction` are
  // `tasks.own` (SEATED) — a Member HOLDS that verb, and `assertMayActOnTask`
  // checks the subject half server-side. Gating this on `tasks.write` alone
  // would hide a Member's own assigned work from them, which is the over-hide
  // AS-020 forbids just as firmly as an under-hide.
  //
  // The rule is `mayActOnTaskRow`, which `mayActOnTask` in the service also
  // calls: it was two spellings of one sentence until #660, and what the
  // checkbox is drawn from must be what the action will accept.
  const canComplete = mayActOnTaskRow({
    canWrite: useCan("tasks.write"),
    assignedToId: task.assignedToId,
    viewerId: currentUserId,
  });

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
        canComplete ? (
          <Checkbox
            checked={isComplete}
            onCheckedChange={handleToggleComplete}
            disabled={isPending}
            className="cursor-pointer"
            aria-label={isComplete ? "Reopen task" : "Complete task"}
          />
        ) : (
          // NOT `undefined` — the CONTROL is what AS-020 hides, and the two
          // things the checkbox was carrying beside it are not permissions.
          // A read-only list is mixed (the viewer's own rows keep their
          // checkbox), so an empty slot would indent every other row by the
          // gutter's width; and "is this done" is announced in words, because
          // the strike-through above is invisible to a screen reader once
          // there is no checked checkbox to read.
          <span className="flex size-4 items-center justify-center">
            {isComplete && (
              <>
                <Check
                  aria-hidden="true"
                  className="size-4 text-green-600 dark:text-green-500"
                />
                <span className="sr-only">Complete</span>
              </>
            )}
          </span>
        )
      }
    />
  );
}
