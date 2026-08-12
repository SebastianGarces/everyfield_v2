// ============================================================================
// Board / Elder Meeting Agenda — docx template (F6)
// ============================================================================

import { Document, HeadingLevel, Paragraph, TextRun } from "docx";

import { churchNameOf, documentSubtitle } from "../render-text";
import type { DocumentMergeValues } from "../types";

const AGENDA: { title: string; detail: string }[] = [
  { title: "Opening & Prayer", detail: "Welcome and open in prayer." },
  {
    title: "Review of Previous Minutes",
    detail: "Approve minutes from the last meeting.",
  },
  {
    title: "Financial Report",
    detail: "Giving, expenses, and budget-vs-actual review.",
  },
  {
    title: "Ministry Updates",
    detail: "Reports from ministry teams and current initiatives.",
  },
  { title: "Old Business", detail: "Follow-up on prior action items." },
  { title: "New Business", detail: "Decisions and discussion items." },
  {
    title: "Action Items & Next Steps",
    detail: "Assign owners and due dates.",
  },
  { title: "Prayer & Close", detail: "Close in prayer." },
];

export function buildBoardMeetingAgenda(values: DocumentMergeValues): Document {
  const churchName = churchNameOf(values);
  const header = documentSubtitle(
    "Board / Elder Meeting Agenda",
    values.meeting_date || null
  );

  return new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: churchName }),
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
        ],
      },
    ],
  });
}
