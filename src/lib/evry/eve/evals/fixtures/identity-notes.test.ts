import assert from "node:assert/strict";
import { test } from "node:test";
import { questions, regressions } from "../catalog";
import {
  identityNotesFixtureIds,
  identityNotesQuestions,
  identityQuestionEvidence,
  identityNotePlanReference,
} from "./identity-notes";
import type { CapturedCall } from "./host-capture";
const people = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    first: "Alex",
    last: "Morgan",
    email: "alex.morgan@example.test",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    first: "Alex",
    last: "Reed",
    email: "alex.reed@example.test",
  },
];
function identityQuestionMessage() {
  return {
    id: "turn_0:assistant",
    role: "assistant",
    metadata: { turnId: "turn_0", status: "complete" },
    parts: [
      {
        type: "dynamic-tool",
        toolName: "ask_question",
        toolCallId: "identity",
        state: "approval-requested",
        approval: { id: "identity" },
        input: {
          prompt: "Which Alex do you mean?",
          allowFreeform: true,
          options: people.map((p) => ({
            id: p.id,
            label: `${p.first} ${p.last}`,
          })),
        },
        toolMetadata: {
          eve: {
            kind: "tool-call",
            name: "ask_question",
            inputRequest: {
              requestId: "identity",
              kind: "question",
              prompt: "Which Alex do you mean?",
              allowFreeform: true,
              display: "select",
              options: people.map((p) => ({
                id: p.id,
                label: `${p.first} ${p.last}`,
              })),
            },
          },
        },
      },
    ],
  };
}
test("identity fixtures retain every original turn without an unconditional reply", () => {
  for (const id of identityNotesFixtureIds)
    assert.deepEqual(
      [...questions, ...regressions].find((q) => q.id === id)!.turns,
      [identityNotesQuestions[id]]
    );
});
test("actual pending native identity options are necessary; question wording is not fixed", () => {
  const message = identityQuestionMessage();
  assert.equal(identityQuestionEvidence([message], people), true);
  message.parts[0]!.toolMetadata.eve.inputRequest.prompt =
    "Choose the person whose record you want to use.";
  assert.equal(identityQuestionEvidence([message], people), true);
  message.parts[0]!.toolMetadata.eve.inputRequest.options = people.map((p) => ({
    id: p.id,
    label: p.email,
  }));
  assert.equal(identityQuestionEvidence([message], people), true);
  message.parts[0]!.toolMetadata.eve.inputRequest.options.pop();
  assert.equal(identityQuestionEvidence([message], people), false);
});
test("unrelated questions, prose, wrong IDs, duplicate pending requests and resolved questions do not pass", () => {
  assert.equal(
    identityQuestionEvidence(
      [
        {
          id: "reply",
          role: "assistant",
          parts: [
            { type: "text", text: "Which Alex: Alex Morgan or Alex Reed?" },
          ],
        },
      ],
      people
    ),
    false
  );
  for (const change of [
    (m: ReturnType<typeof identityQuestionMessage>) => {
      m.parts[0]!.toolMetadata.eve.inputRequest.options = [
        { id: "x", label: "Tomorrow" },
        { id: "y", label: "Friday" },
      ];
    },
    (m: ReturnType<typeof identityQuestionMessage>) => {
      m.parts[0]!.toolMetadata.eve.inputRequest.requestId = "other";
    },
    (m: ReturnType<typeof identityQuestionMessage>) => {
      m.parts[0]!.state = "approval-responded";
    },
    (m: ReturnType<typeof identityQuestionMessage>) => {
      m.parts[0]!.toolName = "actions_prepare";
    },
  ]) {
    const m = identityQuestionMessage();
    change(m);
    assert.equal(identityQuestionEvidence([m], people), false);
  }
  assert.equal(
    identityQuestionEvidence(
      [identityQuestionMessage(), identityQuestionMessage()],
      people
    ),
    false
  );
});
test("a note plan must be the latest presented actual confirmation", () => {
  const plan = { planId: people[0]!.id, fingerprint: "a".repeat(64) };
  const c: CapturedCall = {
    id: "review",
    name: "actions.prepare",
    input: {},
    output: {
      activePlan: { mode: "set", plan },
      artifacts: [{ kind: "confirmation" }],
    },
  };
  assert.deepEqual(identityNotePlanReference([c], new Set([c.id])), plan);
  assert.equal(identityNotePlanReference([c], new Set()), null);
  assert.equal(
    identityNotePlanReference(
      [c, { ...c, id: "later", output: {} }],
      new Set([c.id, "later"])
    ),
    null
  );
});
