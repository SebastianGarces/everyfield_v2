// ============================================================================
// Expectations of a Core Group Member — docx template (F6)
// ============================================================================

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Paragraph,
  TextRun,
} from "docx";

import type { DocumentMergeValues } from "../types";

const EXPECTATIONS: string[] = [
  "Be present — attend vision meetings, core-group gatherings, and (once it begins) weekly worship.",
  "GROW — actively and prayerfully invite others into the life of the church.",
  "PRAY — commit to regular prayer for the plant, its leaders, and the people being reached.",
  "GIVE — support the work financially with generosity and consistency.",
  "Serve — take part in a ministry team and use your gifts to build up the body.",
];

export function buildMemberExpectations(values: DocumentMergeValues): Document {
  const churchName = values.church_name || "Our Church";

  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            text: "Expectations of a Core Group Member",
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [new TextRun({ text: churchName, bold: true })],
          }),
          new Paragraph({
            spacing: { after: 160 },
            text: `Joining the core group of ${churchName} is a meaningful commitment. As a founding member, you help lay the foundation this church will be built on. Here is what we ask of every core-group member:`,
          }),
          ...EXPECTATIONS.map(
            (text) =>
              new Paragraph({
                text,
                bullet: { level: 0 },
                spacing: { after: 80 },
              })
          ),
          new Paragraph({
            spacing: { before: 240, after: 80 },
            text: "I have read and understand these expectations, and I commit to them for this season of planting.",
          }),
          new Paragraph({
            spacing: { before: 200 },
            text: "Signed: ______________________________    Date: ______________",
          }),
          ...(values.pastor_name
            ? [
                new Paragraph({
                  spacing: { before: 200 },
                  children: [
                    new TextRun({ text: values.pastor_name, italics: true }),
                  ],
                }),
              ]
            : []),
        ],
      },
    ],
  });
}
