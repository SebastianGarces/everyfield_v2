// ============================================================================
// Document Templates — PDF render registry (F6)
// ============================================================================
//
// Maps a template id to its react-pdf component and renders it to a Buffer.
// Server-only (imports @react-pdf/renderer). Called from the generation route.
//
// It also owns the SERVER half of font registration: the same eight faces the
// browser fetches from `/fonts/`, read straight off disk here. The read is
// deliberately allowed to fail — `registerPdfFonts` then points the eight
// families back at the standard-14 ones these templates used to be set in. A
// missing font asset must never turn a working download into a 500.
// ============================================================================

import { renderToBuffer, Font } from "@react-pdf/renderer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactElement } from "react";

import type { DocumentMergeValues } from "../types";
import { CommitmentCardDocument } from "./commitment-card";
import { registerPdfFonts } from "./fonts";
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

/** Registered template ids — `render.ts` folds these into its format registry. */
export const PDF_TEMPLATE_IDS: readonly string[] = Object.keys(PDF_COMPONENTS);

/**
 * One face's bytes, off disk.
 *
 * The same eight files the browser fetches from `/fonts/`, read straight out of
 * `public/` rather than over HTTP — this runs inside the app, so there is no
 * origin to ask. A rejection is not a defect: `registerPdfFonts` answers it with
 * the standard-14 fallback, so a deployment that does not carry `public/` into
 * the function still generates documents, exactly as it did under those faces.
 */
const readFontFile = (file: string): Promise<Uint8Array> =>
  readFile(path.join(process.cwd(), "public", "fonts", file));

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
  // Before the tree is built: `styles.ts` already names the Unicode families,
  // so they have to resolve to SOMETHING by layout time. Memoized per process.
  await registerPdfFonts(Font, readFontFile);
  return renderToBuffer(<Component values={values} />);
}
