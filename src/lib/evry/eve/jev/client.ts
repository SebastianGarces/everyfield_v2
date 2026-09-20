import { z } from "zod";

export const JEV_MODEL = "jev-1.13.0";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_BYTES = 96 * 1024;
const question = z.object({
  type: z.literal("noul"),
  instructions: z.union([
    z.string(),
    z.record(z.string(), z.json()),
    z.array(z.json()),
  ]),
});
const requestSchema = z.object({
  state: z.json(),
  questions: z
    .record(z.string(), question)
    .refine(
      (value) =>
        Object.keys(value).length > 0 && Object.keys(value).length <= 64
    ),
});
const responseSchema = z.object({
  model: z.literal(JEV_MODEL),
  answers: z.record(
    z.string(),
    z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) })
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export type JevRequest = z.infer<typeof requestSchema>;
export type JevResult =
  | {
      status: "available";
      probabilities: Record<string, number>;
      usage: { inputTokens: number; outputTokens: number };
      durationMs: number;
    }
  | {
      status: "unavailable";
      reason:
        | "not_configured"
        | "cancelled"
        | "timeout"
        | "invalid_input"
        | "provider_error"
        | "invalid_response";
    };

/** No retries on the conversation path. An unavailable hint leaves Luna in charge. */
export function createJevClient(config: {
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const timeoutMs = config.timeoutMs ?? 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new Error("Invalid Jev timeout.");
  return async (
    request: JevRequest,
    signal?: AbortSignal
  ): Promise<JevResult> => {
    if (!config.apiKey?.trim())
      return { status: "unavailable", reason: "not_configured" };
    if (signal?.aborted) return { status: "unavailable", reason: "cancelled" };
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success)
      return { status: "unavailable", reason: "invalid_input" };
    const body = JSON.stringify({ ...parsed.data, model: JEV_MODEL });
    if (Buffer.byteLength(body) > MAX_BYTES)
      return { status: "unavailable", reason: "invalid_input" };
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const started = performance.now();
    try {
      const response = await (config.fetch ?? fetch)(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body,
        signal: combined,
        redirect: "error",
      });
      if (!response.ok)
        return { status: "unavailable", reason: "provider_error" };
      // Bound streamed provider output before allocating/parsing the whole response.
      const reader = response.body?.getReader();
      if (!reader) return { status: "unavailable", reason: "invalid_response" };
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > MAX_BYTES) {
            await reader.cancel();
            return { status: "unavailable", reason: "invalid_response" };
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return { status: "unavailable", reason: "invalid_response" };
      }
      const result = responseSchema.safeParse(raw);
      if (!result.success)
        return { status: "unavailable", reason: "invalid_response" };
      const expected = Object.keys(parsed.data.questions).sort();
      const actual = Object.keys(result.data.answers).sort();
      if (
        expected.length !== actual.length ||
        expected.some((id, index) => id !== actual[index])
      )
        return { status: "unavailable", reason: "invalid_response" };
      return {
        status: "available",
        probabilities: Object.fromEntries(
          Object.entries(result.data.answers).map(([id, value]) => [
            id,
            value.noul,
          ])
        ),
        usage: {
          inputTokens: result.data.usage.input_tokens,
          outputTokens: result.data.usage.output_tokens,
        },
        durationMs: performance.now() - started,
      };
    } catch {
      return {
        status: "unavailable",
        reason: signal?.aborted
          ? "cancelled"
          : deadline.aborted
            ? "timeout"
            : "provider_error",
      };
    }
  };
}

export type JevClient = ReturnType<typeof createJevClient>;
