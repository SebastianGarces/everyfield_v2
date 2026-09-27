import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseWikiSearchParams,
  wikiSearchHref,
  wikiSnippetParts,
} from "./search-params";
import { searchArticlesQuery } from "./search";

test("search URLs retain the scoped query and cumulative page across refresh", () => {
  const params = parseWikiSearchParams({
    q: "  elders & vision  ",
    type: "how_to",
    phase: "0",
    sort: "recent",
    page: "2",
  });
  assert.deepEqual(
    parseWikiSearchParams(
      Object.fromEntries(
        new URL(wikiSearchHref(params), "https://example.test").searchParams
      )
    ),
    params
  );
  assert.equal(params.q, "elders & vision");
  assert.equal(params.phase, 0);
});

test("search boundary defaults malformed filters and bounds expensive requests", () => {
  assert.deepEqual(
    parseWikiSearchParams({
      q: ["word", "ignored"],
      type: "wrong",
      phase: "-1",
      sort: "random",
      page: "1.5",
    }),
    { q: "word", type: undefined, phase: undefined, sort: "relevance", page: 1 }
  );
  assert.equal(
    parseWikiSearchParams({ q: "x".repeat(250), page: "99999999" }).q.length,
    200
  );
  assert.equal(parseWikiSearchParams({ page: "99999999" }).page, 1000);
});

test("headline markup remains literal text while selected matches become marks", () => {
  assert.deepEqual(
    wikiSnippetParts('<script>alert(1)</script> elder & "team"'),
    [
      { text: "<script>alert(1)</script> ", highlighted: false },
      { text: "elder", highlighted: true },
      { text: ' & "team"', highlighted: false },
    ]
  );
});

test("full search applies type, phase, count and deterministic ordering before its page limit", () => {
  const { sql, params } = searchArticlesQuery(
    "elders",
    "00000000-0000-4000-a000-000000000001",
    parseWikiSearchParams({
      q: "elders",
      type: "reference",
      phase: "2",
      sort: "recent",
      page: "2",
    })
  ).toSQL();
  assert.match(sql, /count\(\*\) over\(\)/i);
  assert.match(sql, /not exists/i);
  assert.match(
    sql,
    /order by "wiki_articles"\."updated_at" DESC, "wiki_articles"\."id"/i
  );
  assert.ok(params.includes("reference"));
  assert.ok(params.includes(2));
  assert.equal(params.at(-1), 40);
});
