"use client";

import {
  changeStatusWithReasonAction,
  reorderPipelineAction,
} from "@/app/(dashboard)/people/actions";
import type { PersonStatus, PipelineData } from "@/lib/people/types";
import { useRouter } from "next/navigation";
import { PipelineView } from "./pipeline-view";

interface PipelineWrapperProps {
  data: PipelineData;
}

export function PipelineWrapper({ data }: PipelineWrapperProps) {
  const router = useRouter();

  const handleStatusChange = async (
    personId: string,
    newStatus: PersonStatus,
    reason?: string
  ) => {
    const result = await changeStatusWithReasonAction(
      personId,
      newStatus,
      reason
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    // Refresh the page data
    router.refresh();
  };

  const handleReorder = async (orderedPersonIds: string[]) => {
    const result = await reorderPipelineAction(orderedPersonIds);

    if (!result.success) {
      throw new Error(result.error);
    }
  };

  return (
    <PipelineView
      data={data}
      onStatusChange={handleStatusChange}
      onReorder={handleReorder}
    />
  );
}
