"use client";

import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { Filter, X } from "lucide-react";
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
  currentView: "all" | "my_tasks";
  showCompleted: boolean;
}

export function TaskFilters({ currentView, showCompleted }: TaskFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === "" || value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      // Reset cursor on filter change
      params.delete("cursor");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const currentStatus = searchParams.get("status") ?? "";
  const currentPriority = searchParams.get("priority") ?? "";
  const currentCategory = searchParams.get("category") ?? "";
  const hasFilters = currentStatus || currentPriority || currentCategory;

  function clearFilters() {
    const params = new URLSearchParams();
    const view = searchParams.get("view");
    if (view) params.set("view", view);
    const completed = searchParams.get("completed");
    if (completed) params.set("completed", completed);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* View toggle */}
      <div className="flex items-center rounded-md border">
        <button
          className={cn(
            "cursor-pointer px-3 py-1.5 text-xs font-medium transition-colors",
            currentView === "my_tasks"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted"
          )}
          onClick={() => updateParam("view", "my_tasks")}
        >
          My Tasks
        </button>
        <button
          className={cn(
            "cursor-pointer px-3 py-1.5 text-xs font-medium transition-colors",
            currentView === "all"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted"
          )}
          onClick={() => updateParam("view", "all")}
        >
          All Tasks
        </button>
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
        <SelectTrigger className="h-8 w-[130px] cursor-pointer text-xs">
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
        <SelectTrigger className="h-8 w-[120px] cursor-pointer text-xs">
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
        <SelectTrigger className="h-8 w-[140px] cursor-pointer text-xs">
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
