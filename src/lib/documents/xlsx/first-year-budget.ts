// ============================================================================
// First-Year Budget — xlsx template (F6)
// ============================================================================
//
// A 12-month budget worksheet with income/expense categories and live SUM
// formulas, so planters get a working spreadsheet (not a static dump).
// ============================================================================

import ExcelJS from "exceljs";

import { formatBudget } from "./layout";

import { churchNameOf } from "../render-text";
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

/** Excel limits the full serialized header to 255 characters, including commands.
 * Also cap the name prefix at 60 characters plus an ellipsis so wide glyphs fit.
 * The complete church name stays in A1; an ellipsis marks print-only shortening.
 */
function printHeader(churchName: string): string {
  const prefix = '&L&"Calibri,Bold"&12First-Year Budget\n&"Calibri,Regular"&10';
  const suffix =
    "\n&9Enter amounts in blue cells. Totals calculate automatically. Amounts in USD.";
  const available = 255 - prefix.length - suffix.length;
  const characters = Array.from(churchName.replace(/\s+/g, " "));
  let name = "";
  let count = 0;
  for (const character of characters) {
    const escaped = character === "&" ? "&&" : character;
    // Reserve one character for the ellipsis; never split an escape or surrogate.
    if (count === 60 || name.length + escaped.length > available - 1) break;
    name += escaped;
    count++;
  }
  return prefix + name + (count < characters.length ? "…" : "") + suffix;
}

export async function buildFirstYearBudget(
  values: DocumentMergeValues
): Promise<Buffer> {
  const churchName = churchNameOf(values);
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet("First-Year Budget");

  ws.getColumn(1).width = 34;
  MONTH_COLS.forEach((c) => (ws.getColumn(c).width = 15));
  ws.getColumn(TOTAL_COL).width = 18;

  const title = ws.addRow([`${churchName} — First-Year Budget`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([]);

  const header = ws.addRow(["Category", ...MONTHS, "Total"]);
  header.font = { bold: true };

  const rowTotal = (r: number) => ({
    formula: `SUM(${MONTH_COLS[0]}${r}:${MONTH_COLS[11]}${r})`,
    result: 0,
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
      totals.getCell(c).value = {
        formula: `SUM(${c}${first}:${c}${last})`,
        result: 0,
      };
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
      result: 0,
    };
  });
  net.getCell(TOTAL_COL).value = rowTotal(net.number);

  formatBudget(ws, 14);
  ws.headerFooter.oddHeader = printHeader(churchName);

  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as Uint8Array);
}
