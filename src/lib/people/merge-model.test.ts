import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeRequestSchema } from "./merge-model";
import { duplicatePredicates } from "./duplicate-match";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const request = {
  leftId: "00000000-0000-4000-a000-000000000001",
  rightId: "00000000-0000-4000-a000-000000000002",
  survivor: "left",
  leftVersion: "a".repeat(32),
  rightVersion: "b".repeat(32),
  choices: { name: "right" },
};
test("merge boundary accepts only stored sides and rejects authority/storage payloads", () => {
  assert.ok(mergeRequestSchema.safeParse(request).success);
  for (const invalid of [
    { ...request, leftId: request.rightId },
    { ...request, survivor: "other" },
    { ...request, userId: request.leftId },
    { ...request, choices: { photo: "private/key" } },
    { ...request, choices: { householdId: request.leftId } },
    { ...request, leftVersion: "stale" },
  ]) {
    assert.equal(mergeRequestSchema.safeParse(invalid).success, false);
  }
});
test("duplicate SQL treats wildcard-like data literally and ignores blank/short contacts", () => {
  const fields = {
    email: sql`'name_%@example.test'`,
    firstName: sql`'%'`,
    lastName: sql`'_'`,
    phone: sql`'123'`,
  };
  const statement = new PgDialect().sqlToQuery(
    duplicatePredicates(fields, fields).any
  ).sql;
  assert.doesNotMatch(statement, /\bilike\b/i);
  assert.match(statement, /nullif\(lower\(trim/);
  assert.match(statement, /length\(regexp_replace/);
  assert.match(statement, />= 4/);
});
