import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  bindContentActionTurns,
  contentActionFixtureIds,
  observedPeopleCsvFacts,
  observedBookmarkPlanFacts,
  peopleReviewCsv,
  peopleReviewUpload,
} from "./content-actions";

const attachment = {
  attachmentId: "att_fixture-review",
  attachmentDigest: "a".repeat(64),
};
function csvCall(): CapturedCall {
  return {
    id: "csv",
    name: "files.inspect",
    input: { attachmentId: attachment.attachmentId },
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
                    value: "Add a first name.",
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
  const bound = bindContentActionTurns(m, turns);
  assert.equal(bound[0], turns[0]);
  assert.equal(bound.length, 2);
  assert.equal(
    bound[1],
    "Here is the People CSV. Review only. Do not import any rows."
  );
  assert.deepEqual(
    bindContentActionTurns(createFixtureManifest("wiki-06", 0), [
      "Bookmark it.",
    ]),
    ["Bookmark it."]
  );
});
test("CSV upload declares exact fixture bytes on the explicit attachment turn", () => {
  const m = createFixtureManifest("documents-06", 0);
  const upload = peopleReviewUpload(m);
  assert.deepEqual(upload, {
    turnIndex: 1,
    kind: "people_csv",
    name: "people-review.csv",
    contentType: "text/csv",
    bytesBase64: peopleReviewCsv(m).toString("base64"),
    personId: null,
  });
  const bytes = Buffer.from(upload.bytesBase64, "base64");
  assert.equal(bytes.toString("base64"), upload.bytesBase64);
  assert.deepEqual(bytes, peopleReviewCsv(m));
  const turns = bindContentActionTurns(
    m,
    questions.find((q) => q.id === m.caseId)!.turns
  );
  assert.ok(upload.turnIndex < turns.length);
  for (const value of [
    upload.bytesBase64,
    createHash("sha256").update(bytes).digest("hex"),
    attachment.attachmentId,
  ]) {
    assert.ok(!turns.join("\n").includes(value));
  }
});
test("CSV facts require the exact bytes binding and all rows, regardless of card choice", () => {
  const call = csvCall(),
    facts = observedPeopleCsvFacts([call], attachment);
  assert.deepEqual(facts.facts.missingNameRows, ["csv-row-3"]);
  assert.deepEqual(facts.facts.mergeTargets, ["csv-row-2:Ada Existing"]);
  assert.deepEqual(facts.facts.rowErrors, ["csv-row-3:Add a first name."]);
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
      [
        {
          ...call,
          input: {
            attachmentReference: "old-signed-reference",
            attachmentDigest: attachment.attachmentDigest,
          },
        },
      ],
      attachment
    ).facts,
    {}
  );
  assert.deepEqual(
    observedPeopleCsvFacts(
      [
        {
          ...call,
          input: { attachmentId: "att_another-file" },
        },
      ],
      attachment
    ).facts,
    {}
  );
  assert.equal(
    observedPeopleCsvFacts(
      [
        {
          ...call,
          input: {
            attachmentId: attachment.attachmentId,
            attachmentDigest: "b".repeat(64),
          },
        },
      ],
      attachment
    ).facts.attachmentDigest,
    attachment.attachmentDigest,
    "A model-supplied digest cannot replace the host-verified byte binding"
  );
  assert.deepEqual(
    observedPeopleCsvFacts(
      [
        call,
        { ...call, id: "new-inspection", output: { status: "unavailable" } },
      ],
      attachment
    ).facts,
    {},
    "A later failed inspection cannot borrow an older successful result"
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
