import type { PublicEvryConversation } from "@/components/evry/client-contract";
import type { EvryWorkState } from "@/lib/evry/streaming/state";

/** Derive presentation only from the latest durable artifact returned by Evry. */
export function evryWorkStateForConversation(
  conversation: PublicEvryConversation
): EvryWorkState {
  const latestArtifact = conversation.messages
    .flatMap(({ artifacts }) => artifacts)
    .at(-1)?.artifact;
  if (latestArtifact?.kind === "confirmation") {
    const activePlan = conversation.activePlan;
    const isCurrent =
      activePlan?.identity.planId === latestArtifact.plan.planId &&
      activePlan.identity.fingerprint === latestArtifact.plan.fingerprint;
    return isCurrent && activePlan.confirmable
      ? {
          phase: "confirmation",
          message: "Your review is ready. Nothing happens until you confirm.",
        }
      : {
          phase: "blocked",
          message:
            "This confirmation is no longer current. Review the conversation before continuing.",
        };
  }
  if (latestArtifact?.kind === "progress") {
    return "artifactVersion" in latestArtifact && latestArtifact.error
      ? {
          phase: "blocked",
          message:
            latestArtifact.error.kind === "expected"
              ? latestArtifact.error.message
              : "Evry could not complete this step. Use the support reference in the progress details.",
        }
      : { phase: "execution", message: latestArtifact.title };
  }
  if (latestArtifact?.kind === "result") {
    switch (latestArtifact.status) {
      case "completed":
        return { phase: "complete", message: latestArtifact.title };
      case "partially_failed":
        return { phase: "blocked", message: latestArtifact.title };
      case "failed":
      case "refused":
        return { phase: "failed", message: latestArtifact.title };
      default: {
        const exhaustive: never = latestArtifact.status;
        return exhaustive;
      }
    }
  }
  return { phase: "complete", message: "Request saved." };
}
