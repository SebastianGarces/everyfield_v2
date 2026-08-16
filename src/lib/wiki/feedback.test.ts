import assert from "node:assert/strict";
import { test } from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";

import { wikiArticleFeedback } from "@/db/schema";

import {
  articleFeedbackForUserRead,
  submitArticleFeedbackSchema,
} from "./feedback";
import { wikiSlugSchema } from "./write-input";

// ----------------------------------------------------------------------------
// Article feedback (W-016)
//
// The DB upsert and the (church, user, article) uniqueness are asserted as
// SQL in write-paths.test.ts. These tests pin the input contract, the unique
// index the schema declares, and the church-scoping of the read.
// ----------------------------------------------------------------------------

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "22222222-2222-4222-8222-222222222222";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLUG = "discovery/values";

test("accepts a helpful rating on a real slug", () => {
  const result = submitArticleFeedbackSchema.safeParse({
    articleSlug: SLUG,
    rating: "helpful",
  });
  assert.equal(result.success, true);
});

test("accepts an unhelpful rating", () => {
  const result = submitArticleFeedbackSchema.safeParse({
    articleSlug: SLUG,
    rating: "unhelpful",
  });
  assert.equal(result.success, true);
});

test("rejects an unknown rating", () => {
  assert.equal(
    submitArticleFeedbackSchema.safeParse({
      articleSlug: SLUG,
      rating: "meh",
    }).success,
    false
  );
});

test("rejects a slug the write schema will not store", () => {
  assert.equal(
    submitArticleFeedbackSchema.safeParse({
      articleSlug: "../etc",
      rating: "helpful",
    }).success,
    false
  );
  assert.equal(wikiSlugSchema.safeParse("../etc").success, false);
});

test("rejects an unknown key, so a probe cannot name the actor", () => {
  assert.equal(
    submitArticleFeedbackSchema.safeParse({
      articleSlug: SLUG,
      rating: "helpful",
      userId: USER,
      churchId: CHURCH_B,
    }).success,
    false,
    "an unknown key survives the parse, so a probe cannot be told apart from a vote"
  );
});

test("the unique index is (church_id, user_id, article_slug)", () => {
  const { indexes } = getTableConfig(wikiArticleFeedback);
  const unique = indexes.filter((index) => index.config.unique);
  const guard = unique.find(
    (index) =>
      index.config.name === "wiki_article_feedback_church_user_article_idx"
  );

  assert.ok(
    guard,
    "the unique index that makes a second vote an UPDATE is missing"
  );
  assert.deepEqual(
    unique.map((index) => index.config.name),
    ["wiki_article_feedback_church_user_article_idx"],
    "a second unique index is a non-arbiter a raced INSERT would meet first"
  );
  assert.deepEqual(
    guard.config.columns.map((column) =>
      "name" in column ? column.name : String(column)
    ),
    ["church_id", "user_id", "article_slug"]
  );
});

test("a vote read names the caller's church and never another", () => {
  const { sql: text, params } = articleFeedbackForUserRead(
    CHURCH_A,
    USER,
    SLUG
  ).toSQL();

  assert.match(text, /from "wiki_article_feedback"/i);
  assert.match(
    text,
    /"church_id" = \$\d/,
    "the read does not name church_id — another plant's vote would come back"
  );
  assert.match(text, /"user_id" = \$\d/);
  assert.match(text, /"article_slug" = \$\d/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(USER));
  assert.ok(params.includes(SLUG));
  assert.ok(
    !params.includes(CHURCH_B),
    "another church's id reached a vote read"
  );
});
