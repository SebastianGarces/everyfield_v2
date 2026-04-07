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
import { useTransition } from "react";
import {
  createTaskAction,
  updateTaskAction,
} from "@/app/(dashboard)/tasks/actions";
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
