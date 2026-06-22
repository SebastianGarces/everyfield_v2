// ============================================================================
// Launch Team Commitment — docx template (F6)
// ============================================================================

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Paragraph,
  TextRun,
} from "docx";

import type { DocumentMergeValues } from "../types";

const COMMITMENTS: string[] = [
  "Attend launch-team gatherings and the weekly run-up to Launch Sunday.",
  "Serve on a ministry team and prepare for my role on launch day.",
  "Invite and personally bring guests as we approach launch.",
  "Pray regularly for the launch, the team, and the people we're reaching.",
  "Give generously to resource the launch.",
];

export function buildLaunchTeamCommitment(
  values: DocumentMergeValues
): Document {
  const churchName = values.church_name || "Our Church";

  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            text: "Launch Team Commitment",
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [new TextRun({ text: churchName, bold: true })],
          }),
          new Paragraph({
            spacing: { after: 160 },
            text: `As a member of the launch team of ${churchName}, I'm committing to help carry this church from a core group to a launched, worshiping congregation. For this season I commit to:`,
          }),
          ...COMMITMENTS.map(
            (text) =>
              new Paragraph({
                text,
                bullet: { level: 0 },
                spacing: { after: 80 },
              })
          ),
          new Paragraph({
            spacing: { before: 240 },
            text: "Signed: ______________________________    Date: ______________",
          }),
          ...(values.pastor_name
            ? [
                new Paragraph({
                  spacing: { before: 200 },
                  children: [
                    new TextRun({
                      text: `With you in the mission, ${values.pastor_name}`,
                      italics: true,
                    }),
                  ],
                }),
              ]
            : []),
        ],
      },
    ],
  });
}
