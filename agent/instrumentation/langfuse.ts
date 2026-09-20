import { defineInstrumentation } from "eve/instrumentation";
import { startActiveObservation } from "@langfuse/tracing";
import { z } from "zod";
import {
  configuredLangfuseEnvironment,
  forceFlushLangfuse,
} from "../../src/lib/observability/langfuse";
import {
  eveTraceMetadataSchema,
  type EveTraceMetadata,
} from "../../src/lib/evry/eve/runtime/trace-policy";

const startSchema = z.object({ name: z.string(), at: z.number() });
async function emit(metadata: EveTraceMetadata) {
  if (!configuredLangfuseEnvironment()) return;
  const safe = eveTraceMetadataSchema.parse(metadata);
  await startActiveObservation(`evry.eve.${safe.operation}`, (span) => {
    span.update({
      metadata: safe,
      level: safe.status === "failed" ? "ERROR" : "DEFAULT",
      statusMessage: safe.status,
    });
  });
}

// Lifecycle projection avoids exporting raw OTel events, status messages, or resource attributes.
export default defineInstrumentation({
  tracePolicy: () => ({
    emit: true,
    recordInputs: false,
    recordOutputs: false,
  }),
  flush: forceFlushLangfuse,
  events: {
    "model.call.started": (_event, ctx) => {
      ctx.state.set({ name: "gpt-5.6-luna", at: Date.now() });
    },
    "model.call.completed": async (event, ctx) => {
      const start = startSchema.safeParse(ctx.state.get());
      if (!start.success) return;
      await emit({
        operation: "model",
        name: start.data.name,
        status: "completed",
        durationMs: Math.max(0, Date.now() - start.data.at),
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        cacheReadTokens: event.usage.inputTokenDetails?.cacheReadTokens,
      });
    },
    "model.call.failed": async (_event, ctx) => {
      const start = startSchema.safeParse(ctx.state.get());
      if (start.success)
        await emit({
          operation: "model",
          name: start.data.name,
          status: "failed",
          durationMs: Math.max(0, Date.now() - start.data.at),
        });
    },
    "action.started": (event, ctx) => {
      const known =
        /^(capability__[a-z_]+|code_mode|present_result|draft_get|draft_update|load_skill|ask_question|todo)$/.test(
          event.name
        );
      ctx.state.set({
        name: known ? event.name : "unknown_tool",
        at: Date.now(),
      });
    },
    "action.completed": async (_event, ctx) => {
      const start = startSchema.safeParse(ctx.state.get());
      if (start.success)
        await emit({
          operation: "tool",
          name: start.data.name,
          status: "completed",
          durationMs: Math.max(0, Date.now() - start.data.at),
        });
    },
    "action.failed": async (event, ctx) => {
      const start = startSchema.safeParse(ctx.state.get());
      if (start.success)
        await emit({
          operation: "tool",
          name: start.data.name,
          status: event.outcome,
          durationMs: Math.max(0, Date.now() - start.data.at),
        });
    },
  },
});
