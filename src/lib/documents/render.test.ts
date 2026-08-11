// ============================================================================
// Catalog ↔ renderer-registry sync (F6)
// ============================================================================
//
// The catalog (`templates.ts`) declares which formats each template generates;
// the three registries (./pdf, ./docx, ./xlsx) hold the renderers. Nothing at
// runtime pins the two together — a declared format with no renderer would put
// a Generate button in the dialog that only fails at download time. These two
// assertions make that drift a CI failure instead of a planter's 404.
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCX_TEMPLATE_IDS } from "./docx";
import { PDF_TEMPLATE_IDS } from "./pdf";
import { canRenderDocument } from "./render";
import { DOCUMENT_TEMPLATES, getTemplateById } from "./templates";
import type { DocumentFormat } from "./types";
import { XLSX_TEMPLATE_IDS } from "./xlsx";

const REGISTRY_IDS: Record<DocumentFormat, readonly string[]> = {
  pdf: PDF_TEMPLATE_IDS,
  docx: DOCX_TEMPLATE_IDS,
  xlsx: XLSX_TEMPLATE_IDS,
};

test("every format a catalog entry declares has a registered renderer", () => {
  for (const template of DOCUMENT_TEMPLATES) {
    for (const format of template.formats) {
      assert.ok(
        canRenderDocument(format, template.id),
        `"${template.id}" declares "${format}" but no ${format} renderer is registered`
      );
    }
  }
});

test("every registered renderer belongs to a catalog entry declaring its format", () => {
  for (const format of Object.keys(REGISTRY_IDS) as DocumentFormat[]) {
    for (const id of REGISTRY_IDS[format]) {
      const template = getTemplateById(id);
      assert.ok(
        template,
        `${format} registry has "${id}" but the catalog has no such template`
      );
      assert.ok(
        template.formats.includes(format),
        `${format} registry has "${id}" but its catalog entry does not declare "${format}"`
      );
    }
  }
});
