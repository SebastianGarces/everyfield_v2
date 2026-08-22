"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { taskCategories, taskPriorities, taskStatuses } from "@/db/schema";
import {
  TASK_LIST_VIEWS,
  taskListParamsCleared,
  taskListParamsWith,
  type TaskListParamKey,
  type TaskListView,
} from "@/lib/tasks/list-params";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

// ============================================================================
// Config
// ============================================================================

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  blocked: "Blocked",
  complete: "Complete",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * What each view is called. A TOTAL map, so a view added to the contract
 * without a name here is a compile error rather than a blank tab.
 *
 * #470 AC-3 on the third one: it answers a different question from the other
 * two — not "which tasks" but "who is on them" — so it sits in the same toggle
 * rather than behind a link. The planter deciding what to work on and the
 * planter deciding who should work on it are one moment.
 */
const VIEW_LABELS: Record<TaskListView, string> = {
  my_tasks: "My Tasks",
  all: "All Tasks",
  assignments: "Assignments",
};

const CATEGORY_LABELS: Record<string, string> = {
  vision_meeting: "Vision Meeting",
  follow_up: "Follow-up",
  training: "Training",
  facilities: "Facilities",
  promotion: "Promotion",
  administrative: "Administrative",
  ministry_team: "Ministry Team",
  launch_prep: "Launch Prep",
  recurring: "Recurring",
  general: "General",
};

// ============================================================================
// Component
// ============================================================================

interface TaskFiltersProps {
  currentView: TaskListView;
  showCompleted: boolean;
}

export function TaskFilters({ currentView, showCompleted }: TaskFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Both writers live with the parser that reads them back (#660). The key is
  // TYPED, so a misspelling is a compile error rather than a parameter the page
  // silently ignores. Each select below still maps its own "All" OPTION to
  // `null`, which is where that sentinel belongs.
  const updateParam = useCallback(
    (key: TaskListParamKey, value: string | null) => {
      const params = taskListParamsWith(searchParams.toString(), key, value);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const currentStatus = searchParams.get("status") ?? "";
  const currentPriority = searchParams.get("priority") ?? "";
  const currentCategory = searchParams.get("category") ?? "";
  const hasFilters = currentStatus || currentPriority || currentCategory;

  function clearFilters() {
    // Which params are a VIEW of the list and which are a FILTER on it is one
    // fact, and it lives with the parser — a private copy here is how the next
    // param added would vanish on Clear with nothing failing.
    const params = taskListParamsCleared(searchParams.toString());
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* THE TOGGLE IS RENDERED FROM THE VIEW LIST, not written out three
          times (#660). A button whose value the parser does not accept is the
          bug this file just had, so the buttons ARE the list: a fourth view
          cannot be offered without being readable, and a view cannot be added
          to the contract without appearing here. */}
      <div className="flex items-center rounded-md border">
        {TASK_LIST_VIEWS.map((view) => (
          <button
            key={view}
            className={cn(
              "cursor-pointer px-3 py-1.5 text-xs font-medium transition-colors",
              currentView === view
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            )}
            onClick={() => updateParam("view", view)}
          >
            {VIEW_LABELS[view]}
          </button>
        ))}
      </div>

      {/* Show completed toggle */}
      <button
        className={cn(
          "cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
          showCompleted
            ? "bg-primary text-primary-foreground"
            : "hover:bg-muted"
        )}
        onClick={() => updateParam("completed", showCompleted ? null : "true")}
      >
        Show Completed
      </button>

      <div className="text-border mx-1">|</div>

      {/* Status filter */}
      <Select
        value={currentStatus || "all"}
        onValueChange={(v) => updateParam("status", v === "all" ? null : v)}
      >
        <SelectTrigger
          aria-label="Filter by status"
          className="h-8 w-[130px] cursor-pointer text-xs"
        >
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="cursor-pointer">
            All Statuses
          </SelectItem>
          {taskStatuses
            .filter((s) => s !== "complete")
            .map((s) => (
              <SelectItem key={s} value={s} className="cursor-pointer">
                {STATUS_LABELS[s] ?? s}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      {/* Priority filter */}
      <Select
        value={currentPriority || "all"}
        onValueChange={(v) => updateParam("priority", v === "all" ? null : v)}
      >
        <SelectTrigger
          aria-label="Filter by priority"
          className="h-8 w-[120px] cursor-pointer text-xs"
        >
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="cursor-pointer">
            All Priorities
          </SelectItem>
          {taskPriorities.map((p) => (
            <SelectItem key={p} value={p} className="cursor-pointer">
              {PRIORITY_LABELS[p] ?? p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Category filter */}
      <Select
        value={currentCategory || "all"}
        onValueChange={(v) => updateParam("category", v === "all" ? null : v)}
      >
        <SelectTrigger
          aria-label="Filter by category"
          className="h-8 w-[140px] cursor-pointer text-xs"
        >
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="cursor-pointer">
            All Categories
          </SelectItem>
          {taskCategories.map((c) => (
            <SelectItem key={c} value={c} className="cursor-pointer">
              {CATEGORY_LABELS[c] ?? c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Clear filters */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="h-8 cursor-pointer gap-1 text-xs"
        >
          <X className="h-3 w-3" />
          Clear
        </Button>
      )}
    </div>
  );
}
