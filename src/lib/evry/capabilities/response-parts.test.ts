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
