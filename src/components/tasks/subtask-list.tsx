"use client";

import { useCan } from "@/components/shared/viewer-capabilities";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { TaskWithAssignee } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { Check, Loader2, Plus } from "lucide-react";
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
  /** WHOSE ROW THIS IS — the subject half of `tasks.own` for the tick.
   *  `setSubtaskCompletionAction` is asked about the SUBTASK, not its parent,
   *  so each row answers "may I tick this?" for itself. */
  assignedToId: string | null;
  /** True while the row exists only in the optimistic state. */
  pending: boolean;
}

function toRows(subtasks: TaskWithAssignee[]): SubtaskRow[] {
  return subtasks.map((subtask) => ({
    id: subtask.id,
    title: subtask.title,
    complete: subtask.status === "complete",
    assigneeName: subtask.assigneeName,
    assignedToId: subtask.assignedToId,
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
          // Unassigned, which is what `createTask` stores for a subtask added
          // from this form — so the optimistic row offers the same tick the
          // reconciled one will.
          assignedToId: null,
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
  /** The viewer's own `users.id`. Identity, not authority — see
   *  `TaskCardProps.currentUserId`. */
  currentUserId: string;
  /** Who the PARENT task is assigned to. `addSubtaskAction`'s subject is the
   *  parent (it is a step on that task), so this is what decides the add form. */
  parentAssignedToId: string | null;
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
  currentUserId,
  parentAssignedToId,
}: SubtaskListProps) {
  // BOTH CONTROLS HERE ARE `tasks.own`, NOT `tasks.write` — and they have
  // DIFFERENT SUBJECTS, which is what this pair of booleans records.
  // `addSubtaskAction` asserts against the PARENT ("a Member may add a step to
  // a task assigned to them"); `setSubtaskCompletionAction` asserts against the
  // SUBTASK ROW, because completing a subtask goes through `completeTask` on
  // that row. Gating either on `tasks.write` alone would take a Member's own
  // checklist away from them.
  const canWrite = useCan("tasks.write");
  const mayActOnParent = canWrite || parentAssignedToId === currentUserId;
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
          {mayActOnParent
            ? "No subtasks yet. Break this task into steps to track it piece by piece."
            : "No subtasks yet. Whoever this task belongs to breaks it into steps."}
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {rows.map((row) => {
            const canTick = canWrite || row.assignedToId === currentUserId;

            return (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                {canTick ? (
                  <Checkbox
                    id={`subtask-${row.id}`}
                    checked={row.complete}
                    disabled={row.pending}
                    onCheckedChange={(checked) =>
                      handleToggle(row.id, checked === true)
                    }
                    className="cursor-pointer"
                  />
                ) : (
                  // HIDDEN, NOT DISABLED (AS-020) — but the STATE is not what
                  // is hidden. The checkbox was carrying two things at once,
                  // the affordance and "is this done", and only the first is a
                  // permission question. So the gutter keeps its width and the
                  // done rows keep their mark — in WORDS as well as in green,
                  // because a strike-through and a tick are both invisible to a
                  // screen reader that no longer has a checked checkbox to read.
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {row.complete && (
                      <>
                        <Check
                          aria-hidden="true"
                          className="h-4 w-4 text-green-600 dark:text-green-500"
                        />
                        <span className="sr-only">Complete</span>
                      </>
                    )}
                  </span>
                )}
                {canTick ? (
                  <label
                    htmlFor={`subtask-${row.id}`}
                    className={cn(
                      "flex-1 cursor-pointer text-sm",
                      row.complete && "text-muted-foreground line-through"
                    )}
                  >
                    {row.title}
                  </label>
                ) : (
                  <span
                    className={cn(
                      "flex-1 text-sm",
                      row.complete && "text-muted-foreground line-through"
                    )}
                  >
                    {row.title}
                  </span>
                )}
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
            );
          })}
        </ul>
      )}

      {allDone && (
        <p className="text-muted-foreground text-sm">
          {mayActOnParent
            ? "Every subtask is done. Mark the task itself complete when you are ready — finishing the list does not finish the task."
            : "Every subtask is done. Finishing the list does not finish the task — its owner marks it complete."}
        </p>
      )}

      {/* THE ADD FORM IS THE PARENT'S, so it follows the parent's own rule
          rather than the checklist's: `addSubtaskAction` loads the parent and
          asserts against it. `parentIsSubtask` is a business rule (nesting is
          one level), not a permission one, so its explanation stays. */}
      {parentIsSubtask ? (
        <p className="text-muted-foreground text-sm">
          This is a subtask, and subtasks do not nest further.
        </p>
      ) : mayActOnParent ? (
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
      ) : null}
    </section>
  );
}
