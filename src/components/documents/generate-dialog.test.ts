import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DOCUMENT_TEMPLATES, type DocumentFormat } from "@/lib/documents";

import { FormatPicker } from "./generate-dialog";

// ----------------------------------------------------------------------------
// The bug (#161, from PR #137's verifier): the `formats.length > 1` guard was
// lost, so the ~8 single-format templates rendered a radio group holding one
// option — a control that answers itself, costs a tab stop, and reads as a
// decision the user still has to make.
//
// GenerateDialog itself renders through a Radix portal, which produces no
// server markup, so the assertions run against the picker it delegates to.
// ----------------------------------------------------------------------------

function renderPicker(formats: DocumentFormat[]) {
  return renderToStaticMarkup(
    createElement(FormatPicker, {
      templateId: "response-card",
      formats,
      value: formats[0] ?? "pdf",
      onValueChange: () => {},
    })
  );
}

/** Strip tags — what a reader actually sees. */
function textOf(html: string) {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
}

test("a single-format template states the format instead of offering a choice", () => {
  const html = renderPicker(["pdf"]);

  assert.match(textOf(html), /Format: PDF/);
  assert.ok(!html.includes('role="radiogroup"'));
  assert.ok(!html.includes('role="radio"'));
});

test("the single-format label names the format it will actually generate", () => {
  assert.match(textOf(renderPicker(["docx"])), /Format: Word \(\.docx\)/);
  assert.match(textOf(renderPicker(["xlsx"])), /Format: Excel \(\.xlsx\)/);
});

test("a multi-format template keeps the radio group, one option per format", () => {
  const html = renderPicker(["pdf", "docx"]);

  assert.ok(html.includes('role="radiogroup"'));
  assert.equal(html.match(/role="radio"/g)?.length, 2);
  assert.match(textOf(html), /PDF/);
  assert.match(textOf(html), /Word \(\.docx\)/);
});

test("the radio group is labelled and offers one item per format", () => {
  const html = renderPicker(["pdf", "docx", "xlsx"]);

  assert.ok(html.includes('aria-label="Output format"'));
  assert.equal(html.match(/role="radio"/g)?.length, 3);
});

test("both branches keep the `format-picker` hook the dialog is asserted by", () => {
  assert.ok(renderPicker(["pdf"]).includes('data-testid="format-picker"'));
  assert.ok(
    renderPicker(["pdf", "docx"]).includes('data-testid="format-picker"')
  );
});

// ----------------------------------------------------------------------------
// The catalog is the reason this matters: assert both branches are real.
// ----------------------------------------------------------------------------

test("the catalog holds both single-format and multi-format templates", () => {
  const single = DOCUMENT_TEMPLATES.filter((t) => t.formats.length === 1);
  const multi = DOCUMENT_TEMPLATES.filter((t) => t.formats.length > 1);

  assert.ok(
    single.length > 0,
    "expected single-format templates in the catalog"
  );
  assert.ok(multi.length > 0, "expected multi-format templates in the catalog");
});

test("every catalog template renders a picker with at least one format named", () => {
  for (const template of DOCUMENT_TEMPLATES) {
    assert.ok(
      template.formats.length > 0,
      `${template.id} declares no output format`
    );
    const html = renderPicker(template.formats);
    assert.ok(
      html.includes('data-testid="format-picker"'),
      `${template.id} rendered no format picker`
    );
  }
});
