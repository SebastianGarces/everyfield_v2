import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evryResolvedPageContextSchema,
  evryStoredPageContextSchema,
  safeEvryPageContextLabel,
} from "./contract";

test("stored server-resolved context keeps its authenticated label", () => {
  assert.deepEqual(
    evryStoredPageContextSchema.parse({
      kind: "person",
      recordId: "10000000-0000-4000-8000-000000000001",
      label: "Alex Rivera",
    }),
    {
      kind: "person",
      recordId: "10000000-0000-4000-8000-000000000001",
      label: "Alex Rivera",
    }
  );
});

test("a label-free #763 row reopens with fixed non-browser copy", () => {
  assert.deepEqual(
    evryStoredPageContextSchema.parse({
      kind: "task",
      recordId: "50000000-0000-4000-8000-000000000001",
    }),
    {
      kind: "task",
      recordId: "50000000-0000-4000-8000-000000000001",
      label: "Task record",
    }
  );
});

test("write validation still requires a server-owned label", () => {
  assert.equal(
    evryResolvedPageContextSchema.safeParse({
      kind: "task",
      recordId: "50000000-0000-4000-8000-000000000001",
    }).success,
    false
  );
  assert.equal(
    evryStoredPageContextSchema.safeParse({
      kind: "task",
      recordId: "50000000-0000-4000-8000-000000000001",
      breadcrumbLabel: "Browser-owned label",
    }).success,
    false
  );
});

test("astral labels normalize to the schema's UTF-16 limit", () => {
  const label = safeEvryPageContextLabel("😀".repeat(81), "Task record");
  assert.equal(label, "😀".repeat(80));
  assert.equal(label.length, 160);
  assert.equal(
    evryResolvedPageContextSchema.safeParse({
      kind: "task",
      recordId: "50000000-0000-4000-8000-000000000001",
      label,
    }).success,
    true
  );
});
