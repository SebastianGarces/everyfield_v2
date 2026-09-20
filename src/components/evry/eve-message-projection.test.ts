import assert from "node:assert/strict";
import { test } from "node:test";
import type { EveMessage } from "eve/client";
import { projectEveMessage } from "./eve-message-projection";
import { EVRY_CONFIRMATION_FIXTURES } from "@/lib/evry/artifacts/fixtures";
import { collectResult, findResult } from "@/lib/evry/eve/runtime/results";

test("nested preparation reviews are presented only through authorized references and are not duplicated", () => {
  const review = EVRY_CONFIRMATION_FIXTURES.meeting;
  const entry = {
    reference: "prepare-call",
    turnId: "turn",
    capability: "code_mode",
  };
  const payload = { artifacts: [review] };
  assert.deepEqual(collectResult([], entry, payload), []);
  const records = collectResult(
    [],
    { ...entry, capability: "actions.prepare" },
    payload
  );
  assert.equal(findResult(records, entry.reference, "another-turn"), undefined);
  assert.equal(
    findResult(records, "made-up-reference", entry.turnId),
    undefined
  );
  const authorized = findResult(records, entry.reference, entry.turnId)!;
  const message: EveMessage = {
    id: "reply",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "code",
        toolName: "code_mode",
        state: "output-available",
        input: {},
        output: payload,
      },
      {
        type: "dynamic-tool",
        toolCallId: "show",
        toolName: "present_result",
        state: "output-available",
        input: { reference: entry.reference },
        output: { artifacts: authorized.artifacts },
      },
      {
        type: "dynamic-tool",
        toolCallId: "show-again",
        toolName: "present_result",
        state: "output-available",
        input: { reference: entry.reference },
        output: { artifacts: authorized.artifacts },
      },
    ],
  };
  const parts = projectEveMessage(message);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "artifact");
});

test("reasoning, code output and ordinary retrievals never leak debug data into chat", () => {
  const message: EveMessage = {
    id: "reply",
    role: "assistant",
    parts: [
      { type: "reasoning", text: "private reasoning" },
      { type: "text", text: "Here is the answer." },
      {
        type: "dynamic-tool",
        toolCallId: "read",
        toolName: "capability__people_query",
        state: "output-available",
        input: {},
        output: { internalField: "not UI" },
      },
      {
        type: "dynamic-tool",
        toolCallId: "code",
        toolName: "code_mode",
        state: "output-available",
        input: {},
        output: { output: { debug: "not UI" } },
      },
    ],
  };
  assert.deepEqual(
    projectEveMessage(message).map((part) => part.kind),
    ["text"]
  );
});

test("text stays ordered across streamed step boundaries", () => {
  const message: EveMessage = {
    id: "reply",
    role: "assistant",
    parts: [
      { type: "text", text: "**Launch** is coming up.\n\n" },
      { type: "step-start" },
      { type: "text", text: "Five milestones remain." },
    ],
  };
  assert.deepEqual(projectEveMessage(message), [
    {
      kind: "text",
      text: "**Launch** is coming up.\n\nFive milestones remain.",
      key: "reply:0",
    },
  ]);
});
