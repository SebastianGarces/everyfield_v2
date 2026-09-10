// ============================================================================
// Board / Elder Meeting Agenda — docx template (F6)
// ============================================================================

import { HeadingLevel, Paragraph, TextRun } from "docx";

import { handout, agendaTable } from "./layout";
import type { Document } from "docx";

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
  const header = documentSubtitle(churchName, values.meeting_date || null);

  return handout(
    [
      new Paragraph({
        heading: HeadingLevel.TITLE,
        text: "Board and Elder Meeting Agenda",
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: header, color: "6B7280" })],
      }),
      agendaTable(AGENDA),
      new Paragraph({
        text: "Action / owner / due date",
        heading: HeadingLevel.HEADING_1,
      }),
      new Paragraph({
        text: "________________________________________________________________",
      }),
    ],
    "Board and elder meeting"
  );
}
