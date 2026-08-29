import assert from "node:assert/strict";
import { test } from "node:test";

import {
  duplicateRowNumbersFromPeopleStage,
  pendingPeopleFileSubmissionFor,
} from "./people-file-state";

test("file retries retain their request key only for the same semantic input", () => {
  let minted = 0;
  const mint = () => `request-${++minted}`;
  const first = pendingPeopleFileSubmissionFor(null, "photo:a", mint);
  const retry = pendingPeopleFileSubmissionFor(first, "photo:a", mint);
  const changed = pendingPeopleFileSubmissionFor(first, "photo:b", mint);

  assert.equal(retry, first);
  assert.equal(changed.requestKey, "request-2");
});

test("reads duplicate row numbers only from the typed staging artifact", () => {
  assert.deepEqual(
    duplicateRowNumbersFromPeopleStage({
      status: "staged",
      artifact: {
        kind: "read",
        items: [
          {
            id: "csv-row-8",
            facts: [{ label: "Status", value: "Duplicate review" }],
          },
          {
            id: "csv-row-2",
            facts: [{ label: "Status", value: "Duplicate review" }],
          },
          {
            id: "csv-row-4",
            facts: [{ label: "Status", value: "Valid" }],
          },
        ],
      },
    }),
    [2, 8]
  );
});

test("ignores malformed and legacy preview-shaped staging data", () => {
  assert.deepEqual(
    duplicateRowNumbersFromPeopleStage({
      status: "staged",
      preview: { duplicateRows: [{ rowNumber: 2 }] },
      artifact: {
        kind: "read",
        items: [
          { id: "csv-row--1", facts: [] },
          { id: "csv-row-3", facts: "Duplicate review" },
          { id: "csv-row-4", facts: [{ label: "Status", value: "Other" }] },
        ],
      },
    }),
    []
  );
});
