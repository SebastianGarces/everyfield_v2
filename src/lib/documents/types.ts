// ============================================================================
// Document Templates — Types (F6)
// ============================================================================
//
// Phase-1 MVP: templates are code-defined (no DB table). Each template carries
// metadata for the library UI plus a list of merge fields. Documents are
// generated on-demand and streamed to the browser; generated-document history
// (the `documents` table) is a deferred follow-up.
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

export type DocumentFormat = "pdf" | "docx";

export const FORMAT_LABELS: Record<DocumentFormat, string> = {
  pdf: "PDF",
  docx: "Word (.docx)",
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
};

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
  /** Source of the auto-filled default value, if any. */
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
