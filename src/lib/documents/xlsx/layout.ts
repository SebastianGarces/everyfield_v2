import ExcelJS from "exceljs";

// ExcelJS accepts OOXML paper size 1 at runtime, but its published enum omits
// Letter. Complete the declaration instead of casting a valid value away.
declare module "exceljs" {
  const enum PaperSize {
    Letter = 1,
  }
}

export const CURRENCY_FORMAT = '"$"#,##0.00;[Red]("$"#,##0.00);"$"0.00';

/** Shared print and editing conventions for the two blank budget planners. */
export function formatBudget(ws: ExcelJS.Worksheet, lastColumn: number) {
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3, showGridLines: false }];
  ws.pageSetup = {
    paperSize: 1,
    orientation: lastColumn > 3 ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: lastColumn > 3 ? 2 : 1,
    fitToHeight: 1,
    printTitlesColumn: "A:A",
    printTitlesRow: lastColumn > 3 ? undefined : "1:3",
    // ExcelJS adds absolute column markers but leaves row markers to callers.
    printArea: `A$${lastColumn > 3 ? 3 : 1}:${ws.getColumn(lastColumn).letter}$${ws.rowCount}`,
    margins: {
      left: 0.35,
      right: 0.35,
      top: lastColumn > 3 ? 0.85 : 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    },
  };
  ws.headerFooter.oddFooter = "&LBudget planner&RPage &P of &N";
  ws.mergeCells(1, 1, 1, lastColumn);
  ws.mergeCells(2, 1, 2, lastColumn);
  ws.getCell("A2").value =
    "Enter amounts in blue cells. Totals calculate automatically. Amounts in USD.";
  ws.eachRow((row, index) => {
    row.height = index === 1 ? 34 : index === 2 ? 30 : 28;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = {
        name: "Calibri",
        size: 11,
        color: { argb: "FF172B3A" },
        bold: cell.font?.bold,
      };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    if (index > 3 && row.getCell(1).value && !row.font?.bold) {
      for (let c = 2; c <= lastColumn; c++) {
        const cell = row.getCell(c);
        cell.numFmt = CURRENCY_FORMAT;
        cell.alignment = { horizontal: "right", vertical: "middle" };
        if (cell.type !== ExcelJS.ValueType.Formula) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFEAF3FC" },
          };
          cell.font = {
            name: "Calibri",
            size: 11,
            color: { argb: "FF174A8B" },
          };
        }
      }
    }
  });
  ws.getCell("A1").font = {
    name: "Calibri",
    bold: true,
    size: 18,
    color: { argb: "FF172B3A" },
  };
  ws.getCell("A2").font = {
    name: "Calibri",
    size: 10,
    color: { argb: "FF465766" },
  };
  for (let c = 1; c <= lastColumn; c++) {
    const cell = ws.getRow(3).getCell(c);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF172B3A" },
    };
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    if (c > 1) ws.getColumn(c).numFmt = CURRENCY_FORMAT;
  }
  ws.eachRow((row) => {
    if (row.number <= 3 || !row.font?.bold) return;
    for (let c = 1; c <= lastColumn; c++) {
      const cell = row.getCell(c);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8ECEF" },
      };
      cell.font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "FF172B3A" },
      };
      cell.border = { top: { style: "thin", color: { argb: "FFBAC4CC" } } };
    }
  });
  ws.addConditionalFormatting({
    ref: `B${ws.rowCount}:${ws.getColumn(lastColumn).letter}${ws.rowCount}`,
    rules: [
      {
        type: "cellIs",
        operator: "lessThan",
        formulae: ["0"],
        priority: 1,
        style: {
          font: { bold: true, color: { argb: "FF9C0006" } },
          fill: {
            type: "pattern",
            pattern: "solid",
            bgColor: { argb: "FFFFC7CE" },
          },
        },
      },
    ],
  });
}
