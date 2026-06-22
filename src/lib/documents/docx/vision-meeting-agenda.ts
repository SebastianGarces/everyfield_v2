// ============================================================================
// Vision Meeting Agenda — docx template (F6)
// ============================================================================
//
// Editable (.docx) counterpart of the print-ready PDF agenda, so planters can
// tailor the flow before a meeting.
// ============================================================================

import { Document, HeadingLevel, Paragraph, TextRun } from "docx";

import type { DocumentMergeValues } from "../types";

const AGENDA: { title: string; detail: string }[] = [
  {
    title: "Welcome & Connection",
    detail: "Greet guests, brief introductions, set a warm tone.",
  },
  {
    title: "Our Story",
    detail: "Why this church, why now — the planter's calling.",
  },
  {
    title: "The Vision",
    detail: "Who we're reaching, what kind of church we're becoming.",
  },
  {
    title: "GROW · PRAY · GIVE",
    detail: "The invitation to join the core group and how to take part.",
  },
  {
    title: "Next Steps",
    detail: "Commitment cards, upcoming dates, and how to stay connected.",
  },
  {
    title: "Prayer & Close",
    detail: "Pray over the mission and the people in the room.",
  },
];

export function buildVisionMeetingAgenda(
  values: DocumentMergeValues
): Document {
  const churchName = values.church_name || "Our Church";
  const header = ["Vision Meeting Agenda", values.meeting_date || null]
    .filter(Boolean)
    .join("  •  ");

  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            text: churchName,
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [new TextRun({ text: header, color: "6B7280" })],
          }),
          ...AGENDA.flatMap((item, i) => [
            new Paragraph({
              spacing: { before: 120, after: 20 },
              children: [
                new TextRun({ text: `${i + 1}. ${item.title}`, bold: true }),
              ],
            }),
            new Paragraph({
              children: [new TextRun({ text: item.detail, color: "6B7280" })],
            }),
          ]),
          new Paragraph({
            spacing: { before: 240 },
            children: [
              new TextRun({
                text: values.pastor_name
                  ? `Led by ${values.pastor_name}`
                  : "Keep it to 45–60 minutes. End on time and on vision.",
                italics: true,
                color: "6B7280",
              }),
            ],
          }),
        ],
      },
    ],
  });
}
