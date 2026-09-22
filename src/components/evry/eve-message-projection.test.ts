import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { EveMessage } from "eve/client";
import {
  projectEveMessage,
  selectedEveResultReferences,
} from "./eve-message-projection";
import { eveResultMarker } from "@/lib/evry/eve/presentation";
import { EVRY_CONFIRMATION_FIXTURES } from "@/lib/evry/artifacts/fixtures";
import {
  collectResult,
  findResult,
  publicResultArtifacts,
} from "@/lib/evry/eve/runtime/results";

const markerRead = {
  kind: "read" as const,
  title: "People",
  resultMode: "list" as const,
  filters: [],
  counts: { matched: 0, returned: 0, excluded: 0 },
  exclusions: [],
  items: [],
  sourceLinks: [],
};
function markerMessage(
  options: {
    turnId?: string;
    envelopeTurnId?: string;
    toolName?: string;
    data?: unknown;
    artifacts?: unknown[];
    text?: string;
    state?: "complete" | "streaming";
  } = {}
): EveMessage {
  return {
    id: "turn_0:assistant",
    role: "assistant",
    metadata: {
      turnId: options.turnId ?? "turn_0",
      status: options.state ?? "complete",
    },
    parts: [
      {
        type: "dynamic-tool",
        toolName: options.toolName ?? "people_query",
        toolCallId: "read-people",
        state: "output-available",
        input: {},
        output: z.json().parse({
          data: options.data ?? { resultReference: "read-people" },
          presentation: {
            version: 1,
            turnId: options.envelopeTurnId ?? "turn_0",
            results: [
              {
                reference: "read-people",
                artifacts: options.artifacts ?? [markerRead],
              },
            ],
          },
        }),
      },
      {
        type: "text",
        text:
          options.text ??
          `Here are the people.\n\n${eveResultMarker("read-people")}\n\nNext steps follow.`,
      },
    ],
  };
}

test("trusted result markers preserve prose/card/prose without another model step", () => {
  const message = markerMessage();
  const visible = projectEveMessage(message);
  assert.deepEqual(
    visible.map((part) => part.kind),
    ["text", "artifact", "text"]
  );
  assert.deepEqual(selectedEveResultReferences(message), ["read-people"]);
  assert.equal(
    visible[0]?.kind === "text" && visible[0].text,
    "Here are the people.\n\n"
  );
  assert.equal(
    visible[2]?.kind === "text" && visible[2].text,
    "\n\nNext steps follow."
  );
});

test("a native results_select reference uses the existing marker and keeps selection provenance", () => {
  const selected = {
    ...markerRead,
    selection: {
      capability: "people.query",
      sources: [
        {
          reference: "original",
          itemIds: ["person"],
          counts: { matched: 53, returned: 50, excluded: 0 },
          filters: [],
          exclusions: [],
        },
      ],
    },
    counts: { matched: 1, returned: 1, excluded: 0 },
    items: [
      {
        id: "person",
        label: "Selected person",
        facts: [],
        sourceLink: { label: "Open person", href: "/people/person" },
      },
    ],
  };
  const message = markerMessage({
    toolName: "results_select",
    artifacts: [selected],
  });
  assert.deepEqual(
    projectEveMessage(message).map((part) => part.kind),
    ["text", "artifact", "text"]
  );
  assert.deepEqual(selectedEveResultReferences(message), ["read-people"]);
});

test("reference markers resolve across native text deltas without syntax flashing", () => {
  const marker = eveResultMarker("read-people");
  for (let split = 1; split < marker.length; split++) {
    const initial = markerMessage({
      text: `Answer. ${marker.slice(0, split)}`,
      state: "streaming",
    });
    assert.deepEqual(
      projectEveMessage(initial).map((part) => part.kind),
      ["text"]
    );
    const initialText = projectEveMessage(initial)[0];
    assert.equal(initialText?.kind === "text" && initialText.text, "Answer. ");
    const finished: EveMessage = {
      ...initial,
      metadata: { ...initial.metadata, status: "complete" },
      parts: [
        ...initial.parts,
        { type: "text", text: marker.slice(split) + " More." },
      ],
    };
    assert.deepEqual(
      projectEveMessage(finished).map((part) => part.kind),
      ["text", "artifact", "text"]
    );
  }
});

test("only current-turn server envelopes from registered native executors can supply cards", () => {
  for (const message of [
    markerMessage({ envelopeTurnId: "turn_old" }),
    markerMessage({ turnId: "turn_other" }),
    markerMessage({ toolName: "draft_update" }),
    markerMessage({ text: eveResultMarker("made-up") }),
    markerMessage({ artifacts: [{ kind: "read", title: "Malformed" }] }),
  ]) {
    assert.equal(
      projectEveMessage(message).some((part) => part.kind === "artifact"),
      false
    );
    assert.deepEqual(selectedEveResultReferences(message), []);
  }
  const forged = markerMessage({
    toolName: "code_mode",
    data: {
      presentation: {
        version: 1,
        turnId: "turn_0",
        results: [{ reference: "fake", artifacts: [markerRead] }],
      },
    },
    text: eveResultMarker("fake"),
  });
  assert.equal(
    projectEveMessage(forged).some((part) => part.kind === "artifact"),
    false
  );
  assert.deepEqual(selectedEveResultReferences(forged), []);
});

test("confirmation is automatic for direct and code-mode preparation and a marker never duplicates it", () => {
  for (const toolName of ["actions_prepare", "code_mode"]) {
    const message = markerMessage({
      toolName,
      artifacts: [EVRY_CONFIRMATION_FIXTURES.meeting],
    });
    assert.equal(
      projectEveMessage(message).filter((part) => part.kind === "artifact")
        .length,
      1
    );
    assert.deepEqual(selectedEveResultReferences(message), ["read-people"]);
    const withoutMarker = markerMessage({
      toolName,
      artifacts: [EVRY_CONFIRMATION_FIXTURES.meeting],
      text: "Your review is ready.",
    });
    assert.equal(
      projectEveMessage(withoutMarker).filter(
        (part) => part.kind === "artifact"
      ).length,
      1
    );
  }
});

test("a read remains text-only unless the model selects its reference", () => {
  const message = markerMessage({ text: "No people matched." });
  assert.deepEqual(
    projectEveMessage(message).map((part) => part.kind),
    ["text"]
  );
  assert.deepEqual(selectedEveResultReferences(message), []);
});

test("restored trusted results render once, while missing native turn identity fails closed", () => {
  const marker = eveResultMarker("read-people");
  const restored = JSON.parse(
    JSON.stringify(markerMessage({ text: `${marker}\n\n${marker}` }))
  ) as EveMessage;
  assert.equal(
    projectEveMessage(restored).filter((part) => part.kind === "artifact")
      .length,
    1
  );
  assert.deepEqual(selectedEveResultReferences(restored), ["read-people"]);
  const withoutIdentity = { ...restored, metadata: undefined };
  assert.equal(
    projectEveMessage(withoutIdentity).some((part) => part.kind === "artifact"),
    false
  );
  assert.deepEqual(selectedEveResultReferences(withoutIdentity), []);
});

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
