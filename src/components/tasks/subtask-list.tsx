"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { TaskWithAssignee } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import {
  addSubtaskAction,
  setSubtaskCompletionAction,
} from "@/app/(dashboard)/tasks/actions";

// ============================================================================
// Rows
// ============================================================================

interface SubtaskRow {
  id: string;
  title: string;
  complete: boolean;
  assigneeName: string | null;
  /** True while the row exists only in the optimistic state. */
  pending: boolean;
}

function toRows(subtasks: TaskWithAssignee[]): SubtaskRow[] {
  return subtasks.map((subtask) => ({
    id: subtask.id,
    title: subtask.title,
    complete: subtask.status === "complete",
    assigneeName: subtask.assigneeName,
    pending: false,
  }));
}

type OptimisticAction =
  | { type: "toggle"; id: string; complete: boolean }
  | { type: "add"; tempId: string; title: string };

function applyOptimisticAction(
  rows: SubtaskRow[],
  action: OptimisticAction
): SubtaskRow[] {
  switch (action.type) {
    case "toggle":
      return rows.map((row) =>
        row.id === action.id ? { ...row, complete: action.complete } : row
      );
    case "add":
      return [
        ...rows,
        {
          id: action.tempId,
          title: action.title,
          complete: false,
          assigneeName: null,
          pending: true,
        },
      ];
  }
}

// ============================================================================
// Component
// ============================================================================

interface SubtaskListProps {
  /** The task the checklist hangs off. */
  parentTaskId: string;
  /** Its live subtasks, oldest first, straight from the server. */
  subtasks: TaskWithAssignee[];
  /**
   * True when the "parent" is itself a subtask. Nesting is one level, so the
   * add control is not offered — the service would refuse it anyway, and an
   * input that always errors is worse than no input.
   */
  parentIsSubtask?: boolean;
}

/**
 * The subtask checklist on a task's detail view (T-016).
 *
 * ## Why the parent is never auto-completed
 *
 * Ticking the last box here does nothing to the task above it. That is the
 * ruling on #90, not an omission: "every item is ticked" and "this work is
 * finished" are different claims, and only the planter can make the second.
 * When the list is fully ticked the component says so and points at the
 * Complete button rather than pressing it.
 *
 * ## State
 *
 * Server data arrives as props and is never copied into `useState`. The only
 * local state is `useOptimistic`, so a tick lands instantly and is reconciled
 * when the action's `refresh()` re-renders the page with the true rows
 * (`memory/contracts/data-patterns.md`).
 */
export function SubtaskList({
  parentTaskId,
  subtasks,
  parentIsSubtask = false,
}: SubtaskListProps) {
  const [isPending, startTransition] = useTransition();
  const [rows, applyOptimistic] = useOptimistic(
    toRows(subtasks),
    applyOptimisticAction
  );

  // Counted from the optimistic rows, not the server ones, so the ratio moves
  // in the same frame as the checkbox the planter just clicked.
  const total = rows.length;
  const completed = rows.filter((row) => row.complete).length;
  const allDone = total > 0 && completed === total;

  function handleToggle(id: string, complete: boolean) {
    startTransition(async () => {
      applyOptimistic({ type: "toggle", id, complete });

      const result = await setSubtaskCompletionAction(id, complete);
      if (!result.success) {
        toast.error(result.error);
      }
    });
  }

  function handleAdd(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;

    startTransition(async () => {
      applyOptimistic({
        type: "add",
        tempId: `pending-${crypto.randomUUID()}`,
        title,
      });

      const result = await addSubtaskAction(parentTaskId, formData);
      if (!result.success) {
        toast.error(result.error);
      }
    });
  }

  return (
    <section aria-labelledby="subtasks-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="subtasks-heading" className="text-sm font-medium">
          Subtasks
        </h2>
        {total > 0 && (
          <p
            className="text-muted-foreground text-sm"
            data-testid="subtask-progress"
          >
            {completed} of {total} complete
          </p>
        )}
      </div>

      {total > 0 && (
        <Progress
          value={completed}
          max={total}
          aria-label={`Subtasks complete: ${completed} of ${total}`}
        />
      )}

      {total === 0 ? (
        <p className="text-muted-foreground text-sm">
          No subtasks yet. Break this task into steps to track it piece by
          piece.
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-3 py-2">
              <Checkbox
                id={`subtask-${row.id}`}
                checked={row.complete}
                disabled={row.pending}
                onCheckedChange={(checked) =>
                  handleToggle(row.id, checked === true)
                }
                className="cursor-pointer"
              />
              <label
                htmlFor={`subtask-${row.id}`}
                className={cn(
                  "flex-1 cursor-pointer text-sm",
                  row.complete && "text-muted-foreground line-through"
                )}
              >
                {row.title}
              </label>
              {row.assigneeName && (
                <span className="text-muted-foreground hidden text-xs sm:inline">
                  {row.assigneeName}
                </span>
              )}
              {!row.pending && (
                <Link
                  href={`/tasks/${row.id}`}
                  className="text-muted-foreground hover:text-foreground cursor-pointer text-xs underline-offset-4 hover:underline"
                >
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {allDone && (
        <p className="text-muted-foreground text-sm">
          Every subtask is done. Mark the task itself complete when you are
          ready — finishing the list does not finish the task.
        </p>
      )}

      {parentIsSubtask ? (
        <p className="text-muted-foreground text-sm">
          This is a subtask, and subtasks do not nest further.
        </p>
      ) : (
        <form action={handleAdd} className="flex items-center gap-2">
          <label htmlFor="subtask-title" className="sr-only">
            Subtask title
          </label>
          <Input
            id="subtask-title"
            name="title"
            placeholder="Add a subtask"
            maxLength={500}
            disabled={isPending}
          />
          <Button
            type="submit"
            variant="outline"
            className="cursor-pointer"
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </Button>
        </form>
      )}
    </section>
  );
}
