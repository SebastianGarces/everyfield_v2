import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureMessageSchema } from "./transcript";
import { observeClarifications } from "./clarifications";

function message(id: string, parts: unknown[], role = "assistant") {
  return fixtureMessageSchema.parse({
    id: `${role}-${id}`,
    role,
    metadata: { turnId: id, status: "complete" },
    parts,
  });
}
function text(value: string) {
  return { type: "text", text: value, state: "done" };
}
function draft(id: string, pendingQuestion: string | null) {
  return {
    type: "dynamic-tool",
    toolName: "draft_update",
    toolCallId: id,
    state: "output-available",
    input: { expectedRevision: 0, pendingQuestion },
    output: { revision: 1, pendingQuestion },
  };
}
function request(kind: "question" | "session-limit" | "tool-approval") {
  return {
    type: "dynamic-tool",
    toolName: "ask_question",
    toolCallId: `request-${kind}`,
    state: "approval-requested",
    input: { prompt: "Fixture prompt" },
    approval: { id: kind },
    toolMetadata: {
      eve: {
        kind: "tool-call",
        name: "ask_question",
        inputRequest: { kind, requestId: kind, prompt: "Fixture prompt" },
      },
    },
  };
}

test("captured orientation structure counts one prose clarification before the reviewed action", () => {
  const result = observeClarifications([
    message("0", [text("Create an orientation next Sunday at 10am.")], "user"),
    message("0", [
      draft("initial", null),
      draft("resolved", "How long should the orientation be?"),
      text("What duration should I use for the orientation?"),
    ]),
    message("1", [text("Two hours. Use the saved template.")], "user"),
    message("1", [draft("duration", null), text("The review is ready.")]),
  ]);
  assert.equal(result.clarificationCount, 1);
  assert.deepEqual(result.clarificationMeasurement, {
    basis: "structural_lower_bound",
    observedTurnIds: ["0"],
    unmeasuredTurnIds: [],
  });
});

test("captured document selection counts once and exposes later unmarked prose for review", () => {
  const result = observeClarifications([
    message(
      "0",
      [text("Compare the agendas in these two generated documents.")],
      "user"
    ),
    message("0", [
      draft("select", "Which two generated documents should I compare?"),
      text("Which two generated documents should I compare?"),
    ]),
    message("1", [text("These are the two generated document links.")], "user"),
    message("1", [
      text(
        "The second document could not be read. Please upload a readable copy."
      ),
    ]),
  ]);
  assert.equal(result.clarificationCount, 1);
  assert.deepEqual(result.clarificationMeasurement?.unmeasuredTurnIds, ["1"]);
});

test("native question and saved question dedupe by turn; usage and approval prompts are excluded", () => {
  const question = message("0", [
    draft("draft-question", "Choose a duration"),
    request("question"),
    text("Choose a duration"),
  ]);
  const result = observeClarifications([
    question,
    question,
    message("1", [request("session-limit")]),
    message("2", [request("tool-approval")]),
  ]);
  assert.equal(result.clarificationCount, 1);
  assert.deepEqual(result.clarificationMeasurement?.observedTurnIds, ["0"]);
});

test("failed, partial, mismatched and stale draft state cannot establish a clarification", () => {
  const saved = draft("saved", "Prior question");
  const result = observeClarifications([
    message("stale", [
      { ...saved, input: { expectedRevision: 1, facts: [] } },
      text("A new reply"),
    ]),
    message("read", [{ ...saved, toolName: "draft_get" }, text("A new reply")]),
    message("partial", [{ ...saved, partial: true }, text("A new reply")]),
    message("mismatch", [
      { ...saved, output: { pendingQuestion: "Different question" } },
      text("A new reply"),
    ]),
    message("failed", [
      { ...saved, state: "output-error", errorText: "Revision conflict" },
      text("A new reply"),
    ]),
  ]);
  assert.equal(result.clarificationCount, 0);
  assert.deepEqual(result.clarificationMeasurement?.unmeasuredTurnIds, [
    "stale",
    "read",
    "partial",
    "mismatch",
    "failed",
  ]);
});

test("only the latest explicit question state counts and it must accompany visible prose", () => {
  const result = observeClarifications([
    message("cleared", [
      draft("ask", "A question"),
      draft("clear", null),
      text("Answered from records"),
    ]),
    message("not-shown", [draft("saved-only", "A question")]),
    message("progress-only", [
      text("I am checking the records."),
      draft("saved-after-progress", "A question"),
    ]),
    message("reasked", [
      draft("ask-again", "A question"),
      text("Please clarify"),
    ]),
    message("reasked-next-turn", [
      draft("again", "A question"),
      text("Please clarify"),
    ]),
  ]);
  assert.equal(result.clarificationCount, 2);
  assert.deepEqual(result.clarificationMeasurement?.observedTurnIds, [
    "reasked",
    "reasked-next-turn",
  ]);
});

test("question marks, imperative prose and ordinary factual answers are never phrase-classified", () => {
  const result = observeClarifications([
    message("question", [text("How long?")]),
    message("imperative", [text("Choose a duration.")]),
    message("fact", [text("You have two tasks due today.")]),
  ]);
  assert.equal(result.clarificationCount, 0);
  assert.deepEqual(result.clarificationMeasurement?.unmeasuredTurnIds, [
    "question",
    "imperative",
    "fact",
  ]);
});
