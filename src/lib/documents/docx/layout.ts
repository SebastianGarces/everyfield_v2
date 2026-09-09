import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

/** Letter geometry and typography shared by editable church handouts. */
export function handout(
  children: (Paragraph | Table)[],
  footer: string
): Document {
  return new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22, color: "000000" },
          paragraph: { spacing: { after: 120, line: 276 }, widowControl: true },
        },
      },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 38, bold: true, color: "000000" },
          paragraph: { spacing: { after: 160 }, keepNext: true },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          run: { size: 26, bold: true, color: "000000" },
          paragraph: { spacing: { before: 200, after: 80 }, keepNext: true },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: {
              top: 1008,
              right: 1080,
              bottom: 1008,
              left: 1080,
              footer: 480,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: footer, size: 17, color: "465766" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

export function signature(): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 400, after: 60 },
      keepNext: true,
      text: "Signature __________________________________   Date ______________",
    }),
    new Paragraph({
      text: "Printed name __________________________________________________",
      spacing: { before: 200 },
    }),
  ];
}

export function agendaTable(
  items: readonly { title: string; detail: string }[]
): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" };
  return new Table({
    width: { size: 10080, type: WidthType.DXA },
    columnWidths: [400, 9680],
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: items.map(
      (item, i) =>
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 400, type: WidthType.DXA },
              margins: { top: 100, bottom: 100, left: 80, right: 80 },
              children: [
                new Paragraph({
                  text: String(i + 1),
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
            new TableCell({
              width: { size: 9680, type: WidthType.DXA },
              margins: { top: 100, bottom: 100, left: 140, right: 140 },
              shading: { fill: i % 2 ? "F3F5F6" : "FFFFFF" },
              children: [
                new Paragraph({
                  keepNext: true,
                  spacing: { after: 30 },
                  children: [new TextRun({ text: item.title, bold: true })],
                }),
                new Paragraph({
                  text: item.detail,
                  spacing: { after: 30 },
                }),
              ],
            }),
          ],
        })
    ),
  });
}
