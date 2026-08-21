"use client";

import { changeStatusWithReasonAction } from "@/app/(dashboard)/people/actions";
import { reorderPipelineAction } from "@/app/(dashboard)/people/pipeline-actions";
import type { PersonStatus, PipelineData } from "@/lib/people/types";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PipelineView } from "./pipeline-view";
import { FollowUpHandoffDialog } from "./follow-up-handoff-dialog";
import type { FollowUpHandoff } from "@/lib/tasks/follow-up-ownership.shared";

export interface InactivityThresholds {
  warningDays: number;
  alertDays: number;
}

interface PipelineWrapperProps {
  data: PipelineData;
  inactivityThresholds?: InactivityThresholds;
}

export function PipelineWrapper({
  data,
  inactivityThresholds,
}: PipelineWrapperProps) {
  const router = useRouter();
  // The drag-and-drop board is the SECOND way a demotion happens (#470 Q2), and
  // the offer to re-home the follow-ups has to be the same one the status modal
  // makes — so both mount the one dialog off the same action payload.
  const [handoff, setHandoff] = useState<FollowUpHandoff | null>(null);

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

    setHandoff(result.data.followUpHandoff);

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
    <>
      <FollowUpHandoffDialog
        handoff={handoff}
        onClose={() => {
          setHandoff(null);
          router.refresh();
        }}
      />
      <PipelineView
        data={data}
        onStatusChange={handleStatusChange}
        onReorder={handleReorder}
        inactivityThresholds={inactivityThresholds}
      />
    </>
  );
}
