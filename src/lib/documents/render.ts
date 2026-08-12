// ============================================================================
// Document Templates — format dispatch (F6)
// ============================================================================
//
// The ONE place a `DocumentFormat` picks a renderer. The per-format registries
// (./pdf, ./docx, ./xlsx) stay the owners of their template maps; this module
// is the generation route's whole vocabulary, so adding a fourth output format
// means adding one entry here — not another ternary in the route. Server-only
// (the registries import @react-pdf/renderer / docx / exceljs).
// ============================================================================

import { DOCX_TEMPLATE_IDS, renderDocumentDocx } from "./docx";
import { PDF_TEMPLATE_IDS, renderDocumentPdf } from "./pdf";
import type { DocumentFormat, DocumentMergeValues } from "./types";
import { XLSX_TEMPLATE_IDS, renderDocumentXlsx } from "./xlsx";

const RENDERERS: Record<
  DocumentFormat,
  {
    ids: readonly string[];
    render(templateId: string, values: DocumentMergeValues): Promise<Buffer>;
  }
> = {
  pdf: { ids: PDF_TEMPLATE_IDS, render: renderDocumentPdf },
  docx: { ids: DOCX_TEMPLATE_IDS, render: renderDocumentDocx },
  xlsx: { ids: XLSX_TEMPLATE_IDS, render: renderDocumentXlsx },
};

/** Whether `templateId` has a renderer registered for `format`. */
export function canRenderDocument(
  format: DocumentFormat,
  templateId: string
): boolean {
  return RENDERERS[format].ids.includes(templateId);
}

/** All template ids with a renderer registered for `format`. */
export function registeredTemplateIds(
  format: DocumentFormat
): readonly string[] {
  return RENDERERS[format].ids;
}

/**
 * Render `templateId` in `format` to a Buffer. Throws if the template id has
 * no renderer for the format — guard with `canRenderDocument` first.
 */
export function renderDocument(
  format: DocumentFormat,
  templateId: string,
  values: DocumentMergeValues
): Promise<Buffer> {
  return RENDERERS[format].render(templateId, values);
}
