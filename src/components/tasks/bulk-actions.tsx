"use client";

import {
  bulkCompleteTasksAction,
  bulkRescheduleTasksAction,
} from "@/app/(dashboard)/tasks/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BulkTaskFailure, BulkTaskResult } from "@/lib/tasks/service";
import { MAX_BULK_TASKS } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { CalendarClock, CheckCheck, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

// ============================================================================
// Selection state
// ============================================================================
//
// Which rows are ticked is UI state, not server data — it lives in a client
// context so the per-row checkboxes, the per-group "select all", and the action
// bar all read one source of truth without prop-drilling through the (server
// rendered) task list.
// ============================================================================

interface TaskSelectionValue {
  selectedIds: string[];
  count: number;
  isSelected: (taskId: string) => boolean;
  setSelected: (taskId: string, selected: boolean) => void;
  setManySelected: (taskIds: string[], selected: boolean) => void;
  clear: () => void;
}

const TaskSelectionContext = createContext<TaskSelectionValue | null>(null);

function useTaskSelection(): TaskSelectionValue {
  const context = useContext(TaskSelectionContext);
  if (!context) {
    throw new Error(
      "Task selection components must be rendered inside <TaskSelectionProvider>"
    );
  }
  return context;
}

export function TaskSelectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selected, setSelectedState] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const setSelected = useCallback((taskId: string, isSelected: boolean) => {
    setSelectedState((current) => {
      const next = new Set(current);
      if (isSelected) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }, []);

  const setManySelected = useCallback(
    (taskIds: string[], isSelected: boolean) => {
      setSelectedState((current) => {
        const next = new Set(current);
        for (const id of taskIds) {
          if (isSelected) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    []
  );

  const clear = useCallback(() => setSelectedState(new Set()), []);

  const value = useMemo<TaskSelectionValue>(
    () => ({
      selectedIds: [...selected],
      count: selected.size,
      isSelected: (taskId: string) => selected.has(taskId),
      setSelected,
      setManySelected,
      clear,
    }),
    [selected, setSelected, setManySelected, clear]
  );

  return (
    <TaskSelectionContext.Provider value={value}>
      {children}
    </TaskSelectionContext.Provider>
  );
}

// ============================================================================
// Selection controls
// ============================================================================

/**
 * A selection checkbox inside a padded label.
 *
 * The label matters twice over. It lifts the hit area from the checkbox's own
 * 16px to a comfortable target, and — because `button` is a labelable element —
 * clicking anywhere in that padding activates the checkbox, with no risk of a
 * double toggle (a label does nothing for events targeted at its own labelable
 * descendant).
 */
function SelectionCheckbox({
  id,
  checked,
  onToggle,
  label,
  className,
  testId,
  taskId,
}: {
  id: string;
  checked: boolean | "indeterminate";
  onToggle: () => void;
  label: string;
  className?: string;
  testId: string;
  taskId?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center justify-center p-2"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onToggle}
        className={cn("cursor-pointer", className)}
        aria-label={label}
        data-testid={testId}
        data-task-id={taskId}
      />
    </label>
  );
}

/**
 * One selectable row: a selection gutter, then the task card itself.
 *
 * The row — not just the little box — carries the selected state. Each card
 * already renders its own checkbox to COMPLETE a task, so a bare second
 * checkbox a couple of dozen pixels away would be two identical squares on one
 * line where one ticks a box and the other finishes a piece of work. Painting
 * the whole row on select makes the two unmistakable at a glance: selection
 * lights up the row, completion strikes through the title.
 */
export function TaskSelectionRow({
  taskId,
  title,
  children,
}: {
  taskId: string;
  title: string;
  children: React.ReactNode;
}) {
  const { isSelected, setSelected } = useTaskSelection();
  const checked = isSelected(taskId);

  return (
    <div
      className={cn(
        "flex items-start gap-1 rounded-lg transition-colors",
        checked && "bg-primary/5 ring-primary/50 ring-2"
      )}
      data-testid="task-row"
      data-task-id={taskId}
      data-selected={checked ? "true" : "false"}
    >
      <div className="pt-4">
        <SelectionCheckbox
          id={`task-select-${taskId}`}
          checked={checked}
          onToggle={() => setSelected(taskId, !checked)}
          label={`Select task: ${title}`}
          testId="task-select"
          taskId={taskId}
        />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** "Select all" for one due-date group — the natural unit for a reschedule. */
export function TaskGroupSelectAll({
  taskIds,
  label,
}: {
  taskIds: string[];
  label: string;
}) {
  const { isSelected, setManySelected } = useTaskSelection();

  const selectedCount = taskIds.filter(isSelected).length;
  const allSelected = taskIds.length > 0 && selectedCount === taskIds.length;
  const checked = allSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;

  return (
    <SelectionCheckbox
      id={`task-group-select-${label.replace(/\W+/g, "-").toLowerCase()}`}
      checked={checked}
      onToggle={() => setManySelected(taskIds, !allSelected)}
      label={`Select all tasks in ${label}`}
      className="data-[state=indeterminate]:bg-primary/40 data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary"
      testId="task-group-select-all"
    />
  );
}

// ============================================================================
// Bulk action bar
// ============================================================================

function pluralizeTasks(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

const MAX_LISTED_FAILURES = 5;

/** Name the tasks that failed — a count alone leaves the user guessing. */
function describeFailures(failures: BulkTaskFailure[]): string {
  const listed = failures
    .slice(0, MAX_LISTED_FAILURES)
    .map((failure) => `${failure.title ?? failure.taskId} — ${failure.reason}`);

  const remaining = failures.length - listed.length;
  if (remaining > 0) {
    listed.push(`and ${remaining} more`);
  }

  return listed.join("\n");
}

/**
 * Report the outcome honestly: a partial failure names the tasks that did not
 * make it, rather than showing a success toast over a half-finished write.
 */
function reportOutcome(result: BulkTaskResult, verb: string) {
  const succeeded = result.succeeded.length;
  const failed = result.failed.length;

  if (failed === 0) {
    toast.success(`${verb} ${pluralizeTasks(succeeded)}`);
    return;
  }

  if (succeeded === 0) {
    toast.error(`Could not ${verb.toLowerCase()} ${pluralizeTasks(failed)}`, {
      description: describeFailures(result.failed),
    });
    return;
  }

  toast.warning(`${verb} ${pluralizeTasks(succeeded)} — ${failed} failed`, {
    description: describeFailures(result.failed),
  });
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function offsetFromToday(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

/**
 * Sticky bar shown once at least one task is selected. Renders nothing when the
 * selection is empty, so it never occupies space (or the SSR output) idly.
 */
export function BulkActionsBar() {
  const { selectedIds, count, clear } = useTaskSelection();
  const [isPending, startTransition] = useTransition();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [dueDate, setDueDate] = useState("");

  const presets = useMemo(
    () => [
      { label: "Today", value: () => offsetFromToday(0) },
      { label: "Tomorrow", value: () => offsetFromToday(1) },
      { label: "Next week", value: () => offsetFromToday(7) },
    ],
    []
  );

  if (count === 0) return null;

  // Show the cap before the click, not after. A group select-all can easily run
  // past MAX_BULK_TASKS, and letting the request go would spend a server round
  // trip only to be rejected wholesale — so the actions go disabled and the bar
  // says why while the selection is too large.
  const overLimit = count > MAX_BULK_TASKS;

  function handleComplete() {
    const ids = selectedIds;
    startTransition(async () => {
      const result = await bulkCompleteTasksAction(ids);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      reportOutcome(result.data, "Completed");
      clear();
    });
  }

  function handleReschedule() {
    const ids = selectedIds;
    const date = dueDate;

    startTransition(async () => {
      const result = await bulkRescheduleTasksAction(ids, date);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      reportOutcome(result.data, "Rescheduled");
      setRescheduleOpen(false);
      setDueDate("");
      clear();
    });
  }

  return (
    <div
      className="bg-card sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 shadow-lg"
      data-testid="bulk-actions-bar"
      data-selected-count={count}
      data-over-limit={overLimit ? "true" : "false"}
    >
      <span
        className="text-sm font-medium"
        role="status"
        aria-live="polite"
        data-testid="bulk-selection-count"
      >
        {pluralizeTasks(count)} selected
      </span>

      {overLimit && (
        <span
          className="text-destructive text-sm"
          role="status"
          aria-live="polite"
          data-testid="bulk-over-limit"
        >
          Too many — {MAX_BULK_TASKS} at a time is the maximum
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Bulk complete */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              className="cursor-pointer"
              disabled={isPending || overLimit}
              data-testid="bulk-complete-trigger"
            >
              <CheckCheck className="mr-1.5 h-4 w-4" />
              Complete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle data-testid="bulk-complete-title">
                Complete {pluralizeTasks(count)}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This marks {pluralizeTasks(count)} complete and records each one
                against your plant&rsquo;s progress. You can reopen a task
                afterwards if you need to.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="cursor-pointer">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="cursor-pointer"
                onClick={handleComplete}
                data-testid="bulk-complete-confirm"
              >
                Complete {pluralizeTasks(count)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk reschedule */}
        <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              disabled={isPending || overLimit}
              data-testid="bulk-reschedule-trigger"
            >
              <CalendarClock className="mr-1.5 h-4 w-4" />
              Reschedule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle data-testid="bulk-reschedule-title">
                Reschedule {pluralizeTasks(count)}
              </DialogTitle>
              <DialogDescription>
                Every selected task gets the same new due date.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="bulk-due-date">New due date</Label>
                <Input
                  id="bulk-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="cursor-pointer"
                  data-testid="bulk-reschedule-date"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    size="xs"
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => setDueDate(preset.value())}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => setRescheduleOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="cursor-pointer"
                disabled={!dueDate || isPending}
                onClick={handleReschedule}
                data-testid="bulk-reschedule-confirm"
              >
                Reschedule {pluralizeTasks(count)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button
          size="sm"
          variant="ghost"
          className={cn("cursor-pointer")}
          onClick={clear}
          disabled={isPending}
          data-testid="bulk-clear-selection"
        >
          <X className="mr-1.5 h-4 w-4" />
          Clear
        </Button>
      </div>
    </div>
  );
}
