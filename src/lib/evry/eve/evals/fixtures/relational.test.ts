import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import {
  observedRelationalFacts,
  relationalFixtureIds,
  relationalId,
} from "./relational";

test("four relational bindings preserve original corpus questions", () => {
  assert.deepEqual(
    relationalFixtureIds.map((id) => questions.find((q) => q.id === id)?.turns),
    [
      [
        "Show everyone in the Rivera household, including people with a different surname.",
      ],
      ["Show training completions recorded this month across all ministries."],
      ["Who has a launch-team commitment recorded?"],
      [
        "Who attended the last Vision Meeting but did not attend the one before it?",
      ],
    ]
  );
});

test("no captured calls provide no facts or evidence for any binding", () => {
  for (const id of relationalFixtureIds)
    assert.deepEqual(observedRelationalFacts(id, [], new Set()), {
      facts: {},
      evidence: [],
    });
});

test("additional fixture IDs are deterministic and isolated by case and repetition", () => {
  const first = createFixtureManifest("people-05", 0);
  assert.equal(
    relationalId(first, "rivera"),
    relationalId(createFixtureManifest("people-05", 0), "rivera")
  );
  assert.notEqual(
    relationalId(first, "rivera"),
    relationalId(createFixtureManifest("people-05", 1), "rivera")
  );
  assert.notEqual(
    relationalId(first, "rivera"),
    relationalId(createFixtureManifest("training-02", 0), "rivera")
  );
});
