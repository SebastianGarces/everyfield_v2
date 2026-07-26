// ============================================================================
// Document Templates — PDF render registry (F6)
// ============================================================================
//
// Maps a template id to its react-pdf component and renders it to a Buffer.
// Server-only (imports @react-pdf/renderer). Called from the generation route.
// ============================================================================

import { renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";

import type { DocumentMergeValues } from "../types";
import { CommitmentCardDocument } from "./commitment-card";
import { LaunchSundayChecklistsDocument } from "./launch-sunday-checklists";
import { ResponseCardDocument } from "./response-card";
import { SignInSheetDocument } from "./sign-in-sheet";
import { VisionMeetingAgendaDocument } from "./vision-meeting-agenda";

type TemplateComponent = (props: {
  values: DocumentMergeValues;
}) => ReactElement;

const PDF_COMPONENTS: Record<string, TemplateComponent> = {
  "commitment-card": CommitmentCardDocument,
  "response-card": ResponseCardDocument,
  "guest-sign-in-sheet": SignInSheetDocument,
  "vision-meeting-agenda": VisionMeetingAgendaDocument,
  "launch-sunday-checklists": LaunchSundayChecklistsDocument,
};

export function hasRenderer(templateId: string): boolean {
  return templateId in PDF_COMPONENTS;
}

/**
 * Render a template to a PDF Buffer. Throws if the template id has no renderer.
 */
export async function renderDocumentPdf(
  templateId: string,
  values: DocumentMergeValues
): Promise<Buffer> {
  const Component = PDF_COMPONENTS[templateId];
  if (!Component) {
    throw new Error(`No PDF renderer for template "${templateId}"`);
  }
  return renderToBuffer(<Component values={values} />);
}
