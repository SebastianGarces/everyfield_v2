"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { feedbackStatuses, type FeedbackStatus } from "@/db/schema";
import { updateFeedbackStatusAction } from "@/app/(dashboard)/admin/feedback/actions";

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export function FeedbackStatusSelect({
  id,
  status,
}: {
  id: string;
  status: FeedbackStatus;
}) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (next: string) => {
    if (next === status) return;

    const formData = new FormData();
    formData.set("id", id);
    formData.set("status", next);

    startTransition(async () => {
      const result = await updateFeedbackStatusAction(formData);
      if (result.success) {
        toast.success("Status updated");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Select value={status} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="w-40 cursor-pointer" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {feedbackStatuses.map((value) => (
          <SelectItem key={value} value={value} className="cursor-pointer">
            {STATUS_LABELS[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
