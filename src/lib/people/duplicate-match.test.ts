import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  evryImportDuplicateSnapshotCtes,
  literalCaseInsensitiveDuplicateMatch,
} from "./duplicate-match";

const dialect = new PgDialect();

test("literal duplicate equality parameterizes LIKE metacharacters unchanged", () => {
  for (const candidate of ["a_b@example.com", "Per%", "Back\\Slash"]) {
    const query = dialect.sqlToQuery(
      literalCaseInsensitiveDuplicateMatch(sql`person_value`, candidate)
    );

    assert.equal(query.sql, "lower(person_value) = lower(trim($1))");
    assert.deepEqual(query.params, [candidate]);
  }
});

test("one snapshot CTE owns the email and name revalidation predicates", () => {
  const snapshotJson = JSON.stringify([
    {
      rowNumber: 2,
      email: "a_b@example.com",
      firstName: "Per%",
      lastName: "Back\\Slash",
      phone: null,
      matchIds: [],
    },
  ]);
  const query = dialect.sqlToQuery(
    evryImportDuplicateSnapshotCtes({
      plantId: "10000000-0000-4000-8000-000000000001",
      snapshotJson,
      expectedCount: 1,
    })
  );

  assert.equal(query.sql.includes(" ilike "), false);
  assert.equal(
    query.sql.match(/lower\([^)]*\) = lower\(trim\([^)]*\)\)/g)?.length,
    3
  );
  assert.equal(query.params.includes(snapshotJson), true);
});
