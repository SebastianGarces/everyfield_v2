import { publicEvryArtifact } from "@/lib/evry/artifacts/public";

import type { EvryResumedConversation } from "./service";

export function publicEvryConversation(resumed: EvryResumedConversation) {
  const { conversation } = resumed;
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    lastActivityAt: conversation.lastActivityAt.toISOString(),
    activePlan: resumed.activePlan,
    stateVersion: conversation.stateVersion,
    state: conversation.state,
    messages: conversation.messages.map((message) => ({
      id: message.id,
      sequence: message.sequence,
      author: message.author,
      body: message.body,
      pageContext: message.pageContext,
      deliveryStatus: message.deliveryStatus,
      createdAt: message.createdAt.toISOString(),
      artifacts: message.artifacts.map(({ id, ordinal, artifact }) => ({
        id,
        ordinal,
        artifact: publicEvryArtifact(artifact),
      })),
    })),
  };
}
