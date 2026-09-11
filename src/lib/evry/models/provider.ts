import { createOpenAI } from "@ai-sdk/openai";
import {
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";

import type { EvryModelCandidateId } from "./candidates";

/**
 * Selected from the verified 2026-08-28 release benchmark. Keep the provider
 * behind this seam so production never chooses a model from caller input.
 */
export const EVRY_POLICY_MODEL_ID =
  "gpt-5.6-luna" satisfies EvryModelCandidateId;

/** Responses commentary is an update, not part of the final JSON document.
 * Keep usage and non-text events intact; never repair or execute commentary.
 * https://developers.openai.com/api/docs/guides/latest-model#phase-parameter
 */
export const evryStructuredOutputMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  async wrapGenerate({ doGenerate, params }) {
    const result = await doGenerate();
    if (params.responseFormat?.type !== "json") return result;
    return {
      ...result,
      content: result.content.filter(
        (part) =>
          part.type !== "text" ||
          part.providerMetadata?.openai?.phase !== "commentary"
      ),
    };
  },
  async wrapStream({ doStream, params }) {
    const result = await doStream();
    if (params.responseFormat?.type !== "json") return result;
    const commentary = new Set<string>();
    type StreamPart =
      typeof result.stream extends ReadableStream<infer Part> ? Part : never;
    const unphased = new Map<string, StreamPart[]>();
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (
              part.type === "text-start" &&
              part.providerMetadata?.openai?.phase == null
            ) {
              // Some Responses streams attach phase only when the item ends.
              // Do not expose that item as final JSON before its phase is known.
              unphased.set(part.id, [part]);
              return;
            }
            if (part.type === "text-delta" || part.type === "text-end") {
              const buffered = unphased.get(part.id);
              if (buffered) {
                buffered.push(part);
                if (part.type === "text-end") {
                  unphased.delete(part.id);
                  if (part.providerMetadata?.openai?.phase !== "commentary") {
                    for (const event of buffered) controller.enqueue(event);
                  }
                }
                return;
              }
            }
            if (
              part.type === "text-start" &&
              part.providerMetadata?.openai?.phase === "commentary"
            ) {
              commentary.add(part.id);
            }
            if (
              (part.type === "text-start" ||
                part.type === "text-delta" ||
                part.type === "text-end") &&
              commentary.has(part.id)
            ) {
              if (part.type === "text-end") commentary.delete(part.id);
              return;
            }
            controller.enqueue(part);
          },
        })
      ),
    };
  },
};

/** Resolve lazily so imports and provider-free tests do not require a key. */
export function getEvryPolicyModel(): LanguageModel {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set — required to classify Evry requests."
    );
  }
  return wrapLanguageModel({
    model: createOpenAI({ apiKey })(EVRY_POLICY_MODEL_ID),
    middleware: evryStructuredOutputMiddleware,
  });
}
