"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { quickAddTaskAction } from "@/app/(dashboard)/tasks/actions";
import { toast } from "sonner";

export function TaskQuickAdd() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await quickAddTaskAction(formData);
      if (result.success) {
        toast.success("Task created");
        formRef.current?.reset();
        titleRef.current?.focus();
      } else {
        toast.error(result.error);
      }
    });
  }

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
    <form
      ref={formRef}
      action={handleSubmit}
      className="bg-card flex items-center gap-2 rounded-lg border p-3"
    >
      <Input
        ref={titleRef}
        name="title"
        placeholder="Task title..."
        className="h-8 flex-1 text-sm"
        autoFocus
        required
        disabled={isPending}
      />
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
        onClick={() => setIsOpen(false)}
        disabled={isPending}
      >
        Cancel
      </Button>
    </form>
  );
}
