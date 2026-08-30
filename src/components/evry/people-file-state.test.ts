import assert from "node:assert/strict";
import { test } from "node:test";

import {
  duplicateRowNumbersFromPeopleStage,
  evryPeopleFilePlanBody,
  pendingPeopleFileSubmissionFor,
  preparedEvryPeopleFileFromStage,
  preparedEvryPeopleUploadFromResponse,
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

test("plan body preserves mixed row choices, commitment notes, and staged digest", () => {
  const prepared = {
    reference: "signed-reference",
    digest: "d".repeat(64),
    duplicateRows: [
      { rowNumber: 2, label: "Row 2: Ada", mergeTarget: "Ada Existing" },
      { rowNumber: 8, label: "Row 8: Grace", mergeTarget: "Grace Existing" },
    ],
  };
  assert.deepEqual(
    evryPeopleFilePlanBody({
      kind: "people_csv",
      prepared,
      duplicateResolutions: { "2": "merge", "8": "skip" },
      conversationId: null,
      requestKey: "request-key",
    }),
    {
      kind: "people_csv",
      reference: "signed-reference",
      attachmentDigest: "d".repeat(64),
      duplicateResolutions: { "2": "merge", "8": "skip" },
      conversationId: null,
      requestKey: "request-key",
    }
  );
  assert.deepEqual(
    evryPeopleFilePlanBody({
      kind: "commitment_document",
      prepared,
      commitmentType: "core_group",
      signedDate: "2026-08-29",
      notes: "Signed after the team conversation.",
      conversationId: null,
      requestKey: "request-key",
    }),
    {
      kind: "commitment_document",
      reference: "signed-reference",
      attachmentDigest: "d".repeat(64),
      commitmentType: "core_group",
      signedDate: "2026-08-29",
      witness: null,
      notes: "Signed after the team conversation.",
      conversationId: null,
      requestKey: "request-key",
    }
  );
});

test("prepared file identity is bound to the staged SHA-256", () => {
  assert.deepEqual(
    preparedEvryPeopleFileFromStage({
      status: "staged",
      reference: "signed-reference",
      metadata: { digest: "a".repeat(64) },
      artifact: {
        kind: "read",
        items: [
          {
            id: "csv-row-2",
            label: "Row 2: Ada Lovelace",
            facts: [
              { label: "Status", value: "Duplicate review" },
              { label: "Merge target", value: "Ada Existing" },
            ],
          },
        ],
      },
    }),
    {
      reference: "signed-reference",
      digest: "a".repeat(64),
      duplicateRows: [
        {
          rowNumber: 2,
          label: "Row 2: Ada Lovelace",
          mergeTarget: "Ada Existing",
        },
      ],
    }
  );
  assert.equal(
    preparedEvryPeopleFileFromStage({
      status: "staged",
      reference: "signed-reference",
      metadata: { digest: "not-a-digest" },
    }),
    null
  );
});

test("prepared upload accepts only the closed chunk transport contract", () => {
  const reference = "r".repeat(512);
  assert.deepEqual(
    preparedEvryPeopleUploadFromResponse({
      status: "prepared",
      reference,
      chunkBytes: 3 * 1024 * 1024,
      chunkCount: 4,
    }),
    { reference, chunkBytes: 3 * 1024 * 1024, chunkCount: 4 }
  );
  for (const hostile of [
    {
      status: "prepared",
      reference,
      chunkBytes: 4 * 1024 * 1024,
      chunkCount: 3,
    },
    {
      status: "prepared",
      reference,
      chunkBytes: 3 * 1024 * 1024,
      chunkCount: 5,
    },
    {
      status: "prepared",
      reference: "",
      chunkBytes: 3 * 1024 * 1024,
      chunkCount: 1,
    },
  ]) {
    assert.equal(preparedEvryPeopleUploadFromResponse(hostile), null);
  }
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
            label: "Row 8: Grace Hopper",
            facts: [
              { label: "Status", value: "Duplicate review" },
              { label: "Merge target", value: "Grace Existing" },
            ],
          },
          {
            id: "csv-row-2",
            label: "Row 2: Ada Lovelace",
            facts: [
              { label: "Status", value: "Duplicate review" },
              { label: "Merge target", value: "Ada Existing" },
            ],
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
