import {
  parseEvryConversationEnvelope,
  type PublicEvryConversation,
} from "@/components/evry/client-contract";
import {
  bindEvryRunRecoveryConversation,
  reconnectEvryRun,
  type EvryRecipeReuseRecoveryMarker,
} from "@/components/evry/streaming/run-recovery";

export type EvryRecipeReuseRequestResult =
  | Readonly<{ status: "conversation"; conversation: PublicEvryConversation }>
  | Readonly<{ status: "unavailable" }>;

type Reconnect = typeof reconnectEvryRun;

function endpoint(marker: EvryRecipeReuseRecoveryMarker): string {
  return `/api/evry/conversations/${encodeURIComponent(marker.sourceConversationId)}/reuse`;
}

function body(marker: EvryRecipeReuseRecoveryMarker): string {
  return JSON.stringify({
    requestKey: marker.requestId,
    resultArtifactId: marker.resultArtifactId,
    recipeIdentity: marker.recipeIdentity,
  });
}

/** Replay one exact durable reuse operation, then recover its committed result. */
export async function requestEvryRecipeReuse(input: {
  marker: EvryRecipeReuseRecoveryMarker;
  signal: AbortSignal;
  fetchRequest?: typeof fetch;
  reconnect?: Reconnect;
}): Promise<EvryRecipeReuseRequestResult> {
  const fetchRequest = input.fetchRequest ?? fetch;
  const reconnect = input.reconnect ?? reconnectEvryRun;
  try {
    const response = await fetchRequest(endpoint(input.marker), {
      method: "POST",
      cache: "no-store",
      signal: input.signal,
      headers: { "content-type": "application/json" },
      body: body(input.marker),
    });
    if (response.status === 201) {
      const conversation = parseEvryConversationEnvelope(await response.json());
      bindEvryRunRecoveryConversation(input.marker.requestId, conversation.id);
      return { status: "conversation", conversation };
    }
    if (response.status !== 202) return { status: "unavailable" };
  } catch (error) {
    if (
      input.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    // The POST may have committed before transport or decoding failed. The
    // durable run is authoritative, so never mint or submit another identity.
  }
  const recovered = await reconnect({
    marker: input.marker,
    signal: input.signal,
    onActive: () => undefined,
  });
  if (recovered.status !== "durable") return { status: "unavailable" };
  bindEvryRunRecoveryConversation(
    input.marker.requestId,
    recovered.conversation.id
  );
  return { status: "conversation", conversation: recovered.conversation };
}
