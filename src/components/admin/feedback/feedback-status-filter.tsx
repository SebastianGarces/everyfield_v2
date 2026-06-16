"use client";

import { useRouter } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  feedbackStatuses,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/db/schema";

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const ALL_VALUE = "all";

export function FeedbackStatusFilter({
  activeStatus,
  category,
}: {
  activeStatus?: FeedbackStatus;
  category?: FeedbackCategory;
}) {
  const router = useRouter();

  const handleValueChange = (value: string) => {
    const params = new URLSearchParams();
    if (value !== ALL_VALUE) {
      params.set("status", value);
    }
    if (category) {
      params.set("category", category);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/feedback?${qs}` : "/admin/feedback");
  };

  return (
    <Tabs value={activeStatus ?? ALL_VALUE} onValueChange={handleValueChange}>
      <TabsList>
        <TabsTrigger value={ALL_VALUE} className="cursor-pointer">
          All
        </TabsTrigger>
        {feedbackStatuses.map((status) => (
          <TabsTrigger key={status} value={status} className="cursor-pointer">
            {STATUS_LABELS[status]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
