"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { updateFeedbackStatusAction } from "@/app/(dashboard)/admin/feedback/actions";
import type { FeedbackStatus } from "@/db/schema";

import { FeedbackStatusSelectControl } from "./feedback-status-select-control";
import { submitFeedbackStatusChange } from "./feedback-status-select-workflow";

export function FeedbackStatusSelect({
  id,
  status,
  accessibleName,
}: {
  id: string;
  status: FeedbackStatus;
  accessibleName: string;
}) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (next: string) => {
    if (next === status) return;

    startTransition(async () => {
      await submitFeedbackStatusChange({
        id,
        status,
        next,
        updateStatus: updateFeedbackStatusAction,
        onSuccess: () => toast.success("Status updated"),
        onError: toast.error,
      });
    });
  };

  return (
    <FeedbackStatusSelectControl
      accessibleName={accessibleName}
      isPending={isPending}
      onValueChange={handleChange}
      status={status}
    />
  );
}
