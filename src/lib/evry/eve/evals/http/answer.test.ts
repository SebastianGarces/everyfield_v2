import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureMessageSchema } from "./transcript";
import { projectHttpEvalAnswer } from "./runner";

function message(parts: unknown[], role = "assistant") {
  return fixtureMessageSchema.parse({
    id: `${role}-0`,
    role,
    metadata: { turnId: "turn-0", status: "complete" },
    parts,
  });
}
function question(
  kind: "question" | "session-limit" | "tool-approval",
  prompt = "Which Alex do you mean?"
) {
  return {
    type: "dynamic-tool",
    toolName: "ask_question",
    toolCallId: "choice",
    state: "approval-requested",
    input: { prompt },
    approval: { id: "choice" },
    toolMetadata: {
      eve: {
        kind: "tool-call",
        name: "ask_question",
        inputRequest: {
          requestId: "choice",
          kind,
          prompt,
          allowFreeform: true,
        },
      },
    },
  };
}
test("a visible native clarification is an answer without needing separate prose", () => {
  assert.equal(
    projectHttpEvalAnswer([message([question("question")])]),
    "Which Alex do you mean?"
  );
});
test("native question projection does not duplicate identical prose or remove distinct prose", () => {
  assert.equal(
    projectHttpEvalAnswer([
      message([
        { type: "text", text: "Which Alex do you mean?" },
        question("question"),
      ]),
    ]),
    "Which Alex do you mean?"
  );
  assert.equal(
    projectHttpEvalAnswer([
      message([
        { type: "text", text: "I found two people named Alex." },
        question("question"),
      ]),
    ]),
    "I found two people named Alex.\n\nWhich Alex do you mean?"
  );
});
test("status, reasoning, tools, usage controls, approval requests and user text are not answers", () => {
  assert.equal(
    projectHttpEvalAnswer([
      message([{ type: "text", text: "Find Alex" }], "user"),
      message([
        { type: "reasoning", text: "Private reasoning" },
        {
          type: "dynamic-tool",
          toolName: "people.query",
          toolCallId: "read",
          state: "output-available",
          input: {},
          output: { status: "Thinking", text: "Internal tool output" },
        },
        question("session-limit", "Continue spending?"),
        question("tool-approval", "Authorize this tool?"),
      ]),
      message([]),
    ]),
    ""
  );
});
