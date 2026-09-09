import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcilePeopleSearchDraft } from "./people-search-draft";

test("an older submitted search cannot erase newer typing or cancel its debounce", () => {
  const draft = {
    query: "",
    value: "Alice",
    submitted: ["search=Al"],
    navigation: 0,
  };
  const next = reconcilePeopleSearchDraft(draft, "search=Al", "Al");
  assert.equal(next.value, "Alice");
  assert.equal(next.navigation, 0);
  assert.deepEqual(next.submitted, []);
});

test("external navigation resets the draft and invalidates pending searches", () => {
  const draft = {
    query: "search=Al",
    value: "Alice",
    submitted: ["search=Alice"],
    navigation: 0,
  };
  const next = reconcilePeopleSearchDraft(
    draft,
    "view=pipeline&search=Bob",
    "Bob"
  );
  assert.equal(next.value, "Bob");
  assert.equal(next.navigation, 1);
  assert.deepEqual(next.submitted, []);
});

test("a later search acknowledgment consumes superseded submissions", () => {
  const draft = {
    query: "",
    value: "Alice",
    submitted: ["search=Al", "search=Alice"],
    navigation: 0,
  };
  assert.deepEqual(
    reconcilePeopleSearchDraft(draft, "search=Alice", "Alice").submitted,
    []
  );
});
