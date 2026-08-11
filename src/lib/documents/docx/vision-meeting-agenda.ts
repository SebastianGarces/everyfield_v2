// ============================================================================
// Vision Meeting Agenda — docx template (F6)
// ============================================================================
//
// Editable (.docx) counterpart of the print-ready PDF agenda, so planters can
// tailor the flow before a meeting.
// ============================================================================

import { Document, HeadingLevel, Paragraph, TextRun } from "docx";

import {
  VISION_MEETING_AGENDA,
  visionMeetingClosing,
} from "../content/vision-meeting-agenda";
import { churchNameOf, documentSubtitle } from "../render-text";
import type { DocumentMergeValues } from "../types";

export function buildVisionMeetingAgenda(
  values: DocumentMergeValues
): Document {
  const churchName = churchNameOf(values);
  const header = documentSubtitle(
    "Vision Meeting Agenda",
    values.meeting_date || null
  );

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
          ...VISION_MEETING_AGENDA.flatMap((item, i) => [
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
                text: visionMeetingClosing(values.pastor_name),
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
