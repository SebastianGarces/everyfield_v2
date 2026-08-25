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
import { useCan } from "@/components/shared/viewer-capabilities";
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
  /** The viewer's own `users.id`. Identity, not authority — see
   *  `TaskCardProps.currentUserId`. */
  currentUserId: string;
}

export function TaskDetailActions({
  task,
  currentUserId,
}: TaskDetailActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // TWO DIFFERENT VERBS ON ONE ROW OF BUTTONS (AS-020).
  //
  // Deleting is `tasks.write` — an Admin's, and nobody else's. Completing and
  // reopening are `tasks.own`, which a Member HOLDS: the subject half is
  // `assertMayActOnTask`, so the person this task is assigned to keeps the
  // button that finishes their own work. Gating the pair together on the seat
  // would hide a Member's own task from them, which is the over-hide.
  const canWrite = useCan("tasks.write");
  const canComplete = canWrite || task.assignedToId === currentUserId;

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
    <div className="flex max-w-full flex-wrap items-center gap-2 md:justify-end">
      {canComplete &&
        (isComplete ? (
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
        ))}

      {canWrite && (
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
                variant="destructive"
                className="cursor-pointer"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
