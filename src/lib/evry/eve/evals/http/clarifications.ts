import { z } from "zod";
import type { fixtureTranscript } from "./transcript";
import type { Observation } from "../contract";

const questionPatch = z.object({
  pendingQuestion: z.string().nullable(),
});

/** Structural evidence is a lower bound, never a semantic judgment of prose. */
export function observeClarifications(
  messages: ReturnType<typeof fixtureTranscript>
): Required<
  Pick<Observation, "clarificationCount" | "clarificationMeasurement">
> {
  const turns = new Map<
    string,
    {
      nativeQuestion: boolean;
      text: boolean;
      textSincePatch: boolean;
      pending: string | null | undefined;
    }
  >();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const id = message.metadata?.turnId ?? message.id;
    const turn = turns.get(id) ?? {
      nativeQuestion: false,
      text: false,
      textSincePatch: false,
      pending: undefined,
    };
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) {
        turn.text = true;
        turn.textSincePatch = true;
      }
      if (part.type !== "dynamic-tool") continue;
      // A session-limit or approval request is not a clarification.
      if (part.toolMetadata?.eve?.inputRequest?.kind === "question")
        turn.nativeQuestion = true;
      if (
        part.toolName !== "draft_update" ||
        part.state !== "output-available" ||
        part.partial
      )
        continue;
      const patch = questionPatch.safeParse(part.input);
      const saved = questionPatch.safeParse(part.output);
      // The input must explicitly set/clear the question this turn. A returned
      // old pendingQuestion, draft_get, failed call, or proposed input is not proof.
      if (
        patch.success &&
        saved.success &&
        patch.data.pendingQuestion === saved.data.pendingQuestion
      ) {
        turn.pending = saved.data.pendingQuestion;
        turn.textSincePatch = false;
      }
    }
    turns.set(id, turn);
  }
  const observedTurnIds: string[] = [];
  const unmeasuredTurnIds: string[] = [];
  for (const [id, turn] of turns) {
    if (turn.nativeQuestion || (turn.textSincePatch && turn.pending?.trim()))
      observedTurnIds.push(id);
    else if (
      turn.text &&
      (turn.pending === undefined ||
        (turn.pending?.trim() && !turn.textSincePatch))
    )
      unmeasuredTurnIds.push(id);
  }
  return {
    clarificationCount: observedTurnIds.length,
    clarificationMeasurement: {
      basis: "structural_lower_bound",
      observedTurnIds,
      unmeasuredTurnIds,
    },
  };
}
