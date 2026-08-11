// ============================================================================
// Document Templates — DOCX render registry (F6)
// ============================================================================
//
// Maps a template id to a `docx` Document builder and packs it to a Buffer.
// Server-only. Called from the generation route when format=docx.
// ============================================================================

import { type Document, Packer } from "docx";

import type { DocumentMergeValues } from "../types";
import { buildBoardMeetingAgenda } from "./board-meeting-agenda";
import { buildFollowUpLetter } from "./follow-up-letter";
import { buildLaunchTeamCommitment } from "./launch-team-commitment";
import { buildMemberExpectations } from "./member-expectations";
import { buildVisionMeetingAgenda } from "./vision-meeting-agenda";

type DocxBuilder = (values: DocumentMergeValues) => Document;

const DOCX_BUILDERS: Record<string, DocxBuilder> = {
  "vision-meeting-agenda": buildVisionMeetingAgenda,
  "member-expectations": buildMemberExpectations,
  "launch-team-commitment": buildLaunchTeamCommitment,
  "follow-up-letter": buildFollowUpLetter,
  "board-meeting-agenda": buildBoardMeetingAgenda,
};

/** Registered template ids — the catalog↔registry sync test enumerates these. */
export const DOCX_TEMPLATE_IDS: readonly string[] = Object.keys(DOCX_BUILDERS);

export function hasDocxRenderer(templateId: string): boolean {
  return templateId in DOCX_BUILDERS;
}

/**
 * Render a template to a .docx Buffer. Throws if the template id has no builder.
 */
export async function renderDocumentDocx(
  templateId: string,
  values: DocumentMergeValues
): Promise<Buffer> {
  const build = DOCX_BUILDERS[templateId];
  if (!build) {
    throw new Error(`No DOCX builder for template "${templateId}"`);
  }
  return Packer.toBuffer(build(values));
}
