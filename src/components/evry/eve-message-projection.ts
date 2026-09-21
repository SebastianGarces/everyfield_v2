import type { EveMessage } from "eve/client";
import { z } from "zod";
import {
  evryPublicArtifactSchema,
  type EvryPublicArtifact,
} from "@/lib/evry/artifacts/public";
import {
  EVE_PRESENTATION_TOOLS,
  evePresentedToolOutputSchema,
  splitEveResponse,
} from "@/lib/evry/eve/presentation";

export type EveVisiblePart =
  | { kind: "text"; text: string; key: string }
  | { kind: "artifact"; artifact: EvryPublicArtifact; key: string }
  | { kind: "session-limit"; requestId: string; prompt: string; key: string }
  | { kind: "question"; requestId: string; prompt: string; key: string };

const presentation = z.object({ artifacts: z.array(evryPublicArtifactSchema) });
// Eve preserves the dynamic tool map key; the resolver filename is not a prefix.
const PREPARATION_TOOL = "actions_prepare";
const PRESENTATION_TOOL = "present_result";

/** Render the agent's selected presentation, never arbitrary tool/debug output. */
export function projectEveMessage(
  message: EveMessage
): readonly EveVisiblePart[] {
  return projectMessage(message).visible;
}

/** The eval recorder uses the same trusted selection as the chat. */
export function selectedEveResultReferences(
  message: EveMessage
): readonly string[] {
  return projectMessage(message).references;
}

function projectMessage(message: EveMessage) {
  const visible: EveVisiblePart[] = [];
  const shownPlans = new Set<string>();
  const references = new Set<string>();
  const results = new Map<string, readonly EvryPublicArtifact[]>();
  const envelopes = new Map<
    number,
    z.infer<typeof evePresentedToolOutputSchema>
  >();
  const malformed = new Set<number>();
  if (message.role === "assistant" && message.metadata?.turnId) {
    for (const [index, part] of message.parts.entries()) {
      if (
        part.type !== "dynamic-tool" ||
        !EVE_PRESENTATION_TOOLS.has(part.toolName) ||
        part.state !== "output-available" ||
        part.partial
      )
        continue;
      if (
        typeof part.output !== "object" ||
        part.output === null ||
        !Object.hasOwn(part.output, "presentation")
      )
        continue;
      const parsed = evePresentedToolOutputSchema.safeParse(part.output);
      if (
        !parsed.success ||
        parsed.data.presentation.turnId !== message.metadata.turnId
      ) {
        malformed.add(index);
        continue;
      }
      envelopes.set(index, parsed.data);
      for (const result of parsed.data.presentation.results)
        results.set(result.reference, result.artifacts);
    }
  }
  const showArtifact = (
    artifact: EvryPublicArtifact,
    key: string,
    target = visible
  ) => {
    if (artifact.kind === "confirmation") {
      const identity = `${artifact.plan.planId}:${artifact.plan.fingerprint}`;
      if (shownPlans.has(identity)) return;
      shownPlans.add(identity);
    }
    target.push({ kind: "artifact", artifact, key });
  };
  let textBoundary = false;
  for (const [index, part] of message.parts.entries()) {
    const key = `${message.id}:${index}`;
    if (part.type === "text" && part.text.length) {
      // Join adjacent text deltas, but keep explicit tool presentation in place.
      const previous = visible.at(-1);
      if (previous?.kind === "text") {
        if (
          textBoundary &&
          !previous.text.endsWith("\n") &&
          !part.text.startsWith("\n")
        )
          previous.text += "\n\n";
        previous.text += part.text;
      } else visible.push({ kind: "text", text: part.text, key });
      textBoundary = false;
    }
    if (part.type === "step-start" || part.type === "dynamic-tool")
      textBoundary = true;
    if (part.type !== "dynamic-tool") continue;
    if (malformed.has(index)) {
      visible.push({
        kind: "text",
        text: "I couldn't display this result. Please ask me to retrieve it again.",
        key,
      });
      continue;
    }
    const envelope = envelopes.get(index);
    if (envelope) {
      for (const result of envelope.presentation.results) {
        for (const [ordinal, artifact] of result.artifacts.entries()) {
          if (artifact.kind !== "confirmation") continue;
          references.add(result.reference);
          showArtifact(artifact, `${key}:${result.reference}:${ordinal}`);
        }
      }
      continue;
    }
    const question = part.toolMetadata?.eve?.inputRequest;
    if (
      question?.kind === "session-limit" &&
      part.toolMetadata?.eve?.inputResponse?.optionId === "stop"
    ) {
      visible.push({
        kind: "text",
        text: "You chose to stop here. Your conversation is saved.",
        key,
      });
    }
    if (
      part.state === "approval-requested" &&
      question?.kind === "session-limit"
    ) {
      visible.push({
        kind: "session-limit",
        requestId: question.requestId,
        prompt:
          "Evry paused to keep this conversation’s AI usage within its limit. Continue to allow more processing, or stop here. Your conversation is saved.",
        key,
      });
    }
    if (part.state === "approval-requested" && question?.kind === "question") {
      visible.push({
        kind: "question",
        requestId: question.requestId,
        prompt: question.prompt,
        key,
      });
    }
    if (
      part.toolName !== PRESENTATION_TOOL &&
      part.toolName !== PREPARATION_TOOL
    )
      continue;
    if (part.state === "output-error") {
      visible.push({
        kind: "text",
        text: "I couldn’t display this result. Please ask me to retrieve it again.",
        key,
      });
      continue;
    }
    if (part.state !== "output-available" || part.partial) continue;
    if (
      z.object({ status: z.literal("unavailable") }).safeParse(part.output)
        .success
    ) {
      visible.push({
        kind: "text",
        text: "This result is no longer available. Please ask me to retrieve it again.",
        key,
      });
      continue;
    }
    const parsed = presentation.safeParse(part.output);
    if (!parsed.success) {
      visible.push({
        kind: "text",
        text: "I couldn’t display this result. Please ask me to retrieve it again.",
        key,
      });
      continue;
    }
    for (const [ordinal, artifact] of parsed.data.artifacts.entries()) {
      // Both allowlisted tools return server-owned artifacts. present_result
      // accepts only an authorized current-turn reference, never model JSON.
      // A nested code-mode preparation can therefore use the same exact review.
      showArtifact(artifact, `${key}:${ordinal}`);
    }
  }
  if (message.role !== "assistant") return { visible, references: [] };
  const projected: EveVisiblePart[] = [];
  const complete = message.metadata?.status !== "streaming";
  for (const part of visible) {
    if (part.kind !== "text") {
      projected.push(part);
      continue;
    }
    for (const segment of splitEveResponse(part.text, complete)) {
      const key =
        segment.offset === 0 ? part.key : `${part.key}:${segment.offset}`;
      if (segment.kind === "text") {
        projected.push({ kind: "text", text: segment.text, key });
        continue;
      }
      const artifacts =
        segment.kind === "result" ? results.get(segment.reference) : undefined;
      if (!artifacts) {
        if (complete)
          projected.push({
            kind: "text",
            text: "This result is no longer available. Please ask me to retrieve it again.",
            key,
          });
        continue;
      }
      if (segment.kind !== "result" || references.has(segment.reference))
        continue;
      references.add(segment.reference);
      for (const [ordinal, artifact] of artifacts.entries())
        showArtifact(artifact, `${key}:${ordinal}`, projected);
    }
  }
  return { visible: projected, references: [...references] };
}
