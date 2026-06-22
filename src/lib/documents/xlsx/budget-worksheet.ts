// ============================================================================
// Budget Worksheet — xlsx template (F6)
// ============================================================================
//
// A simple monthly-vs-annual budget planner with live formulas.
// ============================================================================

import ExcelJS from "exceljs";

import type { DocumentMergeValues } from "../types";

const CATEGORIES = [
  "Giving / Tithes",
  "Launch Grants / Partnerships",
  "Salary / Stipend",
  "Rent / Venue",
  "Equipment & Supplies",
  "Marketing / Outreach",
  "Children's Ministry",
  "Administration",
];

export async function buildBudgetWorksheet(
  values: DocumentMergeValues
): Promise<Buffer> {
  const churchName = values.church_name || "Our Church";
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Budget Worksheet");

  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 16;

  const title = ws.addRow([`${churchName} — Budget Worksheet`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([]);

  const header = ws.addRow(["Category", "Monthly", "Annual"]);
  header.font = { bold: true };

  const first = ws.rowCount + 1;
  CATEGORIES.forEach((name) => {
    const row = ws.addRow([name]);
    // Annual = Monthly * 12 (column B is monthly, C is annual).
    row.getCell(3).value = { formula: `B${row.number}*12` };
  });
  const last = ws.rowCount;

  const totals = ws.addRow(["Total"]);
  totals.font = { bold: true };
  totals.getCell(2).value = { formula: `SUM(B${first}:B${last})` };
  totals.getCell(3).value = { formula: `SUM(C${first}:C${last})` };

  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as Uint8Array);
}
