import assert from "node:assert/strict";
import { test } from "node:test";
import type { EveMessage } from "eve/client";
import { projectEveMessage } from "./eve-message-projection";

test("reasoning, code output and ordinary retrievals never leak debug data into chat", () => {
  const message: EveMessage = { id: "reply", role: "assistant", parts: [
    { type: "reasoning", text: "private reasoning" },
    { type: "text", text: "Here is the answer." },
    { type: "dynamic-tool", toolCallId: "read", toolName: "capability__people_query", state: "output-available", input: {}, output: { internalField: "not UI" } },
    { type: "dynamic-tool", toolCallId: "code", toolName: "code_mode", state: "output-available", input: {}, output: { output: { debug: "not UI" } } },
  ] };
  assert.deepEqual(projectEveMessage(message).map((part) => part.kind), ["text"]);
});

test("text stays ordered across streamed step boundaries", () => {
  const message: EveMessage = { id: "reply", role: "assistant", parts: [
    { type: "text", text: "**Launch** is coming up.\n\n" },
    { type: "step-start" },
    { type: "text", text: "Five milestones remain." },
  ] };
  assert.deepEqual(projectEveMessage(message), [{ kind: "text", text: "**Launch** is coming up.\n\nFive milestones remain.", key: "reply:0" }]);
});
