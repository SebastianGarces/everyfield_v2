// ============================================================================
// Vision Meeting Agenda — docx template (F6)
// ============================================================================
//
// Editable (.docx) counterpart of the print-ready PDF agenda, so planters can
// tailor the flow before a meeting.
// ============================================================================

import { HeadingLevel, Paragraph, TextRun } from "docx";

import {
  VISION_MEETING_AGENDA,
  visionMeetingClosing,
} from "../content/vision-meeting-agenda";
import { handout, agendaTable } from "./layout";
import type { Document } from "docx";

import { churchNameOf, documentSubtitle } from "../render-text";
import type { DocumentMergeValues } from "../types";

export function buildVisionMeetingAgenda(
  values: DocumentMergeValues
): Document {
  const churchName = churchNameOf(values);
  const header = documentSubtitle(churchName, values.meeting_date || null);

  return handout(
    [
      new Paragraph({
        heading: HeadingLevel.TITLE,
        text: "Vision Meeting Agenda",
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: header, color: "6B7280" })],
      }),
      agendaTable(VISION_MEETING_AGENDA),
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
    "Vision meeting"
  );
}
