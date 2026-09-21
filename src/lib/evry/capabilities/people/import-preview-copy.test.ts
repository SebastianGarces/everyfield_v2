import assert from "node:assert/strict";
import { test } from "node:test";
import { importPreviewIssues } from "./import-preview-copy";

test("missing names give instructions instead of parser diagnostics", () => {
  assert.deepEqual(
    importPreviewIssues({
      data: { lastName: "Person" },
      errors: ["firstName: Invalid input: expected string, received undefined"],
    }),
    ["Add a first name."]
  );
  assert.deepEqual(
    importPreviewIssues({
      data: { firstName: "Ada", lastName: " " },
      errors: ["lastName: Last name is required"],
    }),
    ["Add a last name."]
  );
});

test("other field errors identify the field without pretending the value is missing", () => {
  assert.deepEqual(
    importPreviewIssues({
      data: { firstName: "A".repeat(256), email: "not-an-email" },
      errors: [
        "firstName: Too big: expected string to have <=255 characters",
        "email: Invalid email address",
      ],
    }),
    ["Check the first name.", "Check the email address."]
  );
});

test("unknown diagnostics stay private and repeated field errors are collapsed", () => {
  assert.deepEqual(
    importPreviewIssues({
      data: {},
      errors: [
        "email: private diagnostic",
        "email: different diagnostic",
        "constructor: arbitrary payload",
        "malformed diagnostic",
      ],
    }),
    ["Check the email address.", "Review the values in this row."]
  );
  assert.deepEqual(importPreviewIssues({ data: {}, errors: [] }), []);
});
