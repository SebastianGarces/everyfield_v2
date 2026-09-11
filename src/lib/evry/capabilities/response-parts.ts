import { z } from "zod";
import type { EvryReadArtifact } from "@/lib/evry/artifacts/types";
import { storedEvryReadArtifactDocument } from "@/lib/evry/conversations/artifacts";
import { EVRY_READ_BUDGET } from "./read-budget";

// One prose passage per result, plus an optional closing passage.
export const EVRY_RESPONSE_PART_LIMIT = EVRY_READ_BUDGET.calls * 2 + 1;

// The provider chooses references, never component payloads or application URLs.
export const evryResponseSchema = z.strictObject({
  parts: z
    .array(
      z.strictObject({
        kind: z.enum(["text", "result"]),
        text: z.string().max(8000),
        resultIndex: z
          .number()
          .int()
          .min(0)
          .max(EVRY_READ_BUDGET.calls - 1)
          .nullable(),
      })
    )
    .min(1)
    .max(EVRY_RESPONSE_PART_LIMIT),
});
export type EvryResponse = z.infer<typeof evryResponseSchema>;
export type EvryResponsePreview = Readonly<{
  body: string;
  artifacts: readonly EvryReadArtifact[];
}>;

/** Store text once, with application-computed insertion points for real results. */
export function composeEvryResponse(
  value: unknown,
  results: readonly EvryReadArtifact[]
): EvryResponsePreview {
  const parsed = evryResponseSchema.parse(value);
  let body = "";
  const artifacts: EvryReadArtifact[] = [];
  const used = new Set<number>();
  for (const part of parsed.parts) {
    if (part.kind === "text") {
      if (part.resultIndex !== null)
        throw new Error("Text cannot select a result");
      body += part.text;
    } else {
      if (
        part.text !== "" ||
        part.resultIndex === null ||
        used.has(part.resultIndex)
      ) {
        throw new Error("Invalid response result reference");
      }
      const artifact = results[part.resultIndex];
      if (!artifact) throw new Error("Unknown response result reference");
      used.add(part.resultIndex);
      artifacts.push({ ...artifact, textOffset: body.length });
    }
  }
  if (!body.trim() || body.length > 8000)
    throw new Error("Invalid response text");
  const leadingSpace = body.length - body.trimStart().length;
  body = body.trim();
  return {
    body,
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      textOffset: Math.max(
        0,
        Math.min(body.length, (artifact.textOffset ?? 0) - leadingSpace)
      ),
    })),
  };
}

export function storedEvryResponse(response: EvryResponsePreview) {
  return {
    body: response.body,
    artifacts: response.artifacts.map(storedEvryReadArtifactDocument),
  };
}
