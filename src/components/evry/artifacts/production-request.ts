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
}): boolean {
  if (input.action === "cancel" || input.action === "edit") {
    return (
      input.conversation.activePlan === null ||
      !samePlan(input.conversation.activePlan.identity, input.plan)
    );
  }
  return input.conversation.messages
    .flatMap(({ artifacts }) => artifacts)
    .some(({ artifact }) => {
      if (
        (artifact.kind !== "progress" && artifact.kind !== "result") ||
        !("artifactVersion" in artifact)
      ) {
        return false;
      }
      return samePlan(artifact.plan, input.plan);
    });
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
