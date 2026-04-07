"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useTransition } from "react";
import {
  completeTaskAction,
  reopenTaskAction,
} from "@/app/(dashboard)/tasks/actions";
import { toast } from "sonner";

// ============================================================================
// Config
// ============================================================================

const PRIORITY_CONFIG: Record<
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

const CATEGORY_CONFIG: Record<string, { label: string }> = {
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

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "text-slate-500" },
  in_progress: { label: "In Progress", color: "text-blue-600" },
  blocked: { label: "Blocked", color: "text-red-600" },
  complete: { label: "Complete", color: "text-green-600" },
};

// ============================================================================
// Helpers
// ============================================================================

function getDueDateInfo(dueDate: string | null): {
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

function getRelatedUrl(
  relatedType: string | null,
  relatedId: string | null
): string | null {
  if (!relatedType || !relatedId) return null;

  switch (relatedType) {
    case "person":
      return `/people/${relatedId}`;
    case "meeting":
      return `/meetings/${relatedId}/evaluation`;
    case "team":
      return `/teams/${relatedId}`;
    default:
      return null;
  }
}

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
  const priority = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium;
  const categoryInfo = task.category ? CATEGORY_CONFIG[task.category] : null;
  const dueDateInfo = getDueDateInfo(task.dueDate);

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
    <div
      className={cn(
        "group bg-card flex items-start gap-3 rounded-lg border p-4 transition-all duration-200 hover:shadow-md",
        isComplete && "opacity-60",
        isPending && "opacity-50"
      )}
    >
      {/* Checkbox */}
      <div className="pt-0.5">
        <Checkbox
          checked={isComplete}
          onCheckedChange={handleToggleComplete}
          disabled={isPending}
          className="cursor-pointer"
          aria-label={isComplete ? "Reopen task" : "Complete task"}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/tasks/${task.id}`}
            className={cn(
              "cursor-pointer text-sm leading-snug font-medium hover:underline",
              isComplete && "line-through"
            )}
          >
            {task.title}
          </Link>

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
