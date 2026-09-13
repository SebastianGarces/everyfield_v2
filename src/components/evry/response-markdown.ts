import { Marked } from "marked";
import { escapeHtml } from "@/lib/rich-text/sanitize";

// Markdown is presentation only. Navigation stays in trusted result cards;
// model text cannot introduce clickable URLs, remote images or raw HTML.
const markdown = new Marked({
  breaks: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
    link({ tokens }) {
      return this.parser.parseInline(tokens);
    },
    heading({ tokens }) {
      return `<p><strong>${this.parser.parseInline(tokens)}</strong></p>`;
    },
  },
});

/** Convert only; RichText owns the existing allowlist sanitization. */
export function evryResponseMarkdown(text: string): string {
  return markdown.parse(text, { async: false });
}
