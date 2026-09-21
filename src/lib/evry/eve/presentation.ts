import { z } from "zod";
import { evryPublicArtifactSchema } from "../artifacts/public";
import { EVE_CAPABILITY_CATALOG } from "./capabilities/catalog";

/** These native executors attach presentation outside model-generated output. */
export const EVE_PRESENTATION_TOOLS = new Set<string>([
  "code_mode",
  ...EVE_CAPABILITY_CATALOG.map(([name]) => name.replaceAll(".", "_")),
]);

export const eveResultPresentationSchema = z.strictObject({
  version: z.literal(1),
  turnId: z.string().min(1),
  results: z
    .array(
      z.strictObject({
        reference: z.string().min(1).max(240),
        artifacts: z.array(evryPublicArtifactSchema),
      })
    )
    .max(24),
});
export const evePresentedToolOutputSchema = z.object({
  data: z.json(),
  presentation: eveResultPresentationSchema,
});
export type EveResultPresentation = z.infer<typeof eveResultPresentationSchema>;

const RESULT_PREFIX = "[[evry-result:";
export function eveResultMarker(reference: string) {
  return `${RESULT_PREFIX}${encodeURIComponent(reference)}]]`;
}

export type EveResponseSegment =
  | { kind: "text"; text: string; offset: number }
  | { kind: "result"; reference: string; offset: number }
  | { kind: "unavailable"; offset: number };

/** Parse only the presentation delimiter; Markdown itself stays with our renderer. */
export function splitEveResponse(
  text: string,
  complete: boolean
): EveResponseSegment[] {
  const segments: EveResponseSegment[] = [];
  let position = 0;
  while (position < text.length) {
    const start = text.indexOf(RESULT_PREFIX, position);
    if (start < 0) {
      let tail = text.slice(position);
      if (!complete) {
        for (
          let length = Math.min(RESULT_PREFIX.length - 1, tail.length);
          length > 0;
          length--
        ) {
          if (tail.endsWith(RESULT_PREFIX.slice(0, length))) {
            tail = tail.slice(0, -length);
            break;
          }
        }
      }
      if (tail) segments.push({ kind: "text", text: tail, offset: position });
      break;
    }
    if (start > position)
      segments.push({
        kind: "text",
        text: text.slice(position, start),
        offset: position,
      });
    const end = text.indexOf("]]", start + RESULT_PREFIX.length);
    if (end < 0) {
      if (complete) segments.push({ kind: "unavailable", offset: start });
      break;
    }
    try {
      const reference = decodeURIComponent(
        text.slice(start + RESULT_PREFIX.length, end)
      );
      segments.push(
        reference.length > 0 && reference.length <= 240
          ? { kind: "result", reference, offset: start }
          : { kind: "unavailable", offset: start }
      );
    } catch {
      segments.push({ kind: "unavailable", offset: start });
    }
    position = end + 2;
  }
  return segments;
}
