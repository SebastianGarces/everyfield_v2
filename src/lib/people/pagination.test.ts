import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { keysetPage, orderByKeyset } from "@/lib/testing/keyset";
import { sourceReader, stripComments } from "@/lib/testing/source-span";

import { parsePeopleListSearchParams, PEOPLE_PAGE_SIZE } from "./list-params";
import { buildPeopleConditions } from "./service";

// ----------------------------------------------------------------------------
// "LOAD MORE" ON /people (#320, P-006a).
//
// The button existed and was `disabled`, its label apologising for the
// pagination that had not been wired.
// The query behind it was already a sound `(created_at, id)` keyset walk, so
// the work was wiring — and the risk in wiring is that the SECOND page is a
// different query from the first. Two things had to hold, and each has a test:
//
//   1. The walk itself does not skip or repeat across a boundary.
//   2. The appended page carries the SAME filters, because the page and the
//      load-more action read the URL through ONE parser.
//
// The people list orders by `created_at DESC, id DESC`, so the key below is the
// timestamp read descending — the same order `paginatePeopleByCreatedAtCursor`
// applies.
// ----------------------------------------------------------------------------

const LIMIT = 4;

interface PersonRow {
  id: string;
  createdAt: Date;
}

/** Rows whose creation order and id order deliberately disagree. */
function fixture(): PersonRow[] {
  return Array.from({ length: 14 }, (_, index) => ({
    id: `person-${String(13 - index).padStart(2, "0")}`,
    createdAt: new Date(Date.UTC(2026, 1, index + 1)),
  }));
}

const createdAtKey = (row: PersonRow) => row.createdAt.toISOString();

test("two sequential pages share zero ids and cover the first 2×limit rows", () => {
  const rows = fixture();

  const first = keysetPage(rows, createdAtKey, LIMIT, null, "desc");
  assert.equal(first.rows.length, LIMIT);
  assert.ok(first.nextCursor, "the fixture has more than one page");

  const second = keysetPage(
    rows,
    createdAtKey,
    LIMIT,
    first.nextCursor,
    "desc"
  );
  assert.equal(second.rows.length, LIMIT);

  const firstIds = first.rows.map((row) => row.id);
  const secondIds = second.rows.map((row) => row.id);

  assert.deepEqual(
    firstIds.filter((id) => secondIds.includes(id)),
    [],
    "a person came back on both pages"
  );

  const expected = orderByKeyset(rows, createdAtKey, "desc")
    .slice(0, LIMIT * 2)
    .map((row) => row.id);
  assert.deepEqual([...firstIds, ...secondIds], expected);
});

test("the cursor predicate compares the pair the list is ordered by", () => {
  const source = stripComments(
    readFileSync(path.join(process.cwd(), "src/lib/people/service.ts"), "utf8")
  );
  const paginate = sourceReader(source, "people/service.ts (stripped)").span(
    "export async function paginatePeopleByCreatedAtCursor(",
    "export async function listPeople("
  );

  assert.ok(
    paginate.includes("orderBy(desc(persons.createdAt), desc(persons.id))"),
    "the people list orders by (created_at, id) descending"
  );
  assert.ok(
    paginate.includes("(${persons.createdAt}, ${persons.id}) <"),
    "and the cursor compares that same pair"
  );
});

test("the page and Load more read the same filters out of one URL", () => {
  // The exact URL a planter is looking at, repeated params and all.
  const url = {
    search: "smith",
    status: ["prospect", "bogus", "prospect"],
    source: "personal_referral",
    tag: ["tag-a", "tag-b"],
    cursor: "person-07",
    view: "list",
  };

  const parsed = parsePeopleListSearchParams(url);

  // An unrecognised member is DROPPED, not refused, and duplicates collapse.
  assert.deepEqual(parsed.status, ["prospect"]);
  assert.deepEqual(parsed.source, ["personal_referral"]);
  assert.deepEqual(parsed.tagIds, ["tag-a", "tag-b"]);
  assert.equal(parsed.search, "smith");
  assert.equal(parsed.view, "list");

  // The predicate the appended page is read under is the predicate the first
  // page was read under: same parser in, same SQL out.
  const dialect = new PgDialect();
  const churchId = "00000000-0000-0000-0000-000000000000";
  const render = (params: ReturnType<typeof parsePeopleListSearchParams>) => {
    const combined = and(
      ...buildPeopleConditions(churchId, {
        status: params.status,
        source: params.source,
        tagIds: params.tagIds,
        search: params.search,
      })
    );
    assert.ok(combined);
    return dialect.sqlToQuery(combined);
  };

  const page = render(parsed);
  const loadMore = render(parsePeopleListSearchParams(url));

  assert.equal(page.sql, loadMore.sql);
  assert.deepEqual(page.params, loadMore.params);
});

test("the page size is one number, not two", () => {
  const pageSource = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/people/page.tsx"),
    "utf8"
  );
  const actionSource = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/people/actions.ts"),
    "utf8"
  );

  assert.equal(PEOPLE_PAGE_SIZE, 24);
  for (const [label, source] of [
    ["page.tsx", pageSource],
    ["actions.ts", actionSource],
  ] as const) {
    assert.ok(
      source.includes("limit: PEOPLE_PAGE_SIZE"),
      `${label} must take its page size from PEOPLE_PAGE_SIZE — a literal here ` +
        `is a second page size, and a load-more page of a different size skips rows`
    );
  }
});
