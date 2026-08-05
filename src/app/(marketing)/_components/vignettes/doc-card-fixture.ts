// ============================================================================
// DOC CARD FIXTURE — the Core Group Commitment Card, taken from the catalog
// the app itself renders.
//
// Source: src/lib/documents/templates.ts, entry `commitment-card` (read
// 2026-08-04). Unlike the other fixtures on this page there is nothing to
// snapshot: document templates are not rows in a database, they are a
// code-defined catalog (the "role-templates" pattern), and that module imports
// nothing but its own types — no `db`, no server-only anything. So the landing
// page reads the real entry instead of copying it, and the card on the
// marketing page says what the document library says, always, including the
// day someone rewrites the description.
//
// Why the lookup can throw: the marketing page is prerendered, so this module
// is evaluated at build time. If the `commitment-card` entry is ever renamed or
// removed, the build fails with the message below rather than the landing page
// quietly losing a card. That is the intended failure mode — the whole point of
// reading the catalog is that the two cannot drift apart in silence.
// ============================================================================

import type { TemplateCardData } from "@/components/documents/template-card-view";
import { DOCUMENT_TEMPLATES } from "@/lib/documents/templates";

const TEMPLATE_ID = "commitment-card";

const entry = DOCUMENT_TEMPLATES.find(
  (template) => template.id === TEMPLATE_ID
);

if (!entry) {
  throw new Error(
    `Marketing doc-card embed: no document template with id "${TEMPLATE_ID}" in src/lib/documents/templates.ts. ` +
      `The landing page's guides panel renders that entry — restore it, or point the embed at another template.`
  );
}

/** The catalog entry, narrowed to the fields the card actually draws. */
export const COMMITMENT_CARD: TemplateCardData = entry;
