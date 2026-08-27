import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { contextualTemplateHref } from "@/lib/documents/contextual";
import { parseElements } from "@/lib/testing/rendered-markup";

import {
  DocumentLibraryFilters,
  TEMPLATE_SEARCH_PARAM,
  urlWithoutTemplateParam,
} from "./documents-library";

// ----------------------------------------------------------------------------
// The bug (#161, from PR #137's verifier): the library seeded its open-dialog
// id from a prop with `useState`, so it never re-synced, and the page papered
// over that with `key={initialTemplateId ?? "all"}` — force-remounting the
// library and throwing away the user's filters on every contextual arrival.
//
// The fix reads `?template=` on every render and clears it to dismiss. These
// tests pin the two halves that are pure: the parameter name the contextual
// links write, and the URL the dismissal navigates to.
// ----------------------------------------------------------------------------

test("the library reads the parameter the contextual links actually write", () => {
  const href = contextualTemplateHref("response-card");
  const query = new URLSearchParams(href.split("?")[1] ?? "");

  assert.equal(query.get(TEMPLATE_SEARCH_PARAM), "response-card");
});

test("dismissing the dialog drops the deep link", () => {
  const params = new URLSearchParams({ template: "response-card" });

  assert.equal(urlWithoutTemplateParam("/documents", params), "/documents");
});

test("dismissing the dialog leaves every other parameter alone", () => {
  const params = new URLSearchParams({
    view: "grid",
    template: "response-card",
    q: "sign in",
  });

  const url = urlWithoutTemplateParam("/documents", params);
  const query = new URLSearchParams(url.split("?")[1] ?? "");

  assert.ok(url.startsWith("/documents?"));
  assert.equal(query.get(TEMPLATE_SEARCH_PARAM), null);
  assert.equal(query.get("view"), "grid");
  assert.equal(query.get("q"), "sign in");
});

test("a URL with no deep link to drop is left as it is", () => {
  assert.equal(
    urlWithoutTemplateParam("/documents", new URLSearchParams()),
    "/documents"
  );
  assert.equal(
    urlWithoutTemplateParam(
      "/documents",
      new URLSearchParams({ view: "grid" })
    ),
    "/documents?view=grid"
  );
});

test("repeated deep-link parameters are all dropped, not just the first", () => {
  const params = new URLSearchParams("template=a&template=b&view=grid");

  assert.equal(
    urlWithoutTemplateParam("/documents", params),
    "/documents?view=grid"
  );
});

test("the caller's own search params are never mutated", () => {
  const params = new URLSearchParams({ template: "response-card" });

  urlWithoutTemplateParam("/documents", params);

  assert.equal(params.get(TEMPLATE_SEARCH_PARAM), "response-card");
});

test("a ReadonlyURLSearchParams-shaped value is accepted (only toString is used)", () => {
  // `useSearchParams()` returns ReadonlyURLSearchParams, which has no `delete`.
  const readonlyish = { toString: () => "template=response-card&view=grid" };

  assert.equal(
    urlWithoutTemplateParam("/documents", readonlyish),
    "/documents?view=grid"
  );
});

test("the template search retains its accessible name without its placeholder", () => {
  const html = renderToStaticMarkup(
    createElement(DocumentLibraryFilters, {
      search: "",
      onSearchChange: () => {},
      category: "all",
      onCategoryChange: () => {},
      phase: "all",
      onPhaseChange: () => {},
      format: "all",
      onFormatChange: () => {},
      categories: [],
      phases: [],
      formats: [],
    })
  );
  const search = parseElements(html).find(
    (element) => element.attrs.placeholder === "Search templates..."
  );

  assert.ok(search, "template search is missing");
  assert.equal(search.attrs["aria-label"], "Search templates");
});
