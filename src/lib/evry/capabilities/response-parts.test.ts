import assert from "node:assert/strict";
import test from "node:test";
import { composeEvryResponse, storedEvryResponse } from "./response-parts";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import { hydrateStoredEvryConversationArtifact } from "@/lib/evry/conversations/artifacts";
import { publicEvryArtifact } from "@/lib/evry/artifacts/public";
import { evryResponseContent } from "@/components/evry/response-content";
import { EVRY_READ_BUDGET } from "./read-budget";

const result = buildEvryReadArtifact({
  title: "Tasks",
  filters: [],
  exclusions: [],
  items: [],
  sourceLinks: [
    trustedEvryApplicationSourceLink({ label: "Open Tasks", href: "/tasks" }),
  ],
});
const text = (text: string) => ({ kind: "text", text, resultIndex: null });
const card = (resultIndex: number) => ({
  kind: "result",
  text: "",
  resultIndex,
});

test("text and trusted results survive storage and public projection in their original order", () => {
  const composed = composeEvryResponse(
    {
      parts: [
        text("  Today.\n\n"),
        card(0),
        text("Overdue.\n\n"),
        card(1),
        text("Choose what to do next.  "),
      ],
    },
    [result, { ...result, title: "Overdue tasks" }]
  );
  const stored = storedEvryResponse(composed);
  const artifacts = stored.artifacts.map((document) => ({
    artifact: publicEvryArtifact(
      hydrateStoredEvryConversationArtifact(document)
    ),
  }));
  const parts = evryResponseContent(stored.body, artifacts);
  assert.deepEqual(
    parts.map((part) =>
      part.kind === "text" ? part.text : part.entry.artifact.kind
    ),
    ["Today.\n\n", "read", "Overdue.\n\n", "read", "Choose what to do next."]
  );
});

test("old history, text-only replies, and optional result components remain supported", () => {
  assert.deepEqual(evryResponseContent("Hello", []), [
    { kind: "text", text: "Hello" },
  ]);
  assert.deepEqual(
    evryResponseContent("Old answer", [
      { artifact: publicEvryArtifact(result) },
    ]).map((part) => part.kind),
    ["text", "artifact"]
  );
  assert.equal(
    composeEvryResponse({ parts: [text("No tasks are due today.")] }, [result])
      .artifacts.length,
    0
  );
});

test("the model cannot inject card data, unknown or repeated references, or an empty answer", () => {
  for (const parts of [
    [card(1), text("Hello")],
    [card(0), card(0), text("Hello")],
    [card(0)],
    [{ ...text("Hello"), resultIndex: 0 }],
    [{ ...card(0), href: "https://evil.example" }, text("Hello")],
  ]) {
    assert.throws(() => composeEvryResponse({ parts }, [result]));
  }
});

for (const count of [5, EVRY_READ_BUDGET.calls]) {
  test(`${count} composed results preserve prose, persistence, public projection and layout`, () => {
    const results = Array.from({ length: count }, (_, i) => ({
      ...result,
      title: `Evidence ${i + 1}`,
    }));
    const parts = results.flatMap((_, i) => [
      text(`Explanation ${i + 1}.\n\n`),
      card(i),
    ]);
    parts.push(text("That is the complete review."));
    const composed = composeEvryResponse({ parts }, results);
    const stored = storedEvryResponse(composed);
    const artifacts = stored.artifacts.map((document) => ({
      artifact: publicEvryArtifact(
        hydrateStoredEvryConversationArtifact(
          JSON.parse(JSON.stringify(document))
        )
      ),
    }));
    assert.equal(stored.artifacts.length, count);
    const layout = evryResponseContent(stored.body, artifacts);
    assert.equal(layout.length, count * 2 + 1);
    assert.deepEqual(
      layout
        .filter((part) => part.kind === "artifact")
        .map((part) =>
          part.entry.artifact.kind === "read" ? part.entry.artifact.title : null
        ),
      results.map((result) => result.title)
    );
    const last = layout.at(-1);
    assert.equal(
      last?.kind === "text" ? last.text : null,
      "That is the complete review."
    );
  });
}

test("a ninth result reference remains outside the read budget", () => {
  assert.throws(() =>
    composeEvryResponse(
      { parts: [text("Review"), card(EVRY_READ_BUDGET.calls)] },
      Array(EVRY_READ_BUDGET.calls + 1).fill(result)
    )
  );
});
