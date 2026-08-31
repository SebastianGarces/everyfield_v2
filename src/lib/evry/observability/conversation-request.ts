import {
  LangfuseOtelSpanAttributes,
  startActiveObservation,
} from "@langfuse/tracing";

import {
  configuredLangfuseEnvironment,
  forceFlushLangfuse,
} from "@/lib/observability/langfuse";

type TraceConversation = Readonly<{
  id: string;
  title: string;
  messages: readonly Readonly<{
    author: "user" | "assistant";
    body: string;
    artifacts: readonly Readonly<{
      artifact: Readonly<{ kind: string; title?: string }>;
    }>[];
  }>[];
}>;

export type EvryConversationTraceInput = Readonly<{
  operation: "create" | "continue";
  actorUserId: string;
  conversationId: string | null;
  requestKey: string;
  message: string;
  pageContext: Readonly<{ kind: string; recordId: string }> | null;
}>;

export function evryConversationTraceOutput(
  conversation: TraceConversation | null
): Readonly<Record<string, unknown>> {
  if (conversation === null) return { status: "unavailable" };
  const assistant = conversation.messages.findLast(
    ({ author }) => author === "assistant"
  );
  return {
    status: "completed",
    conversationId: conversation.id,
    title: conversation.title,
    response: assistant?.body ?? null,
    artifacts:
      assistant?.artifacts.map(({ artifact }) => ({
        kind: artifact.kind,
        ...(artifact.title ? { title: artifact.title } : {}),
      })) ?? [],
  };
}

/** Trace real Evry work without making product availability depend on telemetry. */
export async function observeEvryConversationRequest<T>(input: {
  trace: EvryConversationTraceInput;
  perform: () => Promise<T>;
  output: (result: T) => Readonly<Record<string, unknown>>;
}): Promise<T> {
  const environment = configuredLangfuseEnvironment();
  if (environment === null) return input.perform();

  let productCompleted = false;
  let productFailed = false;
  let productResult: T | undefined;
  try {
    const result = await startActiveObservation(
      "evry.request",
      async (observation) => {
        const traceInput = {
          operation: input.trace.operation,
          message: input.trace.message,
          conversationId: input.trace.conversationId,
          pageContext: input.trace.pageContext,
        };
        observation.otelSpan.setAttribute(
          LangfuseOtelSpanAttributes.TRACE_NAME,
          "evry.conversation"
        );
        observation.otelSpan.setAttribute(
          LangfuseOtelSpanAttributes.TRACE_USER_ID,
          input.trace.actorUserId
        );
        observation.otelSpan.setAttribute(
          LangfuseOtelSpanAttributes.TRACE_SESSION_ID,
          input.trace.conversationId ?? input.trace.requestKey
        );
        observation.otelSpan.setAttribute(
          LangfuseOtelSpanAttributes.TRACE_TAGS,
          ["product", `operation:${input.trace.operation}`]
        );
        observation.otelSpan.setAttribute(
          LangfuseOtelSpanAttributes.ENVIRONMENT,
          environment
        );
        observation.otelSpan.setAttribute(
          LangfuseOtelSpanAttributes.TRACE_INPUT,
          JSON.stringify(traceInput)
        );
        try {
          observation.update({
            input: traceInput,
            metadata: {
              requestKey: input.trace.requestKey,
              deterministic: true,
            },
          });
        } catch {
          // Telemetry must not block the product request.
        }

        let value: T;
        try {
          value = await input.perform();
        } catch (error) {
          productFailed = true;
          try {
            observation.otelSpan.setAttribute(
              LangfuseOtelSpanAttributes.TRACE_OUTPUT,
              JSON.stringify({ status: "failed" })
            );
            observation.update({
              level: "ERROR",
              statusMessage: "request_failed",
              output: { status: "failed" },
            });
          } catch {
            // Preserve the product error even when telemetry also fails.
          }
          throw error;
        }
        productResult = value;
        productCompleted = true;
        const traceOutput = input.output(value);
        observation.otelSpan.setAttribute(
          LangfuseOtelSpanAttributes.TRACE_OUTPUT,
          JSON.stringify(traceOutput)
        );
        try {
          observation.update({ output: traceOutput });
        } catch {
          // The product result is already durable and can be returned.
        }
        return value;
      }
    );
    void forceFlushLangfuse().catch(() => {});
    return result;
  } catch (error) {
    // A tracing setup/export failure must not make Evry unavailable. Errors
    // thrown by product work are rethrown by the observation callback above.
    if (productFailed) throw error;
    if (productCompleted) return productResult as T;
    return input.perform();
  }
}
