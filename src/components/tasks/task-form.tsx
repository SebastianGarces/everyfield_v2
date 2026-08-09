"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  taskCategories,
  taskPriorities,
  taskStatuses,
  type Task,
} from "@/db/schema";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createTaskAction,
  updateTaskAction,
} from "@/app/(dashboard)/tasks/actions";
import {
  NO_RECURRENCE,
  parseRecurrenceRule,
  recurrenceIntervals,
  RECURRENCE_INTERVAL_LABELS,
} from "@/lib/tasks/recurrence";
import { toast } from "sonner";

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
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
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

interface TaskFormProps {
  task?: Task; // If provided, we're editing
  users?: { id: string; name: string | null; email: string }[];
}

export function TaskForm({ task, users = [] }: TaskFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isEditing = !!task;

  // The stored rule, read once for the defaults below.
  const savedRule = parseRecurrenceRule(task?.recurrenceRule);

  // UI state, not server data: it only decides whether the end-date field is
  // on screen. The values themselves are uncontrolled and travel in FormData.
  const [interval, setInterval] = useState<string>(
    task?.isRecurring && savedRule ? savedRule.interval : NO_RECURRENCE
  );
  const repeats = interval !== NO_RECURRENCE;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = isEditing
        ? await updateTaskAction(task!.id, formData)
        : await createTaskAction(formData);

      if (result.success) {
        toast.success(isEditing ? "Task updated" : "Task created");
        router.push("/tasks");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">
          Title <span className="text-red-500">*</span>
        </Label>
        <Input
          id="title"
          name="title"
          defaultValue={task?.title}
          placeholder="What needs to be done?"
          required
          disabled={isPending}
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={task?.description ?? ""}
          placeholder="Add details about this task..."
          rows={4}
          disabled={isPending}
        />
      </div>

      {/* Status and Priority row */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select name="status" defaultValue={task?.status ?? "not_started"}>
            <SelectTrigger className="cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {taskStatuses.map((s) => (
                <SelectItem key={s} value={s} className="cursor-pointer">
                  {STATUS_LABELS[s] ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <Select name="priority" defaultValue={task?.priority ?? "medium"}>
            <SelectTrigger className="cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {taskPriorities.map((p) => (
                <SelectItem key={p} value={p} className="cursor-pointer">
                  {PRIORITY_LABELS[p] ?? p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Due date and Category row */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dueDate">Due Date</Label>
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={task?.dueDate ?? ""}
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select name="category" defaultValue={task?.category ?? ""}>
            <SelectTrigger className="cursor-pointer">
              <SelectValue placeholder="Select category..." />
            </SelectTrigger>
            <SelectContent>
              {taskCategories.map((c) => (
                <SelectItem key={c} value={c} className="cursor-pointer">
                  {CATEGORY_LABELS[c] ?? c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Assignee */}
      {users.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="assignedToId">Assigned To</Label>
          <Select name="assignedToId" defaultValue={task?.assignedToId ?? ""}>
            <SelectTrigger className="cursor-pointer">
              <SelectValue placeholder="Select assignee..." />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id} className="cursor-pointer">
                  {u.name ?? u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Repeat (T-017) */}
      <div className="space-y-4 rounded-md border p-4">
        <div className="space-y-2">
          <Label htmlFor="recurrenceInterval">Repeat</Label>
          <Select
            name="recurrenceInterval"
            value={interval}
            onValueChange={setInterval}
          >
            <SelectTrigger id="recurrenceInterval" className="cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_RECURRENCE} className="cursor-pointer">
                Does not repeat
              </SelectItem>
              {recurrenceIntervals.map((value) => (
                <SelectItem
                  key={value}
                  value={value}
                  className="cursor-pointer"
                >
                  {RECURRENCE_INTERVAL_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            The next one is created when you complete this task, so a repeating
            task never piles up while you are away.
          </p>
        </div>

        {repeats && (
          <div className="space-y-2">
            <Label htmlFor="recurrenceEndDate">Repeat until</Label>
            <Input
              id="recurrenceEndDate"
              name="recurrenceEndDate"
              type="date"
              defaultValue={savedRule?.endDate ?? ""}
              disabled={isPending}
            />
            <p className="text-muted-foreground text-sm">
              Leave this empty to repeat indefinitely. Past the end date the
              task stops repeating; everything already completed stays on the
              record.
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4">
        <Button type="submit" disabled={isPending} className="cursor-pointer">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEditing ? "Save Changes" : "Create Task"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
