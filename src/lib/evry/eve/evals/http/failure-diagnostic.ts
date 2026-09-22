import { z } from "zod";
import type { HostCapture } from "./host";

const count = z.number().int().nonnegative();
const amount = z.number().nonnegative();
const toolName = z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/);
export const fixtureFailureDiagnosticSchema = z.strictObject({
  stop: z.enum(["timeout", "cancelled", "runtime_error"]),
  elapsedMs: amount,
  costUsd: amount,
  costBasis: z.enum(["provider_usage", "reserved_upper_bound"]),
  generations: count,
  capturedCalls: count,
  outboundMessages: count,
  lastCalls: z.array(toolName).max(12),
  lastGenerations: z
    .array(
      z.strictObject({
        startedMs: amount,
        durationMs: amount.nullable(),
        inputBytes: count,
        inputTokens: count.nullable(),
        outputTokens: count.nullable(),
        costUsd: amount.nullable(),
        tools: z.array(toolName).max(64),
      })
    )
    .max(8),
});
export type FixtureFailureDiagnostic = z.infer<
  typeof fixtureFailureDiagnosticSchema
>;

/** Metadata only. Never serialize the exception, prompt, arguments or results. */
export function fixtureFailureDiagnostic(input: {
  signal: AbortSignal;
  elapsedMs: number;
  capture: HostCapture;
}): FixtureFailureDiagnostic {
  const { signal, capture } = input;
  const safeNames = (names: string[]) =>
    names.filter((name) => toolName.safeParse(name).success);
  return {
    stop: signal.aborted
      ? signal.reason instanceof Error && signal.reason.name === "TimeoutError"
        ? "timeout"
        : "cancelled"
      : "runtime_error",
    elapsedMs: input.elapsedMs,
    costUsd: capture.costUsd,
    costBasis: capture.costBasis,
    generations: capture.modelCalls.length,
    capturedCalls: capture.calls.length,
    outboundMessages: capture.outboundMessages,
    lastCalls: safeNames(capture.calls.slice(-12).map((call) => call.name)),
    lastGenerations: capture.modelCalls.slice(-8).map((call) => ({
      startedMs: call.startedMs,
      durationMs: call.durationMs,
      inputBytes: call.inputBytes,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costUsd: call.costUsd,
      tools: safeNames(call.tools).slice(0, 64),
    })),
  };
}
