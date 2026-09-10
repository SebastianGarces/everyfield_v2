import ExcelJS from "exceljs";

import { churchNameOf } from "../render-text";
import type { DocumentMergeValues } from "../types";
import { formatBudget } from "./layout";

export async function buildBudgetWorksheet(
  values: DocumentMergeValues
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet("Budget Worksheet");
  ws.getColumn(1).width = 38;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 22;
  ws.addRow([`${churchNameOf(values)} — Budget Worksheet`]);
  ws.addRow([]);
  ws.addRow(["Category", "Monthly", "Annual"]);

  function section(label: string, categories: string[]) {
    ws.addRow([label]).font = { bold: true };
    const first = ws.rowCount + 1;
    for (const category of categories) {
      const row = ws.addRow([category]);
      row.getCell(3).value = { formula: `B${row.number}*12`, result: 0 };
    }
    const last = ws.rowCount;
    const total = ws.addRow([`Total ${label}`]);
    total.font = { bold: true };
    for (const col of ["B", "C"])
      total.getCell(col).value = {
        formula: `SUM(${col}${first}:${col}${last})`,
        result: 0,
      };
    return total.number;
  }
  const income = section("Income", [
    "Giving / Tithes",
    "Launch Grants / Partnerships",
  ]);
  ws.addRow([]);
  const expenses = section("Expenses", [
    "Salary / Stipend",
    "Rent / Venue",
    "Equipment & Supplies",
    "Marketing / Outreach",
    "Children's Ministry",
    "Administration",
  ]);
  ws.addRow([]);
  const net = ws.addRow(["Net (Income − Expenses)"]);
  net.font = { bold: true };
  for (const col of ["B", "C"])
    net.getCell(col).value = {
      formula: `${col}${income}-${col}${expenses}`,
      result: 0,
    };
  formatBudget(ws, 3);
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as Uint8Array);
}
