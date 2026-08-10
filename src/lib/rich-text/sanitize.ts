// ============================================================================
// Rich Text Sanitiser (COM-017 / T-021)
// ============================================================================
//
// ONE sanitiser for every place the product stores author-written HTML. It is
// the security gate, not a formatter: stored user HTML that reaches an outbound
// email is an injection surface, so the rule here is allow-list only — an
// element or attribute that is not named below does not survive, whatever it
// looks like.
//
// It is deliberately dependency-free and DOM-free: it runs in the browser (on
// paste, before the markup ever enters the editor), on the server (before the
// body is stored and before it is rendered into an email), and under the node
// test runner, and all three must agree. A browser-only sanitiser is no gate at
// all — the send path is a POSTable server action that never sees the editor.
//
// Read with `format.ts`, which owns the plain-text <-> HTML conversions built
// on top of this.
// ============================================================================

/** Elements an author may keep. Everything else is unwrapped or dropped. */
export const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "a",
  "ul",
  "ol",
  "li",
] as const;

export type AllowedTag = (typeof ALLOWED_TAGS)[number];

const ALLOWED_TAG_SET = new Set<string>(ALLOWED_TAGS);

/**
 * Presentational synonyms browsers still emit (`document.execCommand` produces
 * `<b>`/`<i>`, and contentEditable wraps blocks in `<div>`). Normalised rather
 * than dropped so the stored markup has one spelling per meaning.
 */
const TAG_ALIASES: Record<string, AllowedTag> = {
  b: "strong",
  i: "em",
  div: "p",
  ins: "u",
};

/** Elements whose CONTENT is not author text — dropped whole, not unwrapped. */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "svg",
  "math",
  "head",
  "title",
  "xmp",
  "textarea",
  "canvas",
  "video",
  "audio",
]);

/** Elements that never carry a closing tag. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** The only URL schemes a link may carry. */
const SAFE_URL_SCHEME = /^(?:https?|mailto|tel):/i;

/** Anything shaped like `scheme:` at the head of a URL. */
const ANY_URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Whitespace and C0/C1 controls, which a browser ignores inside a URL. */
// eslint-disable-next-line no-control-regex
const URL_NOISE = new RegExp("[\\u0000-\\u0020\\u007f-\\u009f]", "g");

/**
 * Nesting deeper than this is not authored content — it is an attempt to make
 * the sanitiser (or the renderer downstream of it) do exponential work.
 */
const MAX_DEPTH = 32;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  tab: "\t",
  newline: "\n",
  colon: ":",
  sol: "/",
  lpar: "(",
  rpar: ")",
};

/**
 * Escape text for insertion into HTML.
 *
 * Both quote forms are escaped, so the same function is safe for text nodes and
 * for attribute values.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeFromCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

/**
 * Decode the entity forms a browser would decode inside an attribute value.
 *
 * This exists for ONE reason: `&#106;avascript:alert(1)` and `javascript:` are
 * the same URL to a browser, so the scheme check has to run on the decoded
 * form. The trailing semicolon is optional because browsers accept it missing.
 */
export function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi,
    (match, body: string) => {
      const lower = body.toLowerCase();
      if (lower.startsWith("#x")) {
        return safeFromCodePoint(Number.parseInt(lower.slice(2), 16), match);
      }
      if (lower.startsWith("#")) {
        return safeFromCodePoint(Number.parseInt(lower.slice(1), 10), match);
      }
      return NAMED_ENTITIES[lower] ?? match;
    }
  );
}

/**
 * Return the URL a link may keep, or `null` if it may not keep one.
 *
 * A rejected href does not mean a rejected link: the caller unwraps the anchor
 * and keeps the text, so a hostile `href` costs the user their link and nothing
 * else.
 */
export function sanitizeUrl(raw: string): string | null {
  // Entities are decoded and control characters stripped BEFORE the scheme
  // test: `java&Tab;script:` and `java\nscript:` are `javascript:` to a browser.
  const decoded = decodeHtmlEntities(raw).replace(URL_NOISE, "").trim();

  if (!decoded) return null;
  // Protocol-relative (`//evil.example`) resolves against the host page, which
  // in an email is nothing useful. Rejected rather than guessed at.
  if (decoded.startsWith("//")) return null;
  if (ANY_URL_SCHEME.test(decoded)) {
    return SAFE_URL_SCHEME.test(decoded) ? decoded : null;
  }
  return decoded;
}

interface ParsedTag {
  /** Index just past the closing `>`. */
  end: number;
  /** Raw attribute text between the tag name and the `>`. */
  attributes: string;
  /** `<a href="x" />` — an open tag that closes itself. */
  selfClosing: boolean;
}

/**
 * Find the end of a tag, honouring quoted attribute values so that a `>`
 * inside `href="a>b"` does not end it early.
 */
function readTag(source: string, from: number): ParsedTag {
  let i = from;
  let quote: string | null = null;

  while (i < source.length) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      const attributes = source.slice(from, i);
      return {
        end: i + 1,
        attributes: attributes.replace(/\/\s*$/, ""),
        selfClosing: /\/\s*$/.test(attributes),
      };
    }
    i += 1;
  }

  // Unterminated tag: everything left is markup, none of it usable.
  return { end: source.length, attributes: "", selfClosing: false };
}

const ATTRIBUTE_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'`=<>]+))?/g;

function readAttribute(attributes: string, name: string): string | null {
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(attributes)) !== null) {
    if (match[1].toLowerCase() !== name) continue;
    const raw = match[2];
    if (raw === undefined) return "";
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  return null;
}

/** Skip past `</name>`, dropping everything in between. */
function skipToClosingTag(source: string, from: number, name: string): number {
  const closing = new RegExp(`</\\s*${name}\\b[^>]*>`, "i");
  const match = closing.exec(source.slice(from));
  return match ? from + match.index + match[0].length : source.length;
}

/** The allow-listed element this raw tag name becomes, or `null` to unwrap. */
function mapTagName(rawName: string): AllowedTag | null {
  const alias = TAG_ALIASES[rawName];
  if (alias) return alias;
  return ALLOWED_TAG_SET.has(rawName) ? (rawName as AllowedTag) : null;
}

/**
 * Sanitise author HTML down to the allow-list above.
 *
 * Guarantees, each pinned by `sanitize.test.ts`:
 *  - no element outside `ALLOWED_TAGS` survives;
 *  - no attribute other than a vetted `href` on `<a>` survives, so no `on*`
 *    handler can, whatever its casing or spacing;
 *  - `<script>`/`<style>`/`<svg>` and friends lose their CONTENT too;
 *  - every remaining tag is balanced and closed, in the order it was opened;
 *  - text is escaped, so a `<` an author typed stays a `<` they typed.
 */
export function sanitizeRichText(input: string): string {
  if (!input) return "";

  const out: string[] = [];
  const stack: AllowedTag[] = [];
  let i = 0;

  const closeThrough = (tag: AllowedTag) => {
    const at = stack.lastIndexOf(tag);
    if (at === -1) return;
    while (stack.length > at) {
      out.push(`</${stack.pop()}>`);
    }
  };

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      out.push(escapeHtml(input.slice(i)));
      break;
    }
    if (lt > i) out.push(escapeHtml(input.slice(i, lt)));

    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith("<!", lt) || input.startsWith("<?", lt)) {
      const end = input.indexOf(">", lt);
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    const name = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(
      input.slice(lt, lt + 64)
    );
    if (!name) {
      // A bare `<` the author typed. It is text, not the start of a tag.
      out.push("&lt;");
      i = lt + 1;
      continue;
    }

    const isClosing = name[1] === "/";
    const rawName = name[2].toLowerCase();
    const tag = readTag(input, lt + name[0].length);
    i = tag.end;

    if (DROP_WITH_CONTENT.has(rawName)) {
      if (!isClosing && !VOID_TAGS.has(rawName) && !tag.selfClosing) {
        i = skipToClosingTag(input, i, rawName);
      }
      continue;
    }

    const mapped = mapTagName(rawName);
    if (!mapped) continue; // Unknown element: unwrapped, its children kept.

    if (isClosing) {
      closeThrough(mapped);
      continue;
    }

    if (mapped === "br") {
      out.push("<br>");
      continue;
    }

    if (stack.length >= MAX_DEPTH) continue;

    if (mapped === "a") {
      const href = readAttribute(tag.attributes, "href");
      const safe = href === null ? null : sanitizeUrl(href);
      // A link we cannot vouch for keeps its text and loses its anchor.
      if (!safe) continue;
      out.push(
        `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">`
      );
      stack.push("a");
      if (tag.selfClosing) closeThrough("a");
      continue;
    }

    out.push(`<${mapped}>`);
    stack.push(mapped);
    if (tag.selfClosing) closeThrough(mapped);
  }

  while (stack.length > 0) {
    out.push(`</${stack.pop()}>`);
  }

  return out.join("");
}
