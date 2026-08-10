// ============================================================================
// Rich Text Formatting (COM-017 / T-021)
// ============================================================================
//
// The conversions around `sanitize.ts`: plain text in, safe HTML out, and back
// again for the plain-text half of an email.
//
// The reason this file exists at all is that the product already HAS stored
// bodies — message templates, sent messages, task descriptions — and every one
// of them is plain text with newlines. There is no migration: `toRichTextHtml`
// is the single door, and it decides per value whether it is looking at markup
// (sanitise it) or at legacy plain text (convert it). A reader that skips this
// door shows a planter their own `<strong>` tags.
// ============================================================================

import { decodeHtmlEntities, escapeHtml, sanitizeRichText } from "./sanitize";

/** Does this value carry markup, or is it plain text with newlines? */
export function isHtmlFragment(value: string): boolean {
  return /<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?\/?>/.test(value);
}

/**
 * Convert plain text to the same shape the editor produces: a `<p>` per blank-
 * line-separated block, a `<br>` per single newline inside one.
 */
export function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n{2,}/);

  const paragraphs = blocks
    .map((block) =>
      block
        .split("\n")
        .map((line) => escapeHtml(line))
        .join("<br>")
    )
    .filter((block) => block.trim() !== "");

  if (paragraphs.length === 0) return "";
  return paragraphs.map((block) => `<p>${block}</p>`).join("");
}

/**
 * The one door into rich text. Markup is sanitised; anything else is treated
 * as the legacy plain text it is and converted. Safe to call twice — sanitised
 * HTML sanitises to itself.
 */
export function toRichTextHtml(value: string | null | undefined): string {
  if (!value) return "";
  return isHtmlFragment(value)
    ? sanitizeRichText(value)
    : plainTextToHtml(value);
}

/**
 * Flatten rich text back to plain text — the text/plain half of an email, the
 * one-line summary in a list, a search haystack.
 */
export function richTextToPlainText(html: string | null | undefined): string {
  if (!html) return "";

  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|ul|ol|blockquote)\s*>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<\/li\s*>/gi, "\n");

  return decodeHtmlEntities(withBreaks.replace(/<[^>]*>/g, ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Is there anything here a recipient would see?
 *
 * `<p><br></p>` is what an emptied contentEditable leaves behind, and it is
 * truthy — a `!body.trim()` guard waves it through and sends a blank email.
 */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  return richTextToPlainText(html).replace(/[-\s]/g, "") === "";
}

/**
 * Escape every merge VALUE so substituting into an HTML body cannot inject.
 *
 * The token substitution itself stays where it always was — `renderTemplate` in
 * `@/lib/communication/merge` is the one implementation of "replace `{{x}}`".
 * This only prepares its input, so a person called `Bobby <script>` reaches the
 * email as text. The RSVP placeholders (`__EF_CONFIRM__`) carry no escapable
 * character, so they pass through untouched and the button pass still finds
 * them.
 */
export function escapeMergeValues(
  data: Record<string, string>
): Record<string, string> {
  const escaped: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    escaped[key] = escapeHtml(value);
  }
  return escaped;
}
