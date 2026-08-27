import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MERGE_FIELDS } from "@/lib/communication/merge";

import { MergeFieldInserter } from "./merge-field-inserter";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("'", "&#x27;");
}

test("merge fields render as named, focusable native buttons with 24px targets", () => {
  const markup = renderToStaticMarkup(
    createElement(MergeFieldInserter, { onInsert: () => undefined })
  );

  for (const field of MERGE_FIELDS) {
    const token = `{{${field.name}}}`;
    const button = new RegExp(
      `<button(?=[^>]*aria-label="Insert ${escapeRegExp(token)}")(?=[^>]*title="${escapeRegExp(escapeHtmlAttribute(field.description))}")(?=[^>]*class="[^"]*min-h-6[^"]*")(?=[^>]*class="[^"]*focus-visible:ring-\\[3px\\][^"]*")[^>]*>${escapeRegExp(token)}</button>`
    );

    assert.match(
      markup,
      button,
      `${token} must keep its description title while exposing a named native button with the shared focus ring and a 24px minimum height`
    );
  }
});
