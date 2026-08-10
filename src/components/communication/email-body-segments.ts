// ============================================================================
// Rich email body -> segments (COM-017)
// ============================================================================
//
// A composed body is now HTML, and the RSVP call-to-action is still a pair of
// tokens the merge engine leaves behind (`__EF_CONFIRM__` / `__EF_DECLINE__`).
// The email template has to turn those tokens into real buttons, which means
// cutting the body at them.
//
// Cutting an HTML string at an arbitrary offset is how you ship `<p>` tags that
// never close. So the cut is made at BLOCK boundaries: a paragraph that holds a
// placeholder is removed whole and replaced by a button segment, and whatever
// text shared that paragraph is re-emitted as its own balanced paragraph. Every
// `html` segment this returns is therefore renderable on its own.
// ============================================================================

// Imported from the constants module, NOT from the email template that renders
// them: the template imports this splitter, and importing back would be a cycle
// that leaves one of the two holding `undefined` at load time.
import {
  CONFIRM_PLACEHOLDER,
  DECLINE_PLACEHOLDER,
} from "@/lib/email/rsvp-placeholders";

export type RichEmailSegment =
  | { type: "html"; html: string }
  | { type: "buttons" };

const PLACEHOLDER_PATTERN = new RegExp(
  `${CONFIRM_PLACEHOLDER}|${DECLINE_PLACEHOLDER}`,
  "g"
);

const PARAGRAPH_PATTERN = /<p>([\s\S]*?)<\/p>/g;

function hasPlaceholder(value: string): boolean {
  return (
    value.includes(CONFIRM_PLACEHOLDER) || value.includes(DECLINE_PLACEHOLDER)
  );
}

/** Drop the tokens and the line breaks they left stranded. */
function stripPlaceholders(value: string): string {
  return value
    .replace(PLACEHOLDER_PATTERN, "")
    .replace(/(?:\s*<br\s*\/?>\s*)+/gi, "<br>")
    .replace(/^(?:\s|<br\s*\/?>)+/i, "")
    .replace(/(?:\s|<br\s*\/?>)+$/i, "")
    .trim();
}

/**
 * Split a run of HTML that is not a single paragraph. Used for the leftovers —
 * a placeholder someone typed outside any block. The tokens are removed and a
 * button segment takes their place.
 */
function splitLooseHtml(html: string): RichEmailSegment[] {
  if (!hasPlaceholder(html)) {
    return html.trim() ? [{ type: "html", html }] : [];
  }

  const segments: RichEmailSegment[] = [];
  PLACEHOLDER_PATTERN.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = PLACEHOLDER_PATTERN.exec(html)) !== null) {
    const before = html.slice(last, match.index);
    if (before.trim()) segments.push({ type: "html", html: before });
    if (segments[segments.length - 1]?.type !== "buttons") {
      segments.push({ type: "buttons" });
    }
    last = match.index + match[0].length;
  }

  const tail = html.slice(last);
  if (tail.trim()) segments.push({ type: "html", html: tail });
  return segments;
}

/**
 * Split a sanitised, merge-rendered HTML body into renderable segments.
 *
 * Consecutive placeholders collapse into ONE button segment: the seeded
 * templates put `{{confirm_link}}` and `{{decline_link}}` on adjacent lines,
 * and that is one call to action, not two.
 */
export function parseRichEmailBody(html: string): RichEmailSegment[] {
  if (!html) return [];
  if (!hasPlaceholder(html)) {
    return html.trim() ? [{ type: "html", html }] : [];
  }

  const segments: RichEmailSegment[] = [];
  const pushHtml = (value: string) => {
    for (const segment of splitLooseHtml(value)) {
      if (
        segment.type === "buttons" &&
        segments[segments.length - 1]?.type === "buttons"
      ) {
        continue;
      }
      segments.push(segment);
    }
  };
  const pushButtons = () => {
    if (segments[segments.length - 1]?.type === "buttons") return;
    segments.push({ type: "buttons" });
  };

  PARAGRAPH_PATTERN.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = PARAGRAPH_PATTERN.exec(html)) !== null) {
    if (!hasPlaceholder(match[1])) continue;

    pushHtml(html.slice(last, match.index));

    const remainder = stripPlaceholders(match[1]);
    if (remainder) segments.push({ type: "html", html: `<p>${remainder}</p>` });
    pushButtons();

    last = match.index + match[0].length;
  }

  pushHtml(html.slice(last));
  return segments;
}
