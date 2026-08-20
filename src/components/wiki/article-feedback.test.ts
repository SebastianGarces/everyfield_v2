import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { sourceReader } from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// Article feedback control — the properties a browser test cannot pin alone.
//
// The rating is server data, so it must ride `useOptimistic` over the prop
// (never `useState` seeded from it). The action calls `refresh()`, so the
// control updates in place.
// ----------------------------------------------------------------------------

const SOURCE = sourceReader(
  readFileSync(path.join(__dirname, "article-feedback.tsx"), "utf8"),
  "wiki/article-feedback.tsx"
);

test("the rating is useOptimistic over the server prop, never useState", () => {
  assert.match(SOURCE.code, /useOptimistic\(initialRating\)/);
  assert.doesNotMatch(
    SOURCE.code,
    /useState\(initialRating/,
    "seeding useState from the server rating goes stale the moment refresh() re-renders"
  );
});

test("voting does not navigate", () => {
  assert.doesNotMatch(SOURCE.code, /router\.push|router\.replace|href=/);
  assert.match(SOURCE.code, /submitArticleFeedbackAction\(/);
});
