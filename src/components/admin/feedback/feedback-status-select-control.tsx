"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { feedbackStatuses, type FeedbackStatus } from "@/db/schema";

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export function FeedbackStatusSelectControl({
  status,
  accessibleName,
  isPending,
  onValueChange,
}: {
  status: FeedbackStatus;
  accessibleName: string;
  isPending: boolean;
  onValueChange: (next: string) => void;
}) {
  return (
    <Select value={status} onValueChange={onValueChange} disabled={isPending}>
      <SelectTrigger
        aria-label={accessibleName}
        className="w-40 cursor-pointer"
        size="sm"
      >
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
