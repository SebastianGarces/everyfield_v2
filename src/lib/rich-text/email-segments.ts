// ============================================================================
// Rich email body -> segments (COM-017)
// ============================================================================
//
// A composed body is now HTML, and the RSVP call-to-action is still a pair of
// tokens the merge engine leaves behind (`__EF_CONFIRM__` / `__EF_DECLINE__`).
// The email template has to turn those tokens into real buttons, which means
// cutting the body at them.
//
// Cutting an HTML string at an arbitrary offset is how you ship `<li>` tags
// that open in one `dangerouslySetInnerHTML` and close in the next. So the cut
// is NOT made at the token's offset: the splitter walks the markup with a stack
// of open elements, and at a token it CLOSES every element that is currently
// open, ends the segment there, and RE-OPENS the same elements at the head of
// the next segment. A token inside `<ul><li>…</li></ul>` therefore closes the
// list before the buttons and starts a fresh one after them.
//
// It lives HERE, beside the sanitiser and the door, because it is a string
// operation over rich text and holds no JSX: `src/lib/email/components/` and
// `src/components/communication/` both import it, and a splitter parked under
// `components/` made `lib` depend on `components` to reach it.
//
// Two consequences, both pinned by `email-segments.test.ts`:
//  - every `html` segment is balanced on its own, so each is renderable on its
//    own, whatever element the token was sitting inside;
//  - the concatenation of the segments is balanced too, so the assembled email
//    document has no orphan open or close tag.
//
// Blocks left empty by the cut (the `<p></p>` a token that owned its paragraph
// leaves behind, the `<li></li>` that re-opening a list would otherwise start
// with) are dropped rather than shipped as a stray bullet.
// ============================================================================

// Imported from the constants module, NOT from the email template that renders
// them: the template imports this splitter, and importing back would be a cycle
// that leaves one of the two holding `undefined` at load time.
import {
  CONFIRM_PLACEHOLDER,
  DECLINE_PLACEHOLDER,
} from "@/lib/email/rsvp-placeholders";
// "Which elements are void" and "is there anything here a recipient would see"
// are each ONE decision with one home, and both homes are in this directory:
// `sanitize.ts` (which imports nothing, so there is no cycle) and `format.ts`.
// This module carried a second copy of each — a 14-name `VOID_TAGS` set that
// matched `sanitize.ts` character for character, and a `hasVisibleContent` that
// asked `isRichTextEmpty`'s question forty lines away from it.
import { VOID_TAGS } from "./sanitize";
import { isRichTextEmpty } from "./format";

export type RichEmailSegment =
  | { type: "html"; html: string }
  | { type: "buttons" };

const PLACEHOLDER_PATTERN = new RegExp(
  `${CONFIRM_PLACEHOLDER}|${DECLINE_PLACEHOLDER}`,
  "g"
);

/** Any tag, open or close. Attribute values never contain `>` after sanitising. */
const TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;

/** A block (or anchor) holding nothing a recipient would see. */
const EMPTY_BLOCK_PATTERN =
  /<(p|li|ul|ol)>\s*(?:<br\s*\/?>\s*)*<\/\1>|<a\b[^>]*>\s*(?:<br\s*\/?>\s*)*<\/a>/gi;

interface OpenElement {
  name: string;
  /** The tag exactly as it was written, so re-opening keeps `href`/`rel`. */
  raw: string;
}

type Piece = { kind: "text" | "tag"; value: string };

function hasPlaceholder(value: string): boolean {
  return (
    value.includes(CONFIRM_PLACEHOLDER) || value.includes(DECLINE_PLACEHOLDER)
  );
}

function readTagName(raw: string): { name: string; closing: boolean } | null {
  const match = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(raw);
  if (!match) return null;
  return { name: match[2].toLowerCase(), closing: match[1] === "/" };
}

function isBreak(raw: string): boolean {
  return /^<\s*br\b/i.test(raw);
}

/** Remove the blocks the cut emptied, until nothing more can be removed. */
function dropEmptyBlocks(html: string): string {
  let current = html;
  for (;;) {
    EMPTY_BLOCK_PATTERN.lastIndex = 0;
    const next = current.replace(EMPTY_BLOCK_PATTERN, "");
    if (next === current) return current;
    current = next;
  }
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
  const stack: OpenElement[] = [];
  let buffer: Piece[] = [];
  // True right after a cut: leading whitespace and `<br>`s are the line breaks
  // the token left stranded, not spacing the author asked for.
  let atSeam = true;

  const pushTag = (value: string) => buffer.push({ kind: "tag", value });

  const pushText = (value: string) => {
    let text = value;
    if (atSeam) {
      text = text.replace(/^\s+/, "");
      if (!text) return;
      atSeam = false;
    }
    buffer.push({ kind: "text", value: text });
  };

  /** Drop the whitespace and `<br>`s sitting between the last text and the cut. */
  const trimBufferTail = () => {
    while (buffer.length > 0) {
      const last = buffer[buffer.length - 1];
      if (last.kind === "text") {
        const trimmed = last.value.replace(/\s+$/, "");
        if (trimmed) {
          last.value = trimmed;
          return;
        }
        buffer.pop();
        continue;
      }
      if (isBreak(last.value)) {
        buffer.pop();
        continue;
      }
      return;
    }
  };

  const flushHtml = (closers: string[]) => {
    const assembled = dropEmptyBlocks(
      buffer.map((piece) => piece.value).join("") + closers.join("")
    );
    // "Would a recipient see anything in this?" is `isRichTextEmpty`'s
    // question, and it is asked with `isRichTextEmpty` — the same predicate the
    // compose preview and the send gate use, so a segment that survives the cut
    // and a body that is allowed to be sent agree by construction.
    if (!isRichTextEmpty(assembled)) {
      segments.push({ type: "html", html: assembled });
    }
  };

  const cut = () => {
    trimBufferTail();
    // Close every element that is open, so this segment stands on its own...
    const closers = [...stack].reverse().map((el) => `</${el.name}>`);
    flushHtml(closers);
    if (segments[segments.length - 1]?.type !== "buttons") {
      segments.push({ type: "buttons" });
    }
    // ...and re-open the same elements, so the next one does too.
    buffer = stack.map((el) => ({ kind: "tag" as const, value: el.raw }));
    atSeam = true;
  };

  const consumeText = (text: string) => {
    if (!hasPlaceholder(text)) {
      if (text) pushText(text);
      return;
    }
    PLACEHOLDER_PATTERN.lastIndex = 0;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {
      pushText(text.slice(last, match.index));
      cut();
      last = match.index + match[0].length;
    }
    pushText(text.slice(last));
  };

  TAG_PATTERN.lastIndex = 0;
  let index = 0;
  let tag: RegExpExecArray | null;

  while ((tag = TAG_PATTERN.exec(html)) !== null) {
    consumeText(html.slice(index, tag.index));
    index = tag.index + tag[0].length;

    const parsed = readTagName(tag[0]);
    if (!parsed) {
      pushText(tag[0]);
      continue;
    }

    if (VOID_TAGS.has(parsed.name)) {
      // A `<br>` at a seam is the newline the token left behind — drop it.
      if (!atSeam || !isBreak(tag[0])) pushTag(tag[0]);
      continue;
    }

    if (parsed.closing) {
      const at = stack.map((el) => el.name).lastIndexOf(parsed.name);
      if (at === -1) continue; // Orphan closer: it would unbalance the segment.
      while (stack.length > at) {
        pushTag(`</${stack.pop()!.name}>`);
      }
      continue;
    }

    // `<a ... />` closes itself: emitted, but never left on the stack.
    if (/\/\s*>$/.test(tag[0])) {
      pushTag(tag[0].replace(/\/\s*>$/, ">"));
      pushTag(`</${parsed.name}>`);
      continue;
    }

    pushTag(tag[0]);
    stack.push({ name: parsed.name, raw: tag[0] });
  }

  consumeText(html.slice(index));
  flushHtml([...stack].reverse().map((el) => `</${el.name}>`));

  return segments;
}
