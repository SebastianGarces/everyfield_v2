import type { EveMessage } from "eve/client";
import { z } from "zod";
import {
  evryPublicArtifactSchema,
  type EvryPublicArtifact,
} from "@/lib/evry/artifacts/public";

export type EveVisiblePart =
  | { kind: "text"; text: string; key: string }
  | { kind: "artifact"; artifact: EvryPublicArtifact; key: string }
  | { kind: "question"; requestId: string; prompt: string; key: string };

const presentation = z.object({ artifacts: z.array(evryPublicArtifactSchema) });
const PREPARATION_TOOL = "capability__actions_prepare";
const PRESENTATION_TOOL = "present_result";

/** Render the agent's selected presentation, never arbitrary tool/debug output. */
export function projectEveMessage(
  message: EveMessage
): readonly EveVisiblePart[] {
  const visible: EveVisiblePart[] = [];
  const shownPlans = new Set<string>();
  for (const [index, part] of message.parts.entries()) {
    const key = `${message.id}:${index}`;
    if (part.type === "text" && part.text.length) {
      // Join adjacent text deltas, but keep explicit tool presentation in place.
      const previous = visible.at(-1);
      if (previous?.kind === "text") previous.text += part.text;
      else visible.push({ kind: "text", text: part.text, key });
    }
    if (part.type !== "dynamic-tool") continue;
    const question = part.toolMetadata?.eve?.inputRequest;
    if (part.state === "approval-requested" && question?.kind === "question") {
      visible.push({
        kind: "question",
        requestId: question.requestId,
        prompt: question.prompt,
        key,
      });
    }
    if (part.state !== "output-available" || part.partial) continue;
    if (
      part.toolName !== PRESENTATION_TOOL &&
      part.toolName !== PREPARATION_TOOL
    )
      continue;
    const parsed = presentation.safeParse(part.output);
    if (!parsed.success) continue;
    for (const [ordinal, artifact] of parsed.data.artifacts.entries()) {
      // Both allowlisted tools return server-owned artifacts. present_result
      // accepts only an authorized current-turn reference, never model JSON.
      // A nested code-mode preparation can therefore use the same exact review.
      if (artifact.kind === "confirmation") {
        const identity = `${artifact.plan.planId}:${artifact.plan.fingerprint}`;
        if (shownPlans.has(identity)) continue;
        shownPlans.add(identity);
      }
      visible.push({ kind: "artifact", artifact, key: `${key}:${ordinal}` });
    }
  }
  return visible;
}
