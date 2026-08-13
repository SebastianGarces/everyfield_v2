// ============================================================================
// TaskCardView — the task card's markup, with nothing that has to run.
//
// Every pixel of a task row lives here: the layout, the priority badge, the
// due-date/category/status/assignee metadata line and the follow-up note. What
// does NOT live here is anything that needs a browser — no "use client", no
// state, no server actions, no event handlers. The one interactive control on
// the card (the complete/reopen checkbox) arrives as a slot, so the caller
// decides whether it is wired to a mutation or is just a picture of one.
//
// Why the split exists: the marketing page wants to show the real product, not
// a re-drawing of it (see app/(marketing)/_components/vignettes/ and the
// archetype at components/phase-engine/csf-scorecard.tsx). A component that
// imports `@/app/(dashboard)/tasks/actions` cannot be rendered from a fixture
// on a public page — it drags a server action, `useTransition` and `sonner`
// along with it. This file can: hand it a `TaskWithAssignee` shaped object and
// it renders, on the server, with no client bundle at all.
//
// The contract that makes that worth anything: this is the ONLY definition of
// what a task row looks like. `task-card.tsx` renders this and adds the
// behaviour; it owns no markup of its own. If the app's card changes, the
// landing page's card changes with it, because they are the same card.
// ============================================================================

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { WithDescriptionPreview } from "@/lib/tasks/descriptions";
import type { TaskWithAssignee } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Calendar,
  CircleDot,
  Clock,
  Flag,
  MessageSquare,
  User,
} from "lucide-react";
import Link from "next/link";

// ============================================================================
// Config
// ============================================================================

export const PRIORITY_CONFIG: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  urgent: {
    label: "Urgent",
    color: "text-red-600 bg-red-50 border-red-200",
    icon: "!",
  },
  high: {
    label: "High",
    color: "text-orange-600 bg-orange-50 border-orange-200",
    icon: "!",
  },
  medium: {
    label: "Medium",
    color: "text-blue-600 bg-blue-50 border-blue-200",
    icon: "",
  },
  low: {
    label: "Low",
    color: "text-slate-500 bg-slate-50 border-slate-200",
    icon: "",
  },
};

export const CATEGORY_CONFIG: Record<string, { label: string }> = {
  vision_meeting: { label: "Vision Meeting" },
  follow_up: { label: "Follow-up" },
  training: { label: "Training" },
  facilities: { label: "Facilities" },
  promotion: { label: "Promotion" },
  administrative: { label: "Administrative" },
  ministry_team: { label: "Ministry Team" },
  launch_prep: { label: "Launch Prep" },
  recurring: { label: "Recurring" },
  general: { label: "General" },
};

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "text-slate-500" },
  in_progress: { label: "In Progress", color: "text-blue-600" },
  blocked: { label: "Blocked", color: "text-red-600" },
  complete: { label: "Complete", color: "text-green-600" },
};

// ============================================================================
// Helpers
// ============================================================================

export function getDueDateInfo(dueDate: string | null): {
  label: string;
  isOverdue: boolean;
  isDueToday: boolean;
  isDueSoon: boolean;
} {
  if (!dueDate)
    return {
      label: "No due date",
      isOverdue: false,
      isDueToday: false,
      isDueSoon: false,
    };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diffDays = Math.floor(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return {
      label: absDays === 1 ? "1 day overdue" : `${absDays} days overdue`,
      isOverdue: true,
      isDueToday: false,
      isDueSoon: false,
    };
  }
  if (diffDays === 0)
    return {
      label: "Due today",
      isOverdue: false,
      isDueToday: true,
      isDueSoon: false,
    };
  if (diffDays === 1)
    return {
      label: "Due tomorrow",
      isOverdue: false,
      isDueToday: false,
      isDueSoon: true,
    };
  if (diffDays <= 7)
    return {
      label: `Due in ${diffDays} days`,
      isOverdue: false,
      isDueToday: false,
      isDueSoon: true,
    };

  // Format the date
  const formatted = due.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return {
    label: `Due ${formatted}`,
    isOverdue: false,
    isDueToday: false,
    isDueSoon: false,
  };
}

// ============================================================================
// Component
// ============================================================================

interface TaskCardViewProps {
  /**
   * The row. From a LIST query it is a `TaskListRow` and carries
   * `descriptionPreview` — the readable text of the description, flattened by
   * the service (T-021). A plain `TaskWithAssignee` (the marketing fixtures)
   * carries none, and the summary line below simply does not render.
   */
  task: WithDescriptionPreview<TaskWithAssignee>;
  personNote?: string | null;
  /**
   * The complete/reopen control, rendered into the card's leading gutter.
   *
   * A slot rather than a prop pair, because the checkbox is the one thing on
   * this card that cannot be described by data: in the app it is a controlled
   * `Checkbox` bound to a server action, on a landing page it is a still frame
   * of the same control (or nothing at all). Passing the element itself keeps
   * both of those out of this file — the view never learns that toggling a
   * task is a thing that can happen.
   *
   * Callers that render this on the server must pass an element with no
   * function props; that is a constraint on what they pass, not on this file.
   */
  checkboxSlot?: ReactNode;
  /**
   * Dim the row while its mutation is in flight. Purely a display state — the
   * caller owns the pending transition.
   */
  isPending?: boolean;
  /** Render the title as inert markup instead of a link — for presentational
   *  embeds (the marketing page), where nothing may be clickable, focusable or
   *  prefetchable. Absent, as in the app, this row is unchanged. */
  linkStatic?: boolean;
}

/**
 * `data-slot="task-card"` and `data-status` are stable, zero-visual hooks, in
 * the same spirit as shadcn's `data-slot`s and the CSF tile's `data-standing`
 * (components/phase-engine/csf-scorecard.tsx): they name the row and its
 * standing for anything styling or animating this card from outside — the
 * marketing embeds — without adding a class the card would then have to keep.
 * Neither attribute changes what this renders.
 */
export function TaskCardView({
  task,
  personNote,
  checkboxSlot,
  isPending = false,
  linkStatic,
}: TaskCardViewProps) {
  const isComplete = task.status === "complete";
  const priority = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium;
  const categoryInfo = task.category ? CATEGORY_CONFIG[task.category] : null;
  const dueDateInfo = getDueDateInfo(task.dueDate);
  // A span carrying the identical className, not an href-less anchor: a
  // presentational embed should carry no app URL at all, so there is nothing
  // left to prefetch by construction.
  const titleClass = cn(
    "cursor-pointer text-sm leading-snug font-medium hover:underline",
    isComplete && "line-through"
  );

  return (
    <div
      data-slot="task-card"
      data-status={task.status}
      className={cn(
        "group bg-card flex items-start gap-3 rounded-lg border p-4 transition-all duration-200 hover:shadow-md",
        isComplete && "opacity-60",
        isPending && "opacity-50"
      )}
    >
      {/* Checkbox */}
      <div className="pt-0.5">{checkboxSlot}</div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          {linkStatic ? (
            <span className={titleClass}>{task.title}</span>
          ) : (
            <Link href={`/tasks/${task.id}`} className={titleClass}>
              {task.title}
            </Link>
          )}

          {/* Priority indicator */}
          {task.priority !== "medium" && (
            <Badge
              variant="outline"
              className={cn("shrink-0 text-xs", priority.color)}
            >
              {task.priority === "urgent" || task.priority === "high" ? (
                <Flag className="mr-1 h-3 w-3" />
              ) : null}
              {priority.label}
            </Badge>
          )}
        </div>

        {/*
          Description summary (T-021).

          `descriptionPreview` is READABLE TEXT, never markup: a description is
          stored as HTML, and this card renders every field it is given as
          text, so the raw value would print `<strong>` at the planter. The
          service flattens it; the clamp is the card's own decision, because how
          much fits is a question only the card can answer.
        */}
        {task.descriptionPreview && (
          <p
            data-slot="task-card-description"
            className="text-muted-foreground line-clamp-2 text-xs"
          >
            {task.descriptionPreview}
          </p>
        )}

        {/* Metadata row */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {/* Due date */}
          {task.dueDate && (
            <span
              className={cn(
                "flex items-center gap-1",
                !isComplete &&
                  dueDateInfo.isOverdue &&
                  "font-medium text-red-600",
                !isComplete &&
                  dueDateInfo.isDueToday &&
                  "font-medium text-orange-600",
                !isComplete && dueDateInfo.isDueSoon && "text-amber-600"
              )}
            >
              {dueDateInfo.isOverdue ? (
                <AlertCircle className="h-3 w-3" />
              ) : (
                <Calendar className="h-3 w-3" />
              )}
              {dueDateInfo.label}
            </span>
          )}

          {/* Category */}
          {categoryInfo && (
            <span className="flex items-center gap-1">
              <CircleDot className="h-3 w-3" />
              {categoryInfo.label}
            </span>
          )}

          {/* Status (if not default) */}
          {task.status !== "not_started" && task.status !== "complete" && (
            <span
              className={cn(
                "flex items-center gap-1",
                STATUS_CONFIG[task.status]?.color
              )}
            >
              <Clock className="h-3 w-3" />
              {STATUS_CONFIG[task.status]?.label}
            </span>
          )}

          {/* Assignee */}
          {task.assigneeName && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {task.assigneeName}
            </span>
          )}
        </div>

        {/* Person note for follow-up tasks */}
        {personNote && task.relatedType === "person" && (
          <div className="bg-muted/50 mt-1.5 rounded-md px-2.5 py-1.5">
            <p className="text-muted-foreground line-clamp-2 text-xs italic">
              <MessageSquare className="mr-1 inline h-3 w-3 -translate-y-px" />
              {personNote}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
