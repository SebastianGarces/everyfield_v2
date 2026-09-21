import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { wikiHref } from "@/lib/wiki/href";
import { wikiReadManySchema } from "./content-wiki";

test("wiki lookup identifies raw slugs without rewriting authored percent sequences", () => {
  const slugs = ["planning #2? 100%", "guides/50%20off", "guides/50 off"];
  const input = wikiReadManySchema.parse({
    articles: slugs.map((slug) => ({ slug })),
  });
  assert.deepEqual(
    input.articles.map((article) => article.slug),
    slugs
  );
  assert.notEqual(wikiHref(slugs[1]!), wikiHref(slugs[2]!));
  const encoded = wikiHref(slugs[0]!).slice("/wiki/".length);
  assert.notEqual(encoded, slugs[0]);
  assert.equal(
    wikiReadManySchema.parse({ articles: [{ slug: encoded }] }).articles[0]!
      .slug,
    encoded,
    "The tool must not silently reinterpret one authored identifier as another"
  );
});

test("model-visible wiki schema explains which search value to reuse", () => {
  const schema = JSON.stringify(z.toJSONSchema(wikiReadManySchema));
  assert.match(schema, /Exact raw Citation slug/);
  assert.match(schema, /not a URL/);
  assert.match(schema, /Copy it unchanged/);
});
