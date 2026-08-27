"use client";

import { useCan } from "@/components/shared/viewer-capabilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { type RefObject, useRef, useState, useTransition } from "react";
import { quickAddTaskAction } from "@/app/(dashboard)/tasks/actions";
import { toast } from "sonner";

type QuickAddResult = { success: true } | { success: false; error: string };

type QuickAddSubmit = (formData: FormData) => Promise<QuickAddResult>;

export async function submitQuickAddTask(
  formData: FormData,
  submit: QuickAddSubmit,
  {
    onSuccess,
    onError,
  }: {
    onSuccess: () => void;
    onError: (error: string) => void;
  }
) {
  const result = await submit(formData);
  if (result.success) {
    onSuccess();
  } else {
    onError(result.error);
  }
}

export function resetQuickAddForm(
  form: HTMLFormElement | null,
  title: HTMLInputElement | null
) {
  form?.reset();
  title?.focus();
}

export function TaskQuickAddForm({
  formRef,
  titleRef,
  isPending,
  onSubmit,
  onCancel,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  titleRef: RefObject<HTMLInputElement | null>;
  isPending: boolean;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
}) {
  return (
    <form
      ref={formRef}
      action={onSubmit}
      className="bg-card flex flex-wrap items-center gap-2 rounded-lg border p-3"
    >
      <Input
        ref={titleRef}
        name="title"
        placeholder="Task title..."
        className="h-8 w-full text-sm sm:w-auto sm:flex-1"
        autoFocus
        required
        disabled={isPending}
      />
      <div className="flex gap-2">
        <Input
          name="dueDate"
          type="date"
          className="h-8 w-[140px] text-sm"
          disabled={isPending}
        />
        <Select name="priority" defaultValue="medium">
          <SelectTrigger className="h-8 w-[110px] cursor-pointer text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low" className="cursor-pointer">
              Low
            </SelectItem>
            <SelectItem value="medium" className="cursor-pointer">
              Medium
            </SelectItem>
            <SelectItem value="high" className="cursor-pointer">
              High
            </SelectItem>
            <SelectItem value="urgent" className="cursor-pointer">
              Urgent
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          className="h-8 cursor-pointer"
          disabled={isPending}
        >
          {isPending ? "Adding..." : "Add"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 cursor-pointer"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function TaskQuickAdd() {
  // `quickAddTaskAction` is `tasks.write` (AS-020). Asked here, in the file that
  // renders the control, so the affordance and the refusal can never disagree —
  // and so a second mount of this component inherits the gate rather than
  // needing its own.
  const canWrite = useCan("tasks.write");
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await submitQuickAddTask(formData, quickAddTaskAction, {
        onSuccess: () => {
          toast.success("Task created");
          resetQuickAddForm(formRef.current, titleRef.current);
        },
        onError: toast.error,
      });
    });
  }

  if (!canWrite) return null;

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer gap-1"
        onClick={() => setIsOpen(true)}
      >
        <Plus className="h-4 w-4" />
        Quick Add
      </Button>
    );
  }

  return (
    <TaskQuickAddForm
      formRef={formRef}
      titleRef={titleRef}
      isPending={isPending}
      onSubmit={handleSubmit}
      onCancel={() => setIsOpen(false)}
    />
  );
}
