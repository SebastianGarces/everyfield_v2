// ============================================================================
// First-Year Budget — xlsx template (F6)
// ============================================================================
//
// A 12-month budget worksheet with income/expense categories and live SUM
// formulas, so planters get a working spreadsheet (not a static dump).
// ============================================================================

import ExcelJS from "exceljs";

import type { DocumentMergeValues } from "../types";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const INCOME = [
  "Giving / Tithes",
  "Launch Grants / Partnerships",
  "Fundraising",
];

const EXPENSES = [
  "Salary / Stipend",
  "Rent / Venue",
  "Equipment & Supplies",
  "Marketing / Outreach",
  "Children's Ministry",
  "Administration",
];

// Column A = category, B..M = the 12 months, N = row total.
const MONTH_COLS = MONTHS.map((_, i) => String.fromCharCode(66 + i)); // B..M
const TOTAL_COL = "N";

export async function buildFirstYearBudget(
  values: DocumentMergeValues
): Promise<Buffer> {
  const churchName = values.church_name || "Our Church";
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("First-Year Budget");

  ws.getColumn(1).width = 28;
  MONTH_COLS.forEach((c) => (ws.getColumn(c).width = 9));
  ws.getColumn(TOTAL_COL).width = 12;

  const title = ws.addRow([`${churchName} — First-Year Budget`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([]);

  const header = ws.addRow(["Category", ...MONTHS, "Total"]);
  header.font = { bold: true };

  const rowTotal = (r: number) => ({
    formula: `SUM(${MONTH_COLS[0]}${r}:${MONTH_COLS[11]}${r})`,
  });

  // Section helper: writes a bold section label, the category rows, and a
  // bold totals row that sums each month column across the section's rows.
  function section(label: string, categories: string[]): number {
    const head = ws.addRow([label]);
    head.font = { bold: true };
    const first = ws.rowCount + 1;
    categories.forEach((name) => {
      const row = ws.addRow([name]);
      row.getCell(TOTAL_COL).value = rowTotal(row.number);
    });
    const last = ws.rowCount;
    const totals = ws.addRow([`Total ${label}`]);
    totals.font = { bold: true };
    MONTH_COLS.forEach((c) => {
      totals.getCell(c).value = { formula: `SUM(${c}${first}:${c}${last})` };
    });
    totals.getCell(TOTAL_COL).value = rowTotal(totals.number);
    return totals.number; // row index of the section total
  }

  const incomeTotalRow = section("Income", INCOME);
  ws.addRow([]);
  const expenseTotalRow = section("Expenses", EXPENSES);
  ws.addRow([]);

  const net = ws.addRow(["Net (Income − Expenses)"]);
  net.font = { bold: true };
  MONTH_COLS.forEach((c) => {
    net.getCell(c).value = {
      formula: `${c}${incomeTotalRow}-${c}${expenseTotalRow}`,
    };
  });
  net.getCell(TOTAL_COL).value = rowTotal(net.number);

  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as Uint8Array);
}
