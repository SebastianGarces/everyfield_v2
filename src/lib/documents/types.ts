// ============================================================================
// Document Templates — Types (F6)
// ============================================================================
//
// Templates are code-defined (no DB table — audit decision #15). Each template
// carries metadata for the library UI plus a list of merge fields. Generation
// still streams the file to the browser; the bytes are also stored and a row
// is written to `generated_documents` so history can re-download without
// re-rendering.
// ============================================================================

export type DocumentCategory =
  | "commitment"
  | "vision_meeting"
  | "administrative"
  | "operational"
  | "communication";

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  commitment: "Commitment Documents",
  vision_meeting: "Vision Meeting Materials",
  administrative: "Administrative Documents",
  operational: "Operational Documents",
  communication: "Communication Templates",
};

/** Order categories are rendered in the library. */
export const CATEGORY_ORDER: DocumentCategory[] = [
  "commitment",
  "vision_meeting",
  "administrative",
  "operational",
  "communication",
];

export type DocumentFormat = "pdf" | "docx" | "xlsx";

export const FORMAT_LABELS: Record<DocumentFormat, string> = {
  pdf: "PDF",
  docx: "Word (.docx)",
  xlsx: "Excel (.xlsx)",
};

/** MIME type + file extension per output format. */
export const FORMAT_OUTPUT: Record<
  DocumentFormat,
  { mime: string; ext: string }
> = {
  pdf: { mime: "application/pdf", ext: "pdf" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
};

/**
 * Narrow an untrusted string (e.g. the `?format=` query param) to a
 * `DocumentFormat`. Derived from `FORMAT_OUTPUT`, which already enumerates
 * the formats, so a new format joins the guard by construction.
 */
export function isDocumentFormat(value: string): value is DocumentFormat {
  return Object.hasOwn(FORMAT_OUTPUT, value);
}

/**
 * A merge field on a template. `autoFill` names a value the server can resolve
 * from the church/user profile; fields without it are entered by the planter
 * at generation time (e.g. meeting date, meeting number).
 */
export interface DocumentMergeField {
  /** Token key, used as the search-param name and in the PDF component. */
  key: string;
  label: string;
  required: boolean;
  /**
   * Source of the auto-filled default value, if any.
   *
   * `launch_date` is the TOKEN's name, not a column's — it resolves from the
   * launch entity (`launches.target_date`, LS-001) via `MergeContext`, since
   * migration 0032 dropped `churches.launch_date`. Renaming the token would
   * break every generated document's search-param contract, so it stays.
   */
  autoFill?: "church_name" | "pastor_name" | "launch_date";
  placeholder?: string;
  /** Optional hint rendered under the input. */
  description?: string;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  category: DocumentCategory;
  /** Relevant journey phase (0-6), if any. */
  phase?: number;
  /** Output formats this template can generate (first is the default). */
  formats: DocumentFormat[];
  pageCount: number;
  mergeFields: DocumentMergeField[];
  /** Slug of a related wiki article, rendered as a "Read" link. */
  relatedWikiSlug?: string;
}

/** Resolved merge values keyed by field key. */
export type DocumentMergeValues = Record<string, string>;
