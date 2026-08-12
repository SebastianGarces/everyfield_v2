// ============================================================================
// Document Templates — XLSX render registry (F6)
// ============================================================================
//
// Maps a template id to an exceljs workbook builder. Server-only. Called from
// the generation route when format=xlsx.
// ============================================================================

import type { DocumentMergeValues } from "../types";
import { buildBudgetWorksheet } from "./budget-worksheet";
import { buildFirstYearBudget } from "./first-year-budget";

type XlsxBuilder = (values: DocumentMergeValues) => Promise<Buffer>;

const XLSX_BUILDERS: Record<string, XlsxBuilder> = {
  "first-year-budget": buildFirstYearBudget,
  "budget-worksheet": buildBudgetWorksheet,
};

/** Registered template ids — `render.ts` folds these into its format registry. */
export const XLSX_TEMPLATE_IDS: readonly string[] = Object.keys(XLSX_BUILDERS);

/**
 * Render a template to a .xlsx Buffer. Throws if the template id has no builder.
 */
export async function renderDocumentXlsx(
  templateId: string,
  values: DocumentMergeValues
): Promise<Buffer> {
  const build = XLSX_BUILDERS[templateId];
  if (!build) {
    throw new Error(`No XLSX builder for template "${templateId}"`);
  }
  return build(values);
}
