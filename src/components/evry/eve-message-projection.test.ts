import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { EveMessage } from "eve/client";
import { projectEveMessage } from "./eve-message-projection";
import { EVRY_CONFIRMATION_FIXTURES } from "@/lib/evry/artifacts/fixtures";
import {
  collectResult,
  findResult,
  publicResultArtifacts,
} from "@/lib/evry/eve/runtime/results";

test("native Eve action preparation exposes its exact review without a presentation call", () => {
  const review = EVRY_CONFIRMATION_FIXTURES.meeting;
  const message: EveMessage = {
    id: "prepared-reply",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "prepare",
        toolName: "actions_prepare",
        state: "output-available",
        input: {},
        output: z.json().parse({ artifacts: [review] }),
      },
    ],
  };
  const visible = projectEveMessage(message);
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.kind, "artifact");
  if (visible[0]?.kind === "artifact")
    assert.deepEqual(visible[0].artifact, review);
});

test("nested preparation reviews are presented only through authorized references and are not duplicated", () => {
  const review = EVRY_CONFIRMATION_FIXTURES.meeting;
  const entry = {
    reference: "prepare-call",
    turnId: "turn",
    capability: "code_mode",
  };
  const payload = z.json().parse({ artifacts: [review] });
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
        toolName: "people_query",
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

test("internal evidence is preserved for the model but removed from result cards", () => {
  const read = z.json().parse({
    kind: "read",
    title: "Tasks",
    filters: [],
    exclusions: [],
    counts: { matched: 1, returned: 1, excluded: 0 },
    items: [
      {
        id: "task",
        label: "Prepare orientation",
        sourceLink: { label: "Task", href: "/tasks" },
        facts: [
          { label: "Priority", value: "High" },
          { label: "Evidence", value: "internal fact", modelOnly: true },
        ],
      },
    ],
    sourceLinks: [],
  });
  const records = collectResult(
    [],
    { reference: "read", turnId: "turn", capability: "tasks.query" },
    read
  );
  const projected = projectEveMessage({
    id: "reply",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "show",
        toolName: "present_result",
        state: "output-available",
        input: {},
        output: { artifacts: publicResultArtifacts(records[0]!.artifacts) },
      },
    ],
  });
  assert.equal(projected[0]?.kind, "artifact");
  assert.ok(!JSON.stringify(projected).includes("internal fact"));
  assert.ok(JSON.stringify(records).includes("internal fact"));
});

test("session usage pauses remain visible and cannot be treated as ordinary clarification answers", () => {
  const parts = projectEveMessage({
    id: "reply",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "limit",
        toolName: "session_limit_continuation",
        state: "approval-requested",
        input: { kind: "input", limit: 300000, usedTokens: 306689 },
        approval: { id: "limit" },
        toolMetadata: {
          eve: {
            kind: "tool-call",
            name: "session_limit_continuation",
            inputRequest: {
              kind: "session-limit",
              requestId: "limit",
              prompt: "SDK usage limit",
              allowFreeform: false,
              options: [
                { id: "continue", label: "Approve" },
                { id: "stop", label: "Stop" },
              ],
            },
          },
        },
      },
    ],
  });
  assert.equal(parts[0]?.kind, "session-limit");
  assert.equal(
    parts.some((part) => part.kind === "question"),
    false
  );
});

test("text from separate model steps does not run into the previous sentence", () => {
  const parts = projectEveMessage({
    id: "reply",
    role: "assistant",
    parts: [
      { type: "text", text: "Launch is on **October 11, 2026**" },
      { type: "step-start" },
      { type: "text", text: "You have five milestones left." },
    ],
  });
  assert.equal(
    parts[0]?.kind === "text" && parts[0].text,
    "Launch is on **October 11, 2026**\n\nYou have five milestones left."
  );
});

test("a malformed selected card shows a safe error instead of silently disappearing", () => {
  const parts = projectEveMessage({
    id: "reply",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "show",
        toolName: "present_result",
        state: "output-available",
        input: {},
        output: { artifacts: [{ secret: "never display" }] },
      },
    ],
  });
  assert.equal(parts[0]?.kind, "text");
  assert.ok(!JSON.stringify(parts).includes("never display"));
});
