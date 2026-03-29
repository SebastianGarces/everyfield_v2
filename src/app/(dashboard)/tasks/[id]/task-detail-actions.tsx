"use client";

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
import type { Task } from "@/db/schema";
import { Check, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  completeTaskAction,
  deleteTaskAction,
  reopenTaskAction,
} from "@/app/(dashboard)/tasks/actions";
import { toast } from "sonner";

interface TaskDetailActionsProps {
  task: Task;
}

export function TaskDetailActions({ task }: TaskDetailActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isComplete = task.status === "complete";

  function handleComplete() {
    startTransition(async () => {
      const result = await completeTaskAction(task.id);
      if (result.success) {
        toast.success("Task completed");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleReopen() {
    startTransition(async () => {
      const result = await reopenTaskAction(task.id);
      if (result.success) {
        toast.success("Task reopened");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteTaskAction(task.id);
      if (result.success) {
        toast.success("Task deleted");
        router.push("/tasks");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {isComplete ? (
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer gap-1"
          onClick={handleReopen}
          disabled={isPending}
        >
          <RotateCcw className="h-4 w-4" />
          Reopen
        </Button>
      ) : (
        <Button
          variant="default"
          size="sm"
          className="cursor-pointer gap-1"
          onClick={handleComplete}
          disabled={isPending}
        >
          <Check className="h-4 w-4" />
          Complete
        </Button>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer gap-1 text-red-600 hover:text-red-700"
            disabled={isPending}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{task.title}&rdquo;? This
              action can be undone by an administrator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="cursor-pointer bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
