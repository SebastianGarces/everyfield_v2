"use client";

import type { AssistantArtifactRecord } from "@/lib/assistant/types";
import { AssistantMeetingDraftPane } from "./meeting-draft-pane";

export function AssistantWorkspacePane({
  artifacts,
  isCreatingMeeting,
  onCreateMeeting,
}: {
  artifacts: AssistantArtifactRecord[];
  isCreatingMeeting: boolean;
  onCreateMeeting: () => void;
}) {
  if (artifacts.length === 0) {
    return null;
  }

  return (
    <AssistantMeetingDraftPane
      artifacts={artifacts}
      isCreatingMeeting={isCreatingMeeting}
      onCreateMeeting={onCreateMeeting}
    />
  );
}
