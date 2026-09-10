import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parsePeopleListQuery,
  parsePeopleListSearchParams,
  peopleListFilterQuery,
  peopleListQueryWith,
} from "./list-params";

const tag = "00000000-0000-4000-8000-000000000001";
const bookmark = `view=pipeline&status=bogus&status=prospect&status=prospect&source=bogus&source=personal_referral&tag=invalid&tag=${tag}&tag=${tag}&search=smith&cursor=old&unknown=junk`;

test("browser and page parsing agree, including repeated scalar values", () => {
  assert.deepEqual(
    parsePeopleListQuery(
      "view=pipeline&view=list&search=a&search=b&status=prospect&status=bogus"
    ),
    parsePeopleListSearchParams({
      view: ["pipeline", "list"],
      search: ["a", "b"],
      status: ["prospect", "bogus"],
    })
  );
});

test("malformed and duplicate tag IDs cannot reach the UUID query predicate", () => {
  assert.deepEqual(parsePeopleListQuery(bookmark).tagIds, [tag]);
  assert.equal(parsePeopleListQuery("tag=invalid").tagIds, undefined);
});

test("search interaction repairs the entire bookmark while preserving valid sibling state", () => {
  const next = peopleListQueryWith(bookmark, { search: "Jones" });
  assert.equal(
    next.toString(),
    `view=pipeline&search=Jones&status=prospect&source=personal_referral&tag=${tag}`
  );
  assert.deepEqual(parsePeopleListQuery(next.toString()).status, ["prospect"]);
});

test("checkbox add, remove and group clear preserve the other groups and search", () => {
  const added = peopleListFilterQuery(bookmark, "status", "attendee");
  assert.deepEqual(added.getAll("status"), ["prospect", "attendee"]);
  const removed = peopleListFilterQuery(added.toString(), "status", "prospect");
  assert.deepEqual(removed.getAll("status"), ["attendee"]);
  const cleared = peopleListFilterQuery(removed.toString(), "status", null);
  assert.equal(cleared.has("status"), false);
  assert.equal(cleared.get("view"), "pipeline");
  assert.equal(cleared.get("search"), "smith");
  assert.deepEqual(cleared.getAll("source"), ["personal_referral"]);
  assert.deepEqual(cleared.getAll("tag"), [tag]);
  assert.equal(cleared.has("cursor"), false);
  assert.equal(cleared.has("unknown"), false);
});

test("invalid checkbox input is dropped at the boundary", () => {
  for (const key of ["status", "source", "tag"] as const) {
    assert.equal(peopleListFilterQuery("", key, "bogus").toString(), "");
  }
});

test("Reset clears search and all filter groups but keeps the selected view", () => {
  const next = peopleListQueryWith(bookmark, {
    status: undefined,
    source: undefined,
    tagIds: undefined,
    search: undefined,
  });
  assert.equal(next.toString(), "view=pipeline");
});

test("view and empty-search changes retain valid filters and reset pagination", () => {
  const list = peopleListQueryWith(bookmark, { view: "list", search: "" });
  assert.equal(
    list.toString(),
    `status=prospect&source=personal_referral&tag=${tag}`
  );
  const pipeline = peopleListQueryWith(list.toString(), { view: "pipeline" });
  assert.equal(parsePeopleListQuery(pipeline.toString()).view, "pipeline");
});

test("invalid views are never propagated and repaired queries are stable", () => {
  const next = peopleListQueryWith(
    "view=bogus&source=bad&search=Jones&cursor=old",
    {}
  );
  assert.equal(next.toString(), "search=Jones");
  assert.equal(
    peopleListQueryWith(next.toString(), {}).toString(),
    next.toString()
  );
});

test("UUID case is canonical before deduplication and checkbox toggling", () => {
  const lower = "abcdefab-0000-4000-8000-000000000001";
  const upper = lower.toUpperCase();
  assert.deepEqual(parsePeopleListQuery(`tag=${upper}&tag=${lower}`).tagIds, [
    lower,
  ]);
  assert.equal(
    peopleListFilterQuery(`tag=${upper}`, "tag", lower).toString(),
    ""
  );
});
