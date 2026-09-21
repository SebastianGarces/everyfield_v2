import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  bindContentActionTurns,
  contentActionFixtureIds,
  observedPeopleCsvFacts,
  observedBookmarkPlanFacts,
} from "./content-actions";

const attachment = {
  attachmentReference: "host-created-signed-reference",
  attachmentDigest: "a".repeat(64),
};
function csvCall(): CapturedCall {
  return {
    id: "csv",
    name: "files.inspect",
    input: attachment,
    output: {
      kind: "read",
      counts: { matched: 5, returned: 5, excluded: 0 },
      exclusions: [],
      items: [
        {
          id: "csv-row-2",
          label: "Ada",
          facts: [
            { label: "Status", value: "Duplicate review" },
            { label: "Merge target", value: "Ada Existing" },
          ],
        },
        ...[3, 4, 5, 6].map((n) => ({
          id: `csv-row-${n}`,
          label: `Row ${n}`,
          facts: [
            { label: "Status", value: n === 3 ? "Invalid" : "Valid" },
            ...(n === 3
              ? [
                  {
                    label: "Needs attention",
                    value:
                      "firstName: Invalid input: expected string, received undefined",
                  },
                ]
              : []),
          ],
        })),
      ],
    },
  };
}
test("unchanged original prompts gain an explicit attachment turn, never a hidden file", () => {
  assert.deepEqual(
    contentActionFixtureIds.map(
      (id) => questions.find((q) => q.id === id)?.turns
    ),
    [
      ["Review this People CSV for duplicate records and missing names."],
      ["Bookmark the orientation preparation article."],
    ]
  );
  const m = createFixtureManifest("documents-06", 0),
    turns = questions.find((q) => q.id === m.caseId)!.turns;
  assert.throws(() => bindContentActionTurns(m, turns), /requires an attached/);
  const bound = bindContentActionTurns(m, turns, attachment);
  assert.equal(bound[0], turns[0]);
  assert.equal(bound.length, 2);
  assert.match(bound[1]!, /Do not import/);
});
test("CSV facts require the exact bytes binding and all rows, regardless of card choice", () => {
  const call = csvCall(),
    facts = observedPeopleCsvFacts([call], attachment);
  assert.deepEqual(facts.facts.missingNameRows, ["csv-row-3"]);
  assert.deepEqual(facts.facts.mergeTargets, ["csv-row-2:Ada Existing"]);
  assert.deepEqual(facts.facts.rowErrors, [
    "csv-row-3:firstName: Invalid input: expected string, received undefined",
  ]);
  const original = call.output as {
    items: { facts: { label: string; value: string }[] }[];
  };
  const oldCounts = {
    ...call,
    output: {
      ...original,
      counts: { matched: 6, returned: 5, excluded: 1 },
      exclusions: [{ reason: "Row 3: First name is required", count: 1 }],
    },
  };
  assert.deepEqual(observedPeopleCsvFacts([oldCounts], attachment).facts, {});
  const wrongError = structuredClone(call);
  const wrongOutput = wrongError.output as typeof original;
  wrongOutput.items[1]!.facts = [
    { label: "Status", value: "Invalid" },
    { label: "Needs attention", value: "email: Invalid address" },
  ];
  assert.notDeepEqual(
    observedPeopleCsvFacts([wrongError], attachment).facts.rowErrors,
    facts.facts.rowErrors
  );
  assert.deepEqual(
    observedPeopleCsvFacts([wrongError], attachment).facts.missingNameRows,
    []
  );
  assert.deepEqual(
    observedPeopleCsvFacts(
      [{ ...call, input: { ...attachment, attachmentDigest: "b".repeat(64) } }],
      attachment
    ).facts,
    {}
  );
  assert.deepEqual(
    observedPeopleCsvFacts(
      [
        {
          ...call,
          input: { ...attachment, attachmentReference: "another-reference" },
        },
      ],
      attachment
    ).facts,
    {}
  );
  const output = call.output as { items: unknown[] };
  assert.deepEqual(
    observedPeopleCsvFacts(
      [{ ...call, output: { ...output, items: output.items.slice(0, 4) } }],
      attachment
    ).facts,
    {}
  );
  assert.deepEqual(
    observedPeopleCsvFacts(
      [
        {
          ...call,
          output: {
            ...output,
            items: [...output.items.slice(0, 4), output.items[0]],
          },
        },
      ],
      attachment
    ).facts,
    {}
  );
});
test("a guessed plan or prose-only bookmark promise cannot establish a reviewed persisted plan", async () => {
  const store = {
    query() {
      throw new Error("No DB call expected");
    },
  };
  assert.deepEqual(
    (
      await observedBookmarkPlanFacts(
        createFixtureManifest("wiki-06", 0),
        store,
        [],
        new Set()
      )
    ).facts,
    {}
  );
  assert.deepEqual(
    (
      await observedBookmarkPlanFacts(
        createFixtureManifest("wiki-06", 0),
        store,
        [
          {
            id: "prepare",
            name: "actions.prepare",
            input: {},
            output: { status: "prepared" },
          },
        ],
        new Set(["prepare"])
      )
    ).facts,
    {}
  );
});
