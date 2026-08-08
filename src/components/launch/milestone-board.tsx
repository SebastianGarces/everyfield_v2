"use client";

// ============================================================================
// Launch readiness — the Playbook milestones and their tasks (LS-003).
//
// THE HYBRID MODEL, on screen (ruled 2026-08-04):
//   * the milestone set is seeded, fixed, and grouped by the Playbook's three
//     priority areas;
//   * ticking a linked task moves its milestone's progress — that is the
//     ordinary task system, reached through `setLaunchTaskCompleteAction`;
//   * a milestone with NO OPEN TASKS can be closed by hand. The button follows
//     that rule and the SQL enforces it, because a teammate can reopen the last
//     task between this render and the write.
//
// SERVER DATA ARRIVES AS PROPS AND STAYS THERE. The only local state is
// `useOptimistic`'s guess, reconciled by the action's `refresh()` — no
// `useState` copy of the milestones, no `useEffect` syncing them
// (memory/contracts/data-patterns.md).
// ============================================================================

import { Check, CircleCheck, Loader2, RotateCcw } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import {
  completeMilestoneAction,
  reopenMilestoneAction,
  setLaunchTaskCompleteAction,
} from "@/app/(dashboard)/launch/actions";
import {
  applyReadinessChange,
  canCompleteMilestone,
  completeMilestoneBlockedReason,
  progressPercent,
} from "@/components/launch/presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  LAUNCH_MILESTONE_AREA_LABELS,
  LAUNCH_MILESTONE_AREA_ORDER,
} from "@/lib/launch/milestone-areas";
// Type-only, and load-bearing: importing these shapes from `milestones.ts`
// costs nothing at runtime, while importing a VALUE from it would pull `@/db`
// into this client bundle.
import type {
  LaunchMilestoneView,
  LaunchReadiness,
} from "@/lib/launch/milestones";
import { cn } from "@/lib/utils";

export interface MilestoneBoardProps {
  readiness: LaunchReadiness;
  /**
   * Whether this viewer may tick anything. LS-007: milestone and task
   * completion follow normal TASK rules, so this is true for the plant's team
   * as well as its planter — unlike scheduling, which is the planter's alone.
   */
  canEdit: boolean;
}

export function MilestoneBoard({ readiness, canEdit }: MilestoneBoardProps) {
  const [optimistic, applyChange] = useOptimistic(
    readiness,
    applyReadinessChange
  );
  const [isPending, startTransition] = useTransition();

  function toggleTask(taskId: string, complete: boolean) {
    startTransition(async () => {
      applyChange({ kind: "task", taskId, complete });
      const result = await setLaunchTaskCompleteAction(taskId, complete);
      if (!result.success) toast.error(result.error);
    });
  }

  function toggleMilestone(milestone: LaunchMilestoneView) {
    const complete = !milestone.isComplete;
    startTransition(async () => {
      applyChange({ kind: "milestone", milestoneId: milestone.id, complete });
      const result = complete
        ? await completeMilestoneAction(milestone.id)
        : await reopenMilestoneAction(milestone.id);
      if (!result.success) toast.error(result.error);
    });
  }

  const percent = progressPercent(
    optimistic.completedCount,
    optimistic.totalCount
  );

  return (
    <section className="space-y-4" aria-labelledby="launch-readiness-heading">
      <div className="bg-card rounded-xl border p-6 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="launch-readiness-heading"
            className="text-xl font-semibold tracking-tight"
          >
            Readiness
          </h2>
          {/* ONE string, built in JS, rather than five JSX children. The
              spaces around "milestones" are content, and JSX text nodes that
              sit between expression containers and wrap across lines are at
              the mercy of the compiler's whitespace trimming — which is how
              this shipped reading "0 of 9milestones". A template literal has
              no whitespace rules to lose. */}
          <p className="text-muted-foreground text-sm">
            {`${optimistic.completedCount} of ${optimistic.totalCount} milestones · ${optimistic.openTaskCount} tasks open`}
          </p>
        </div>
        <Progress
          value={percent}
          className="mt-4"
          aria-label={`Launch readiness: ${percent}% of milestones complete`}
        />
      </div>

      {LAUNCH_MILESTONE_AREA_ORDER.map((area) => {
        const milestones = optimistic.milestones.filter(
          (milestone) => milestone.area === area
        );
        if (milestones.length === 0) return null;

        return (
          <div key={area} className="bg-card rounded-xl border shadow-sm">
            <h3 className="border-b px-6 py-4 text-sm font-semibold tracking-wide uppercase">
              {LAUNCH_MILESTONE_AREA_LABELS[area]}
            </h3>
            <ul className="divide-y">
              {milestones.map((milestone) => (
                <MilestoneRow
                  key={milestone.id}
                  milestone={milestone}
                  canEdit={canEdit}
                  isPending={isPending}
                  onToggleTask={toggleTask}
                  onToggleMilestone={toggleMilestone}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function MilestoneRow({
  milestone,
  canEdit,
  isPending,
  onToggleTask,
  onToggleMilestone,
}: {
  milestone: LaunchMilestoneView;
  canEdit: boolean;
  isPending: boolean;
  onToggleTask: (taskId: string, complete: boolean) => void;
  onToggleMilestone: (milestone: LaunchMilestoneView) => void;
}) {
  const totalTasks = milestone.tasks.length;
  const blockedReason = completeMilestoneBlockedReason(milestone);
  const completable = canCompleteMilestone(milestone);

  return (
    <li className="px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {milestone.isComplete && (
              <CircleCheck
                className="h-4 w-4 shrink-0 text-green-600 dark:text-green-500"
                aria-hidden="true"
              />
            )}
            <h4
              className={cn(
                "font-medium",
                milestone.isComplete && "text-muted-foreground"
              )}
            >
              {milestone.title}
            </h4>
          </div>
          {milestone.description && (
            <p className="text-muted-foreground mt-1 text-sm">
              {milestone.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {totalTasks > 0 && (
            <Badge variant="outline">
              {milestone.completedTaskCount}/{totalTasks} tasks
            </Badge>
          )}
          {canEdit &&
            (milestone.isComplete ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="cursor-pointer"
                disabled={isPending}
                onClick={() => onToggleMilestone(milestone)}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Reopen
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cursor-pointer"
                disabled={isPending || !completable}
                // The reason is on the control itself, so a disabled button is
                // never a dead end: "3 tasks still open" answers "why can't I
                // press this" without a tooltip the keyboard cannot reach.
                title={blockedReason ?? undefined}
                onClick={() => onToggleMilestone(milestone)}
              >
                {isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                )}
                Mark complete
              </Button>
            ))}
        </div>
      </div>

      {blockedReason && !milestone.isComplete && (
        <p className="text-muted-foreground mt-2 text-xs">{blockedReason}</p>
      )}

      {totalTasks > 0 && (
        <ul className="mt-3 space-y-2">
          {milestone.tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-2.5">
              <Checkbox
                id={`launch-task-${task.id}`}
                checked={task.isComplete}
                disabled={!canEdit || isPending}
                className="mt-0.5 cursor-pointer"
                onCheckedChange={(checked) =>
                  onToggleTask(task.id, checked === true)
                }
              />
              <label
                htmlFor={`launch-task-${task.id}`}
                className={cn(
                  "cursor-pointer text-sm leading-5",
                  task.isComplete && "text-muted-foreground line-through"
                )}
              >
                {task.title}
                {task.assigneeName && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    {task.assigneeName}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
