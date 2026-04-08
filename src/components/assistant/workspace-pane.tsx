"use client";

import type { AssistantArtifactRecord } from "@/lib/assistant/types";

export function AssistantWorkspacePane({
  artifacts,
}: {
  artifacts: AssistantArtifactRecord[];
}) {
  if (artifacts.length === 0) {
    return null;
  }

  return null;
}
