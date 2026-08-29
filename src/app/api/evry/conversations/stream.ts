import {
  evryConversationStreamEventSchema,
  type EvryConversationStreamEvent,
  type EvryConversationStreamStage,
} from "@/lib/evry/streaming/conversation-wire";
import type { PublicEvryConversation } from "@/lib/evry/conversations/public-contract";

const STREAM_HEADERS = {
  "cache-control": "private, no-store",
  "content-type": "application/x-ndjson; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

export function wantsEvryConversationStream(request: Request): boolean {
  return (
    request.headers.get("accept")?.includes("application/x-ndjson") ?? false
  );
}

type UnsequencedStreamEvent<T = EvryConversationStreamEvent> =
  T extends EvryConversationStreamEvent
    ? Omit<T, "requestId" | "sequence">
    : never;

export function evryConversationStream(
  input: Readonly<{
    requestId: string;
    status?: number;
    run: (
      report: (stage: EvryConversationStreamStage) => void
    ) => Promise<
      | Readonly<{ conversation: PublicEvryConversation }>
      | Readonly<{ status: "active" }>
      | null
    >;
    failureCode: (error: unknown) => "stale" | "unavailable";
  }>
): Response {
  const encoder = new TextEncoder();
  let sequence = 0;
  let closed = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: UnsequencedStreamEvent) => {
        if (closed) return;
        const parsed = evryConversationStreamEventSchema.parse({
          ...event,
          requestId: input.requestId,
          sequence,
        });
        sequence += 1;
        controller.enqueue(encoder.encode(`${JSON.stringify(parsed)}\n`));
      };

      emit({
        type: "work",
        phase: "reading",
        code: "request_accepted",
      });
      void input
        .run((code) => {
          emit({ type: "work", phase: "planning", code });
        })
        .then((result) => {
          if (result && "status" in result) {
            emit({ type: "active" });
            return;
          }
          if (!result) {
            emit({ type: "failure", code: "unavailable" });
            return;
          }
          emit({ type: "conversation", conversation: result.conversation });
          emit({ type: "complete" });
        })
        .catch((error: unknown) => {
          emit({ type: "failure", code: input.failureCode(error) });
        })
        .finally(() => {
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      // The authenticated, idempotent durable operation must finish even if
      // this particular client disconnects. Only further presentation stops.
      closed = true;
    },
  });

  return new Response(body, {
    status: input.status ?? 200,
    headers: STREAM_HEADERS,
  });
}
