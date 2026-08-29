import {
  parseEvryArtifactLifecycleResponse,
  parseEvryConversationEnvelope,
  type PublicEvryConversation,
} from "@/components/evry/client-contract";
import type { EvryArtifactError } from "@/lib/evry/artifacts/review";
import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";

export type EvryProductionArtifactAction =
  | "cancel"
  | "edit"
  | "execute"
  | "retry";

export type EvryProductionArtifactRequestResult =
  | Readonly<{
      status: "conversation";
      conversation: PublicEvryConversation;
    }>
  | Readonly<{
      status: "error";
      error: EvryArtifactError | Readonly<{ kind: "uncertain" }>;
    }>;

type FetchResponse = Readonly<{ json(): Promise<unknown> }>;
type FetchArtifact = (
  input: string,
  init: Readonly<{
    method: "GET" | "POST";
    headers: Readonly<Record<string, string>>;
    body?: string;
  }>
) => Promise<FetchResponse>;

function samePlan(
  left: Readonly<{ planId: string; fingerprint: string }>,
  right: Readonly<{ planId: string; fingerprint: string }>
) {
  return left.planId === right.planId && left.fingerprint === right.fingerprint;
}

function conversationReconcilesRequest(input: {
  conversation: PublicEvryConversation;
  action: EvryProductionArtifactAction;
  plan: EvryConversationPlanIdentity;
  baseline: Readonly<{
    stateVersion: number;
    messageId: string;
    artifactId: string;
  }>;
}): boolean {
  const advanced =
    input.conversation.stateVersion > input.baseline.stateVersion;
  const baselineSequence = input.conversation.messages.find(
    ({ id }) => id === input.baseline.messageId
  )?.sequence;
  if (input.action === "cancel" || input.action === "edit") {
    return (
      advanced &&
      (input.conversation.activePlan === null ||
        !samePlan(input.conversation.activePlan.identity, input.plan))
    );
  }
  for (const message of input.conversation.messages) {
    for (const stored of message.artifacts) {
      const artifact = stored.artifact;
      if (
        advanced &&
        baselineSequence !== undefined &&
        message.sequence > baselineSequence &&
        message.id !== input.baseline.messageId &&
        stored.id !== input.baseline.artifactId &&
        (artifact.kind === "progress" || artifact.kind === "result") &&
        "artifactVersion" in artifact &&
        samePlan(artifact.plan, input.plan)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Reissue an uncertain request only with its original request identity, then
 * reopen persisted state. It never fabricates a terminal outcome or support ID.
 */
export async function coordinateEvryProductionArtifactRequest(input: {
  conversationId: string;
  action: EvryProductionArtifactAction;
  requestKey: string;
  plan: EvryConversationPlanIdentity;
  baseline: Readonly<{
    stateVersion: number;
    messageId: string;
    artifactId: string;
  }>;
  fetchArtifact?: FetchArtifact;
}): Promise<EvryProductionArtifactRequestResult> {
  const fetchArtifact: FetchArtifact =
    input.fetchArtifact ??
    (async (url, init) =>
      fetch(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body === undefined ? {} : { body: init.body }),
      }));
  const conversationPath =
    "/api/evry/conversations/" + encodeURIComponent(input.conversationId);
  const requestBody = JSON.stringify({
    action: input.action,
    requestKey: input.requestKey,
    plan: input.plan,
  });
  let uncertain = false;
  let serverUnexpected: Extract<
    EvryArtifactError,
    { kind: "unexpected" }
  > | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchArtifact(conversationPath + "/artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      });
      const result = parseEvryArtifactLifecycleResponse(await response.json());
      if ("conversation" in result) {
        return { status: "conversation", conversation: result.conversation };
      }
      if (result.error.kind === "expected" && !uncertain) {
        return { status: "error", error: result.error };
      }
      if (result.error.kind === "unexpected") {
        serverUnexpected = result.error;
      }
      uncertain = true;
    } catch {
      uncertain = true;
    }
  }

  try {
    const response = await fetchArtifact(conversationPath, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const conversation = parseEvryConversationEnvelope(await response.json());
    if (
      conversationReconcilesRequest({
        conversation,
        action: input.action,
        plan: input.plan,
        baseline: input.baseline,
      })
    ) {
      return { status: "conversation", conversation };
    }
  } catch {
    // The caller renders uncertainty without claiming unpersisted facts.
  }

  return {
    status: "error",
    error: serverUnexpected ?? { kind: "uncertain" },
  };
}
