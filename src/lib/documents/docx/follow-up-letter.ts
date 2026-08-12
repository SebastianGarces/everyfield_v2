// ============================================================================
// Vision Meeting Follow-up Letter — docx template (F6)
// ============================================================================
//
// Editable letter to send a guest after a vision meeting. Planters tailor the
// body per person before sending.
// ============================================================================

import { Document, Paragraph, TextRun } from "docx";

import { churchNameOf } from "../render-text";
import type { DocumentMergeValues } from "../types";

export function buildFollowUpLetter(values: DocumentMergeValues): Document {
  const churchName = churchNameOf(values);
  const signOff = values.pastor_name || `The ${churchName} Team`;

  const body: string[] = [
    "Dear Friend,",
    `Thank you for joining us — it genuinely meant a lot to have you in the room. We're praying about what God is going to do through ${churchName}, and we'd love for you to be part of it.`,
    "We sensed real interest from you, and we don't want to let that connection drop. Over the next week we'd love to grab coffee, answer any questions, and share more about where things are headed and how you might get involved.",
    "If GROW, PRAY, and GIVE resonated with you, the next step is simple: come to the next gathering and bring someone with you. We'll follow up to find a time to connect.",
    "Grateful for you,",
  ];

  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            spacing: { after: 240 },
            children: [new TextRun({ text: "Date: ______________" })],
          }),
          ...body.map(
            (text) =>
              new Paragraph({
                text,
                spacing: { after: 160 },
              })
          ),
          new Paragraph({
            spacing: { before: 80 },
            children: [new TextRun({ text: signOff, bold: true })],
          }),
          new Paragraph({
            children: [new TextRun({ text: churchName, italics: true })],
          }),
        ],
      },
    ],
  });
}
