import assert from "node:assert/strict";
import { test } from "node:test";

import ExcelJS from "exceljs";

import { buildBudgetWorksheet } from "./budget-worksheet";
import { buildFirstYearBudget } from "./first-year-budget";

for (const [name, build, width] of [
  ["monthly worksheet", buildBudgetWorksheet, 3],
  ["first year", buildFirstYearBudget, 14],
] as const) {
  test(`${name} exports editable currency inputs, frozen context and separate income and expense totals`, async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await build({ church_name: "Test Church" }));
    const ws = wb.worksheets[0];
    assert.equal(ws.views[0].state, "frozen");
    assert.ok("xSplit" in ws.views[0] && ws.views[0].xSplit === 1);
    assert.ok("ySplit" in ws.views[0] && ws.views[0].ySplit === 3);
    assert.equal(ws.pageSetup.paperSize, 1);
    assert.equal(ws.pageSetup.printTitlesRow, width === 14 ? undefined : "1:3");
    assert.ok(ws.getColumn(width).width! >= 15);
    assert.match(ws.getCell("B5").numFmt, /\$/);
    assert.equal(ws.getCell("B5").value, null);
    assert.equal(ws.getCell("B5").fill.type, "pattern");
    const last = ws.lastRow!;
    assert.equal(last.getCell(1).value, "Net (Income − Expenses)");
    const totals = new Map<string, number>();
    ws.eachRow((row) => {
      if (typeof row.getCell(1).value === "string")
        totals.set(String(row.getCell(1).value), row.number);
    });
    for (let c = 2; c <= (width === 3 ? 3 : 13); c++) {
      const col = ws.getColumn(c).letter;
      assert.equal(
        last.getCell(c).formula,
        `${col}${totals.get("Total Income")}-${col}${totals.get("Total Expenses")}`
      );
      assert.equal(last.getCell(c).result, 0);
      assert.match(last.getCell(c).numFmt, /\$/);
    }
  });
}
