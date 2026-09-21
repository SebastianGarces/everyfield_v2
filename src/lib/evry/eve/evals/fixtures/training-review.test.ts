import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import {
  trainingReviewFixtureIds,
  observedTrainingReviewFacts,
} from "./training-review";

const item = (person: string, program: string, completed = false) => ({
  id: `${person}:${program}`,
  label: `${person} · ${program}`,
  facts: [
    { label: "Person ID", value: person },
    { label: "Training program ID", value: program },
    { label: "Required", value: "Yes" },
    {
      label: "Completion",
      value: completed ? "Completed" : "No completion recorded",
    },
  ],
});
const call = (
  items = [item("alex", "welcome")],
  cursor?: string,
  total = items.length
): CapturedCall => ({
  id: `page-${cursor ?? 0}`,
  name: "training.query",
  input: {
    request: {
      resource: "requirements",
      query: { mode: "list", limit: 1, ...(cursor ? { cursor } : {}) },
    },
  },
  output: { kind: "read", counts: { matched: total }, items },
});
test("training fixture questions are the unchanged corpus questions", () => {
  assert.deepEqual(
    trainingReviewFixtureIds.map(
      (id) => questions.find((q) => q.id === id)?.turns
    ),
    [
      ["Who is missing required training for their current ministry role?"],
      ["What training do Alex and Jordan still need?"],
    ]
  );
});
test("explicit completion, not enrollment or presentation, distinguishes missing requirements", () => {
  const reads = [
    call([item("alex", "welcome", true), item("jordan", "welcome")]),
  ];
  const result = observedTrainingReviewFacts("training-03", reads);
  assert.deepEqual(result, {
    facts: { missingPairs: ["jordan:welcome"], personIds: ["jordan"] },
    evidence: ["recorded:training-03"],
  });
  assert.deepEqual(
    result,
    observedTrainingReviewFacts("training-03", reads, new Set(["page-0"]))
  );
  const enrolled = item("alex", "welcome");
  enrolled.facts[3].value = "Enrolled";
  assert.deepEqual(
    observedTrainingReviewFacts("training-03", [call([enrolled])]),
    { facts: {}, evidence: [] }
  );
});
test("requirements must be fully paged with identical filters and unique pairs", () => {
  const a = call([item("alex", "welcome")], undefined, 2),
    b = call([item("jordan", "welcome")], "1", 2);
  const observe = (calls: CapturedCall[]) =>
    observedTrainingReviewFacts("training-01", calls);
  assert.deepEqual(observe([a]), { facts: {}, evidence: [] });
  assert.deepEqual(observe([a, b]).facts.personIds, ["alex", "jordan"]);
  assert.deepEqual(observe([a, b, a, b]), observe([a, b]));
  assert.deepEqual(observe([a, b, b]), { facts: {}, evidence: [] });
  assert.deepEqual(observe([a, call([item("alex", "welcome")], "1", 2)]), {
    facts: {},
    evidence: [],
  });
});
test("optional courses, completions-only and missing IDs do not establish required missing training", () => {
  const optional = item("alex", "welcome");
  optional.facts[2].value = "No";
  const noId = item("alex", "welcome");
  noId.facts = noId.facts.filter((f) => f.label !== "Training program ID");
  for (const c of [
    call([optional]),
    call([noId]),
    {
      ...call(),
      input: { request: { resource: "completions", query: { mode: "list" } } },
    },
  ])
    assert.deepEqual(observedTrainingReviewFacts("training-01", [c]), {
      facts: {},
      evidence: [],
    });
});
