// ============================================================================
// Document Templates — shared render text (F6)
// ============================================================================
//
// The two rendering decisions every renderer used to copy-paste, in one
// place: what to call a church whose name is missing, and how subtitle parts
// are joined. Plain data/functions — safe to import from any renderer.
// ============================================================================

import type { DocumentMergeValues } from "./types";

/** What a document calls the church when no name was merged in. */
export const DEFAULT_CHURCH_NAME = "Our Church";

/** The church name to print — the merged value, or the neutral fallback. */
export function churchNameOf(values: DocumentMergeValues): string {
  return values.church_name || DEFAULT_CHURCH_NAME;
}

/**
 * Join subtitle parts with the documents' separator, dropping empty parts.
 * The separator (two spaces, bullet, two spaces) is ONE literal here, so a
 * typo cannot make a subtitle look wrong in exactly one format.
 */
export function documentSubtitle(
  ...parts: (string | null | undefined)[]
): string {
  return parts.filter(Boolean).join("  •  ");
}
