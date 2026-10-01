"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  taskCategories,
  taskPriorities,
  taskStatuses,
  type TaskCategory,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema";
import {
  TASK_LIST_VIEWS,
  TASK_SORT_LABELS,
  hasTaskFilters,
  parseTaskListQuery,
  taskListParamsCleared,
  taskListParamsWith,
  type TaskListParamKey,
  type TaskListView,
} from "@/lib/tasks/list-params";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTaskFilterNavigation } from "./use-task-filter-navigation";

// ============================================================================
// Config
// ============================================================================

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  blocked: "Blocked",
  complete: "Complete",
  no_longer_needed: "No longer needed",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
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

const CATEGORY_LABELS: Record<TaskCategory, string> = {
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

export function TaskFilters({
  teams = [],
}: {
  teams?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { query, navigate } = useTaskFilterNavigation(
    searchParams.toString(),
    (destination) => {
      router.push(destination ? `${pathname}?${destination}` : pathname);
    }
  );
  const selected = parseTaskListQuery(query);
  const currentStatus = selected.status ?? [];
  const currentPriority = selected.priority ?? [];
  const currentCategory = selected.category ?? [];
  const hasFilters = hasTaskFilters(selected);
  const updateParam = (key: TaskListParamKey, value: string | null) =>
    navigate((current) => taskListParamsWith(current, key, value).toString());
  const clearFilters = () =>
    navigate((current) => taskListParamsCleared(current).toString());

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
              selected.view === view
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            )}
            aria-pressed={selected.view === view}
            onClick={() => updateParam("view", view)}
          >
            {VIEW_LABELS[view]}
          </button>
        ))}
      </div>

      {/* Assignments contains open follow-ups only. */}
      {selected.view !== "assignments" && (
        <button
          aria-pressed={selected.showCompleted}
          className={cn(
            "cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
            selected.showCompleted
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted"
          )}
          onClick={() =>
            updateParam("completed", selected.showCompleted ? null : "true")
          }
        >
          Show closed tasks
        </button>
      )}

      <div className="text-border mx-1">|</div>

      {selected.view !== "assignments" && (
        <Select
          value={selected.teamId ?? "all"}
          onValueChange={(v) => updateParam("teamId", v === "all" ? null : v)}
        >
          <SelectTrigger
            aria-label="Filter by team"
            className="h-8 w-[160px] cursor-pointer text-xs"
          >
            <SelectValue placeholder="Team" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="cursor-pointer">
              All Teams
            </SelectItem>
            {selected.teamId &&
              !teams.some((team) => team.id === selected.teamId) && (
                <SelectItem value={selected.teamId} disabled>
                  Unavailable team
                </SelectItem>
              )}
            {teams.map((team) => (
              <SelectItem
                key={team.id}
                value={team.id}
                className="cursor-pointer"
              >
                {team.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {/* Status filter */}
      <Select
        value={
          currentStatus.length > 1 ? "multiple" : (currentStatus[0] ?? "all")
        }
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
          {currentStatus.length > 1 && (
            <SelectItem value="multiple" disabled>
              {currentStatus.map((value) => STATUS_LABELS[value]).join(", ")}
            </SelectItem>
          )}
          {taskStatuses.map((s) => (
            <SelectItem key={s} value={s} className="cursor-pointer">
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Priority filter */}
      <Select
        value={
          currentPriority.length > 1
            ? "multiple"
            : (currentPriority[0] ?? "all")
        }
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
          {currentPriority.length > 1 && (
            <SelectItem value="multiple" disabled>
              {currentPriority
                .map((value) => PRIORITY_LABELS[value])
                .join(", ")}
            </SelectItem>
          )}
          {taskPriorities.map((p) => (
            <SelectItem key={p} value={p} className="cursor-pointer">
              {PRIORITY_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Category filter */}
      <Select
        value={
          currentCategory.length > 1
            ? "multiple"
            : (currentCategory[0] ?? "all")
        }
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
          {currentCategory.length > 1 && (
            <SelectItem value="multiple" disabled>
              {currentCategory
                .map((value) => CATEGORY_LABELS[value])
                .join(", ")}
            </SelectItem>
          )}
          {taskCategories.map((c) => (
            <SelectItem key={c} value={c} className="cursor-pointer">
              {CATEGORY_LABELS[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="task-due-from" className="text-xs">
          Due from
        </Label>
        <Input
          id="task-due-from"
          type="date"
          className="h-8 w-[150px] text-xs"
          value={selected.dueDateFrom ?? ""}
          onChange={(event) =>
            updateParam("dueDateFrom", event.target.value || null)
          }
          aria-invalid={selected.invalidDateRange}
          aria-describedby={
            selected.invalidDateRange ? "task-date-error" : undefined
          }
        />
        <Label htmlFor="task-due-to" className="text-xs">
          Due through
        </Label>
        <Input
          id="task-due-to"
          type="date"
          className="h-8 w-[150px] text-xs"
          value={selected.dueDateTo ?? ""}
          onChange={(event) =>
            updateParam("dueDateTo", event.target.value || null)
          }
          aria-invalid={selected.invalidDateRange}
          aria-describedby={
            selected.invalidDateRange ? "task-date-error" : undefined
          }
        />
      </div>
      {selected.invalidDateRange && (
        <p
          id="task-date-error"
          role="alert"
          className="text-destructive w-full text-sm"
        >
          The end date must be on or after the start date.
        </p>
      )}
      {selected.view !== "assignments" && (
        <>
          <Select
            value={selected.sortBy}
            onValueChange={(value) => updateParam("sortBy", value)}
          >
            <SelectTrigger
              aria-label="Sort tasks by"
              className="h-8 w-[130px] cursor-pointer text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TASK_SORT_LABELS).map(([value, label]) => (
                <SelectItem
                  key={value}
                  value={value}
                  className="cursor-pointer"
                >
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={selected.sortDir}
            onValueChange={(value) => updateParam("sortDir", value)}
          >
            <SelectTrigger
              aria-label="Sort direction"
              className="h-8 w-[130px] cursor-pointer text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc" className="cursor-pointer">
                {selected.sortBy === "priority"
                  ? "Urgent first"
                  : selected.sortBy === "due_date"
                    ? "Earliest first"
                    : selected.sortBy === "created_at"
                      ? "Oldest first"
                      : "A to Z"}
              </SelectItem>
              <SelectItem value="desc" className="cursor-pointer">
                {selected.sortBy === "priority"
                  ? "Low first"
                  : selected.sortBy === "due_date"
                    ? "Latest first"
                    : selected.sortBy === "created_at"
                      ? "Newest first"
                      : "Z to A"}
              </SelectItem>
            </SelectContent>
          </Select>
        </>
      )}
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
