import assert from "node:assert/strict";
import { test } from "node:test";

import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { buildPeopleConditions, peopleTextSearch } from "./service";

// ----------------------------------------------------------------------------
// The people text predicate (ruling 410-1B).
//
// `peopleTextSearch` is the ONE text predicate for the people domain — list,
// export and the recipient pickers all reach it through
// `buildPeopleConditions`. The ruling merged the full-name search that lived
// in the dead `search.ts` into it: a query like "Jane Smith" must match a
// person whose first name is "Jane" and last name is "Smith", which no
// single-column ilike can do.
//
// Following the create-church.test.ts precedent, these tests pin the rendered
// SQL and its parameters instead of a live database.
// ----------------------------------------------------------------------------

const dialect = new PgDialect();

function render(search: string) {
  const conditions = buildPeopleConditions(
    "00000000-0000-0000-0000-000000000000",
    { search }
  );
  const combined = and(...conditions);
  assert.ok(combined, "expected at least one condition");
  return dialect.sqlToQuery(combined);
}

test('"Jane Smith" matches via the concatenated full-name column', () => {
  const { sql, params } = render("Jane Smith");

  // The full-name predicate: concat(first_name, ' ', last_name) ilike $n.
  const fullName = sql.match(
    /concat\("persons"\."first_name", ' ', "persons"\."last_name"\) ilike \$\d+/
  );
  assert.ok(
    fullName,
    `expected the concatenated full-name ilike predicate in:\n${sql}`
  );

  // Its bound parameter is the full query — "Jane Smith" as one pattern, so a
  // person named Jane Smith matches even though neither column alone contains
  // the space-joined value.
  assert.ok(
    params.includes("%Jane Smith%"),
    `expected "%Jane Smith%" among params: ${JSON.stringify(params)}`
  );
});

test("keeps the four single-column matches alongside the full name", () => {
  const { sql } = render("Jane Smith");

  for (const column of ["first_name", "last_name", "email", "phone"]) {
    assert.ok(
      sql.includes(`"persons"."${column}" ilike `),
      `expected an ilike over ${column} in:\n${sql}`
    );
  }
});

test("trims the query before building the pattern", () => {
  const predicate = peopleTextSearch("  Jane Smith  ");
  assert.ok(predicate);
  const { params } = dialect.sqlToQuery(predicate);

  assert.ok(
    params.every((p) => p === "%Jane Smith%"),
    `expected every param to be the trimmed pattern: ${JSON.stringify(params)}`
  );
});
