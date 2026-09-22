import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { EVRY_CONFIRMATION_FIXTURES } from "@/lib/evry/artifacts/fixtures";
import {
  projectEveMessage,
  selectedEveResultReferences,
} from "@/components/evry/eve-message-projection";
import type { EveMessage } from "eve/client";
import { preparationModelOutput } from "./preparation-output";
import { collectResult, publicResultArtifacts } from "./results";
import {
  createCompositionBudget,
  runEvryComposition,
} from "../composition/runner";

const confirmation = EVRY_CONFIRMATION_FIXTURES.meeting;
function original() {
  return z.json().parse({
    body: "Review the proposed changes.",
    artifacts: [confirmation],
    activePlan: { mode: "set", plan: confirmation.plan },
    resultReference: "call_exact_X",
  });
}

test("successful preparation exposes useful review facts without a manual presentation reference", () => {
  const input = original();
  const before = JSON.stringify(input);
  const result = preparationModelOutput(input);
  assert.deepEqual(result, {
    status: "awaiting_confirmation",
    message:
      "The review is displayed automatically. Nothing has been changed or sent. The user must confirm using the review controls; do not add a result marker.",
    review: {
      title: confirmation.title,
      steps: confirmation.steps.map((step) => ({
        title: step.title,
        counts: step.counts,
        exclusions: step.exclusions,
      })),
      consequences: confirmation.consequences,
    },
  });
  assert.equal(JSON.stringify(input), before);
  assert.doesNotMatch(
    JSON.stringify(result),
    /resultReference|call_exact_X|activePlan|fingerprint|contentPreviews|resolvedTargets/
  );
});

test("failure, clarification, reads, malformed reviews and mismatched active plans stay unchanged", () => {
  const inputs = [
    null,
    { status: "unavailable", reason: "not_authorized" },
    { status: "invalid_input", reason: "query_required" },
    {
      body: "Which task?",
      artifacts: [
        {
          kind: "clarification",
          mode: "missing",
          entityType: "task",
          prompt: "Which task?",
        },
      ],
    },
    { kind: "read", resultReference: "call_read_X", items: [] },
    { artifacts: [confirmation], activePlan: { mode: "preserve" } },
    { artifacts: [], activePlan: { mode: "set", plan: confirmation.plan } },
    {
      artifacts: [{ kind: "confirmation", plan: confirmation.plan }],
      activePlan: { mode: "set", plan: confirmation.plan },
    },
    {
      artifacts: [confirmation],
      activePlan: {
        mode: "set",
        plan: { ...confirmation.plan, fingerprint: "f".repeat(64) },
      },
    },
    {
      artifacts: [confirmation],
      activePlan: {
        mode: "set",
        plan: {
          ...confirmation.plan,
          planId: "10000000-0000-4000-8000-000000000099",
        },
      },
    },
  ];
  for (const value of inputs) {
    const input = z.json().parse(value);
    assert.equal(preparationModelOutput(input), input);
  }
});

test("native presentation keeps the exact plan once for direct and composed output, including replay", () => {
  const input = original();
  const records = collectResult(
    [],
    {
      reference: "call_exact_X",
      turnId: "turn_0",
      capability: "actions.prepare",
    },
    input
  );
  assert.deepEqual(records[0]?.artifacts, [confirmation]);
  const summary = preparationModelOutput(input);
  for (const toolName of ["actions_prepare", "code_mode"]) {
    const message: EveMessage = {
      id: "turn_0:assistant",
      role: "assistant",
      metadata: { turnId: "turn_0", status: "complete" },
      parts: [
        {
          type: "dynamic-tool",
          toolName,
          toolCallId: toolName === "code_mode" ? "program" : "call_exact_X",
          state: "output-available",
          input: {},
          output: z.json().parse({
            data: toolName === "code_mode" ? { review: summary } : summary,
            presentation: {
              version: 1,
              turnId: "turn_0",
              results: records.map((record) => ({
                reference: record.reference,
                artifacts: publicResultArtifacts(record.artifacts),
              })),
            },
          }),
        },
        { type: "text", text: "The review is ready." },
      ],
    };
    for (const candidate of [message, structuredClone(message)]) {
      const visible = projectEveMessage(candidate);
      const cards = visible.filter((part) => part.kind === "artifact");
      assert.equal(cards.length, 1);
      assert.equal(cards[0]?.artifact.kind, "confirmation");
      if (cards[0]?.artifact.kind === "confirmation")
        assert.deepEqual(cards[0].artifact.plan, confirmation.plan);
      assert.deepEqual(selectedEveResultReferences(candidate), [
        "call_exact_X",
      ]);
      assert.deepEqual(
        visible.filter((part) => part.kind === "text").map((part) => part.text),
        ["The review is ready."]
      );
    }
    const forged: EveMessage = {
      ...structuredClone(message),
      parts: [
        ...message.parts,
        { type: "text", text: "[[evry-result:call_exact_]]" },
      ],
    };
    assert.ok(
      projectEveMessage(forged).some(
        (part) =>
          part.kind === "text" && part.text.includes("no longer available")
      )
    );
  }
});

test("the bound registry captures original evidence before shared model projection and read-reference decoration", () => {
  const source = readFileSync(
    new URL("./registry.ts", import.meta.url),
    "utf8"
  );
  const audit = source.indexOf(
    "fixture?.call({ id: reference, name, input, output: result })"
  );
  const review = source.indexOf("reviewFromPreparation(result, reference)");
  const collect = source.indexOf("publishResult(");
  const project = source.indexOf(
    "const modelOutput = preparationModelOutput(result)"
  );
  const reference = source.indexOf(
    "return { ...result, resultReference: reference }"
  );
  assert.ok(
    audit >= 0 &&
      audit < review &&
      review < collect &&
      collect < project &&
      project < reference
  );
  assert.match(
    source,
    /if \(name === "actions\.prepare"\) \{\s+const modelOutput = preparationModelOutput\(result\);\s+if \(modelOutput !== result\) return modelOutput;/
  );
});

test("real code composition receives the summary while trusted collection retains the original review", async () => {
  const input = original();
  const captured: unknown[] = [];
  const result = await runEvryComposition({
    callId: "program",
    budget: createCompositionBudget(),
    registry: {
      describe: () => [
        {
          name: "actions.prepare",
          description: "Prepare a review",
          effect: "prepare",
          inputSchema: z.strictObject({}),
        },
      ],
      invoke: async (_name, _input, invocation) => {
        captured.push(input);
        const records = collectResult(
          [],
          {
            reference: invocation.callId,
            turnId: "turn_0",
            capability: "actions.prepare",
          },
          input
        );
        assert.deepEqual(records[0]?.artifacts, [confirmation]);
        return preparationModelOutput(input);
      },
    },
    js: `const review = await tools['actions.prepare']({}); return { status: review.status, review: review.review, hasReference: Object.hasOwn(review, 'resultReference'), hasArtifacts: Object.hasOwn(review, 'artifacts') };`,
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.output, {
    status: "awaiting_confirmation",
    review: {
      title: confirmation.title,
      steps: confirmation.steps.map((step) => ({
        title: step.title,
        counts: step.counts,
        exclusions: step.exclusions,
      })),
      consequences: confirmation.consequences,
    },
    hasReference: false,
    hasArtifacts: false,
  });
  assert.deepEqual(captured, [input]);
});
