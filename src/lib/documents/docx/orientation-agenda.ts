import { HeadingLevel, Paragraph, TextRun } from "docx";

import { orientationAgendaContent } from "../content/orientation-agenda";
import { churchNameOf } from "../render-text";
import type { DocumentMergeValues } from "../types";
import { handout } from "./layout";

export function buildOrientationAgenda(values: DocumentMergeValues) {
  const content = orientationAgendaContent(values);
  return handout(
    [
      new Paragraph({ heading: HeadingLevel.TITLE, text: content.title }),
      new Paragraph({ text: churchNameOf(values) }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        text: content.meetingTitle,
      }),
      ...content.details.map(
        ({ label, value }) =>
          new Paragraph({
            children: [
              new TextRun({ text: `${label}: `, bold: true }),
              new TextRun(value),
            ],
          })
      ),
      new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Agenda" }),
      ...content.agendaLines.map((text) => new Paragraph({ text })),
    ],
    "Orientation"
  );
}
