import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getTemplateById } from "@/lib/documents/templates";

import {
  ARTICLE_TEMPLATE_IDS,
  getArticleTemplates,
  resolveArticleTemplates,
} from "./article-templates";

// ----------------------------------------------------------------------------
// Wiki → template links (W-010, #317) — the resolution half, which needs no
// database and therefore runs everywhere, CI included.
//
// The link is only as good as the id behind it. `ARTICLE_TEMPLATE_IDS` is
// authored text pointing at a catalog it has no foreign key into, so the two
// ways this feature breaks silently are (a) an id the catalog no longer knows
// and (b) a link built by hand instead of through the DOC-014 href. Both are
// pinned here. The third way — an article slug the corpus does not have, which
// renders nothing at all — needs the database and lives in
// `article-templates-live.test.ts`.
// ----------------------------------------------------------------------------

/** An article that deliberately offers no template (see the map). */
const ARTICLE_WITHOUT_TEMPLATES = "discovery/finding-a-coach-mentor";

/** An article that does, and the id it leads with. */
const ARTICLE_WITH_TEMPLATES = "core-group/commitment/the-three-key-documents";

// ----------------------------------------------------------------------------
// Unknown ids are dropped, never rendered
// ----------------------------------------------------------------------------

test("an id the catalog does not know is dropped, not linked", () => {
  const resolved = resolveArticleTemplates([
    "commitment-card",
    "this-template-was-retired",
  ]);

  assert.deepEqual(
    resolved.map((t) => t.id),
    ["commitment-card"]
  );
});

test("an all-unknown list resolves to nothing, so the section renders nothing", () => {
  assert.deepEqual(
    resolveArticleTemplates(["this-template-was-retired", ""]),
    []
  );
});

test("a dropped id leaves the surviving links in their authored order", () => {
  const resolved = resolveArticleTemplates([
    "response-card",
    "this-template-was-retired",
    "guest-sign-in-sheet",
  ]);

  assert.deepEqual(
    resolved.map((t) => t.id),
    ["response-card", "guest-sign-in-sheet"]
  );
});

// ----------------------------------------------------------------------------
// Every mapped id resolves — a catalog rename must fail here, not in a browser
// ----------------------------------------------------------------------------

test("every id in the map is a template the catalog still carries", () => {
  const missing: string[] = [];

  for (const [slug, ids] of Object.entries(ARTICLE_TEMPLATE_IDS)) {
    for (const id of ids) {
      if (!getTemplateById(id)) missing.push(`${slug} → ${id}`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `these article → template links resolve to nothing and would silently disappear from the article foot:\n${missing.join("\n")}`
  );
});

test("no article lists the same template twice", () => {
  for (const [slug, ids] of Object.entries(ARTICLE_TEMPLATE_IDS)) {
    assert.equal(
      new Set(ids).size,
      ids.length,
      `${slug} lists a duplicate template`
    );
  }
});

// ----------------------------------------------------------------------------
// Per-article resolution
// ----------------------------------------------------------------------------

test("an article with related templates resolves them in authored order", () => {
  assert.deepEqual(
    getArticleTemplates(ARTICLE_WITH_TEMPLATES).map((t) => t.id),
    ["commitment-card", "member-expectations", "launch-team-commitment"]
  );
});

test("an article with no related templates resolves to nothing", () => {
  assert.deepEqual(getArticleTemplates(ARTICLE_WITHOUT_TEMPLATES), []);
});

test("a slug that is not in the map at all resolves to nothing", () => {
  assert.deepEqual(getArticleTemplates("no/such/article"), []);
});

test("the map is read as a plain lookup, not a prototype chain", () => {
  // `Record<string, …>` will happily hand back `Object.prototype.toString` for
  // the slug "toString" — a resolved value that is not a list of ids.
  assert.deepEqual(getArticleTemplates("toString"), []);
  assert.deepEqual(getArticleTemplates("constructor"), []);
});

// ----------------------------------------------------------------------------
// Link shape (DOC-014) — the dialog, never a download
// ----------------------------------------------------------------------------

test("a link opens the template's generate dialog on the documents library", () => {
  const [first] = getArticleTemplates(ARTICLE_WITH_TEMPLATES);

  assert.ok(first);
  assert.equal(first.href, "/documents?template=commitment-card");
});

test("no link points straight at the generate API", () => {
  for (const slug of Object.keys(ARTICLE_TEMPLATE_IDS)) {
    for (const template of getArticleTemplates(slug)) {
      assert.ok(
        !template.href.startsWith("/api/"),
        `${slug} → ${template.id} links at the API instead of the dialog`
      );
    }
  }
});

test("links carry the catalog's own name, description and formats", () => {
  const [first] = getArticleTemplates(ARTICLE_WITH_TEMPLATES);
  const catalog = getTemplateById("commitment-card");

  assert.ok(first && catalog);
  assert.equal(first.name, catalog.name);
  assert.equal(first.description, catalog.description);
  assert.deepEqual(first.formats, catalog.formats);
});

// ----------------------------------------------------------------------------
// The rendered link — a source scan, because the component is an RSC importing
// next/link and cannot be loaded under `tsx --test`.
// ----------------------------------------------------------------------------

const RELATED_TEMPLATES = "src/components/wiki/related-templates.tsx";

const relatedTemplatesSource = readFileSync(
  path.join(process.cwd(), RELATED_TEMPLATES),
  "utf8"
);

test("template links open in a new tab, safely and audibly", () => {
  // A template is fetched WHILE reading, so following it in place would cost
  // the reader their place in the article (#317 ruling).
  const link = relatedTemplatesSource.match(
    /<Link[\s\S]*?data-testid="wiki-related-template"[\s\S]*?>/
  );

  assert.ok(link, "the template link was not found");
  assert.match(
    link[0],
    /target="_blank"/,
    "template links must open in a new tab"
  );
  assert.match(
    link[0],
    /rel="noopener noreferrer"/,
    "a _blank link without noopener hands the opened page a reference back to this one"
  );
  assert.match(
    relatedTemplatesSource,
    /className="sr-only">\{"\(opens in new tab\)"\}/,
    "the new tab must be announced — the ExternalLink icon is aria-hidden and says nothing"
  );
});

test("the section renders nothing rather than an empty heading", () => {
  assert.match(
    relatedTemplatesSource,
    /templates\.length === 0\s*\)\s*\{\s*return null;/,
    "RelatedTemplates must return null when the article offers no template"
  );
});

test("hrefs come from the resolver, never interpolated in the component", () => {
  assert.ok(
    !/href={`/.test(relatedTemplatesSource),
    "template hrefs must come from contextualTemplateHref via the resolver"
  );
});
