import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import {
  bindDocumentReviewTurns,
  documentReviewFixtureIds,
  documentReviewFiles,
  observedDocumentReviewFacts,
} from "./document-review";
import type { CapturedCall } from "./host-capture";

const read = (
  id: string,
  text: string,
  offset = 0,
  next: number | null = null
) =>
  ({
    id: `read-${id}-${offset}`,
    name: "documents.read",
    input: { ids: [id], offset },
    output: {
      kind: "read",
      counts: { matched: 1 },
      items: [
        {
          id,
          label: "Agenda",
          sourceLink: { href: `/api/documents/history/${id}` },
          facts: [
            { label: "Extracted content", value: text },
            {
              label: "Citation range",
              value: `Extracted characters ${offset + 1}-${offset + text.length}`,
            },
            {
              label: "Next offset",
              value: next === null ? "End of extracted content" : String(next),
            },
            {
              label: "Extraction completeness",
              value: "Complete text extraction",
            },
          ],
        },
      ],
    },
  }) satisfies CapturedCall;
test("document fixtures preserve the original questions and explicitly supply the requested references", () => {
  assert.deepEqual(
    documentReviewFixtureIds.map(
      (id) => questions.find((q) => q.id === id)?.turns
    ),
    [
      ["Download the newest meeting agenda we generated."],
      ["Compare the agendas in these two generated documents."],
    ]
  );
  const original = questions.find((q) => q.id === "documents-04")!.turns;
  const turns = bindDocumentReviewTurns(
    createFixtureManifest("documents-04", 0),
    original
  );
  assert.equal(turns[0], original[0]);
  assert.equal(turns.length, 2);
  assert.match(
    turns[1]!,
    /These are the two generated documents: \/api\/documents\/history\//
  );
  const files = documentReviewFiles(createFixtureManifest("documents-04", 0));
  assert.equal(files.find((f) => f.name === "agenda-a")?.body[0], 80);
  assert.equal(
    new TextDecoder()
      .decode(files.find((f) => f.name === "agenda-b")?.body)
      .slice(0, 8),
    "%PDF-1.4"
  );
});
test("only full file evidence with complete contiguous offsets can establish a comparison", () => {
  const initial = "[Paragraph 1]\nWelcome";
  const first = read("a", initial, 0, initial.length + 1);
  const page = read("a", initial, 0, initial.length);
  const final = read("a", " and pray.", initial.length);
  const other = read("b", "[Page 1]\nDiscussion");
  const observe = (calls: CapturedCall[]) =>
    observedDocumentReviewFacts("documents-04", calls);
  assert.deepEqual(observe([page]), { facts: {}, evidence: [] });
  assert.deepEqual(observe([final]), { facts: {}, evidence: [] });
  assert.deepEqual(observe([first, final]), { facts: {}, evidence: [] });
  const complete = observe([page, final, other]);
  assert.deepEqual(complete.facts.documentIds, ["a", "b"]);
  assert.ok(Array.isArray(complete.facts.contentDigests));
  assert.ok(
    complete.facts.contentDigests.includes(
      `a:${createHash("sha256")
        .update(initial + " and pray.")
        .digest("hex")}`
    )
  );
  assert.deepEqual(observe([page, final, final, other]), {
    facts: {},
    evidence: [],
  });
  assert.deepEqual(observe([page, final, other, page, final]), complete);
});
test("metadata-only evidence cannot stand in for contents or citations", () => {
  assert.deepEqual(
    observedDocumentReviewFacts("documents-04", [
      { ...read("a", "Title only"), name: "documents.query" },
    ]),
    { facts: {}, evidence: [] }
  );
  const missingCitation = read("a", "Welcome");
  const output = missingCitation.output;
  output.items[0]!.facts = output.items[0]!.facts.filter(
    (fact) => fact.label !== "Citation range"
  );
  assert.deepEqual(
    observedDocumentReviewFacts("documents-04", [missingCitation]),
    { facts: {}, evidence: [] }
  );
});

test("newest-agenda evidence can come from a broader newest-first metadata page", () => {
  const item = (id: string, template: string) => ({
    id,
    label: template,
    sourceLink: { href: `/api/documents/history/${id}` },
    facts: [{ label: "Template ID", value: template }],
  });
  const query = (items: ReturnType<typeof item>[]): CapturedCall => ({
    id: "metadata",
    name: "documents.query",
    input: { query: { resource: "generated" } },
    output: { kind: "read", counts: { matched: items.length }, items },
  });
  const newest = item("newest", "vision-meeting-agenda");
  const narrow = observedDocumentReviewFacts("documents-03", [query([newest])]);
  assert.deepEqual(
    observedDocumentReviewFacts("documents-03", [
      query([
        item("newer-form", "commitment-card"),
        newest,
        item("older", "board-meeting-agenda"),
      ]),
    ]),
    narrow
  );
  assert.deepEqual(narrow.facts.documentIds, ["newest"]);
  assert.notDeepEqual(
    observedDocumentReviewFacts("documents-03", [
      query([item("older", "board-meeting-agenda")]),
    ]).facts.documentIds,
    narrow.facts.documentIds
  );
});
