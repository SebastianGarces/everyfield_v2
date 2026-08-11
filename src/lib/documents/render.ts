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

import { hasDocxRenderer, renderDocumentDocx } from "./docx";
import { hasRenderer, renderDocumentPdf } from "./pdf";
import type { DocumentFormat, DocumentMergeValues } from "./types";
import { hasXlsxRenderer, renderDocumentXlsx } from "./xlsx";

const RENDERERS: Record<
  DocumentFormat,
  {
    has(templateId: string): boolean;
    render(templateId: string, values: DocumentMergeValues): Promise<Buffer>;
  }
> = {
  pdf: { has: hasRenderer, render: renderDocumentPdf },
  docx: { has: hasDocxRenderer, render: renderDocumentDocx },
  xlsx: { has: hasXlsxRenderer, render: renderDocumentXlsx },
};

/** Whether `templateId` has a renderer registered for `format`. */
export function canRenderDocument(
  format: DocumentFormat,
  templateId: string
): boolean {
  return RENDERERS[format].has(templateId);
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
