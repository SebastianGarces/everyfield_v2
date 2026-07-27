import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  buildCommunicationsWhere,
  escapeLikePattern,
  type CommunicationQueryFilters,
} from "./filters";

// ----------------------------------------------------------------------------
// The history filters are only ever as good as the SQL they compile to, and a
// silently-dropped condition looks exactly like "no matches" in the UI. These
// tests compile the where-clause with the real Postgres dialect (no connection
// needed) and pin both the emitted SQL and its bound parameters — the church
// scope above all, since losing it would leak another tenant's messages.
// ----------------------------------------------------------------------------

const dialect = new PgDialect();
const CHURCH_ID = "11111111-1111-4111-8111-111111111111";

function compile(filters: CommunicationQueryFilters = {}) {
  const query = dialect.sqlToQuery(
    buildCommunicationsWhere(CHURCH_ID, filters)
  );
  return { text: query.sql, params: query.params };
}

// --- tenant scope -----------------------------------------------------------

test("always scopes to the church, with no filters applied", () => {
  const { text, params } = compile();

  assert.match(text, /"church_id" = \$1/);
  assert.deepEqual(params, [CHURCH_ID]);
  assert.doesNotMatch(text, /"channel"/);
  assert.doesNotMatch(text, /"status"/);
  assert.doesNotMatch(text, /ilike/i);
});

test("the church scope survives every other filter", () => {
  const { text, params } = compile({
    channel: "sms",
    status: "failed",
    search: "launch",
  });

  assert.match(text, /"church_id" = \$1/);
  assert.equal(params[0], CHURCH_ID);
});

// --- channel ----------------------------------------------------------------

test("a channel filter narrows to that channel exactly", () => {
  const { text, params } = compile({ channel: "email" });

  assert.match(text, /"channel" = \$2/);
  assert.deepEqual(params, [CHURCH_ID, "email"]);
});

test("channel and status compose as AND, not OR", () => {
  const { text } = compile({ channel: "both", status: "sent" });

  assert.match(text, /"channel" = \$2 and .*"status" = \$3/);
});

// --- status -----------------------------------------------------------------

test("a status filter narrows to that status exactly", () => {
  const { text, params } = compile({ status: "draft" });

  assert.match(text, /"status" = \$2/);
  assert.deepEqual(params, [CHURCH_ID, "draft"]);
});

// --- search -----------------------------------------------------------------

test("search matches subject or body, case-insensitively", () => {
  const { text, params } = compile({ search: "Launch Sunday" });

  assert.match(text, /"subject" ilike \$2 or .*"body" ilike \$3/i);
  assert.deepEqual(params, [CHURCH_ID, "%Launch Sunday%", "%Launch Sunday%"]);
});

test("search is ORed internally but ANDed with the rest of the clause", () => {
  const { text } = compile({ channel: "email", search: "picnic" });

  // The subject/body alternation must be parenthesised, otherwise the OR would
  // swallow the channel and the church scope.
  assert.match(text, /"channel" = \$2 and \(.*ilike.*or.*ilike.*\)/i);
});

test("LIKE metacharacters in a search term are treated as literals", () => {
  const { params } = compile({ search: "50%_off" });

  assert.equal(params[1], "%50\\%\\_off%");
});

test("a backslash in a search term is escaped", () => {
  assert.equal(escapeLikePattern("a\\b"), "a\\\\b");
});

test("a whitespace-only search is not a filter", () => {
  const { text, params } = compile({ search: "   " });

  assert.doesNotMatch(text, /ilike/i);
  assert.deepEqual(params, [CHURCH_ID]);
});

test("search terms are trimmed before matching", () => {
  const { params } = compile({ search: "  bbq  " });

  assert.equal(params[1], "%bbq%");
});

// --- absent filters ---------------------------------------------------------

test("undefined filter values are ignored rather than matched", () => {
  const { text, params } = compile({
    channel: undefined,
    status: undefined,
    search: undefined,
  });

  assert.deepEqual(params, [CHURCH_ID]);
  assert.doesNotMatch(text, /"channel"/);
});
