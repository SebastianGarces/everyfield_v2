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
 *
 * `div` is the conditional one — see `divHoldsBlock`. A `<div>` around a run of
 * text IS the paragraph the author meant, but a `<div>` around a list is not:
 * `<p><ul>…</ul></p>` is invalid, and it is exactly what a contentEditable
 * hands us for every list it produces.
 */
const TAG_ALIASES: Record<string, AllowedTag> = {
  b: "strong",
  i: "em",
  div: "p",
  ins: "u",
};

/** Elements that may not sit inside a `<p>`, so a `<div>` holding one unwraps. */
const BLOCK_CHILD_TAGS = new Set(["p", "div", "ul", "ol", "li", "blockquote"]);

/** The allow-listed elements that are blocks — the ones that end one another. */
const BLOCK_ELEMENTS = new Set<string>(["p", "ul", "ol", "li"]);

/** What a `<div>` becomes: the paragraph it stands for, or nothing at all. */
type DivDecision = "paragraph" | "unwrap";

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

/**
 * Elements that never carry a closing tag.
 *
 * Exported because `format.ts` asks the same question of a value it is deciding
 * is markup or prose — a `<br>` is a tag with nothing to close, so it proves
 * markup on its own where a `<b>` does not.
 */
export const VOID_TAGS = new Set([
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

/**
 * Every element name this file recognises, plus the rest of the standard HTML
 * vocabulary.
 *
 * This is NOT an allow-list — `ALLOWED_TAGS` is, and it is nine names long.
 * This set answers a different question, for `format.ts`: is `<x …>` a TAG at
 * all, or is it a pair of angle brackets a planter typed? Everything here is
 * dropped, unwrapped or kept by the rules above; nothing is trusted because it
 * appears in this list.
 */
export const KNOWN_HTML_TAGS = new Set<string>([
  ...ALLOWED_TAGS,
  ...Object.keys(TAG_ALIASES),
  ...VOID_TAGS,
  ...DROP_WITH_CONTENT,
  ...BLOCK_CHILD_TAGS,
  "abbr",
  "address",
  "article",
  "aside",
  "bdi",
  "bdo",
  "big",
  "body",
  "button",
  "caption",
  "center",
  "cite",
  "code",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "font",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "html",
  "kbd",
  "label",
  "legend",
  "main",
  "map",
  "mark",
  "menu",
  "meter",
  "nav",
  "nobr",
  "optgroup",
  "option",
  "output",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "search",
  "section",
  "select",
  "slot",
  "small",
  "span",
  "strike",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "tt",
  "var",
]);

/** The only URL schemes a link may carry. */
const SAFE_URL_SCHEME = /^(?:https?|mailto|tel):/i;

/**
 * The opening of a merge token (`{{first_name}}`).
 *
 * A URL holding one is not a finished URL: `renderTemplate` substitutes
 * arbitrary recipient text into it AFTER this file has vetted it.
 */
const MERGE_TOKEN_OPEN = "{{";

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
 *
 * U+00A0 is deliberately NOT escaped. A contentEditable emits `&nbsp;` on its
 * own for a repeated or trailing space, and `sanitizeRichText` decodes that back
 * to the character before escaping — leaving it as a literal U+00A0 is what
 * makes the round trip stable AND keeps the non-breaking space the author's
 * spacing depended on. Emitting `&nbsp;` here instead would re-encode a `&` on
 * every pass, which is exactly the bug this file was rejected for.
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

/** U+00A0, written as an escape so it is visible in the source. */
const NON_BREAKING_SPACE = "\u00a0";

/**
 * The one entity decoder. `nbsp` is a parameter because its two callers need
 * opposite answers — see `decodeHtmlEntities` and `decodeTextEntities` below.
 *
 * The trailing semicolon is optional because browsers accept it missing.
 */
function decodeEntities(value: string, nbsp: string): string {
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
      if (lower === "nbsp") return nbsp;
      return NAMED_ENTITIES[lower] ?? match;
    }
  );
}

/**
 * Decode the entity forms a browser would decode inside an ATTRIBUTE value.
 *
 * This exists for ONE reason: `&#106;avascript:alert(1)` and `javascript:` are
 * the same URL to a browser, so the scheme check has to run on the decoded
 * form. `&nbsp;` flattens to an ordinary space here on purpose, so `URL_NOISE`
 * strips it and `java&nbsp;script:` is caught too.
 */
export function decodeHtmlEntities(value: string): string {
  return decodeEntities(value, NAMED_ENTITIES.nbsp);
}

/**
 * Decode the entity forms found in a TEXT node, keeping `&nbsp;` a real
 * non-breaking space.
 *
 * The URL decoder above flattens `&nbsp;` to an ordinary space on purpose —
 * that is what lets `URL_NOISE` strip it and catch `java&nbsp;script:`. In body
 * text the opposite is true: a contentEditable writes `&nbsp;` for the second of
 * two spaces and for a trailing one, so flattening it would silently delete
 * spacing the author typed. Two callers, two rules, one decoder.
 */
export function decodeTextEntities(value: string): string {
  return decodeEntities(value, NON_BREAKING_SPACE);
}

/**
 * Return the URL a link may keep, or `null` if it may not keep one.
 *
 * A rejected href does not mean a rejected link: the caller unwraps the anchor
 * and keeps the text, so a hostile `href` costs the user their link and nothing
 * else.
 *
 * This vetting runs BEFORE merge substitution, which is why the token rule
 * below exists — see it for the hole it closes.
 */
export function sanitizeUrl(raw: string): string | null {
  // Entities are decoded and control characters stripped BEFORE the scheme
  // test: `java&Tab;script:` and `java\nscript:` are `javascript:` to a browser.
  const decoded = decodeHtmlEntities(raw).replace(URL_NOISE, "").trim();

  if (!decoded) return null;
  // Protocol-relative (`//evil.example`) resolves against the host page, which
  // in an email is nothing useful. Rejected rather than guessed at.
  if (decoded.startsWith("//")) return null;
  // A merge token is replaced with arbitrary text AFTER this function has run,
  // so a token that can still decide the SCHEME defeats every test below it:
  // `<a href="{{first_name}}">` passes sanitising untouched and leaves
  // `renderTemplate` reading `href="javascript:alert(1)"` on the message detail
  // page, the COM-015 preview and the delivered email alike. A token is
  // therefore allowed only where the scheme is ALREADY fixed by the characters
  // in front of it — a spelled-out safe scheme, or an origin-relative path — so
  // `https://example.com/{{email}}` and `/tasks/{{task_id}}` still work and
  // `{{first_name}}` (or `x{{token}}`, which substitutes into `xjavascript:`)
  // does not.
  if (
    decoded.includes(MERGE_TOKEN_OPEN) &&
    !SAFE_URL_SCHEME.test(decoded) &&
    !decoded.startsWith("/")
  ) {
    return null;
  }
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

/**
 * Does the `<div>` whose content starts at `from` hold a block-level child?
 *
 * The scan stops at that div's own closing tag, so a page of sibling divs costs
 * one pass over the document, not one per div. A nested `<div>` answers yes
 * immediately: a div inside a div is a block child whatever it holds.
 */
function divHoldsBlock(source: string, from: number): boolean {
  const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/g;
  pattern.lastIndex = from;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (name === "div") return !closing;
    if (!closing && BLOCK_CHILD_TAGS.has(name)) return true;
  }
  return false;
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
 *  - no block ends up inside a `<p>`: a `<div>` holding one is unwrapped, and
 *    an opening `<p>`/`<ul>`/`<ol>` closes an open paragraph the way a parser
 *    does. `<p><ul>…</ul></p>` is invalid, and it is what a contentEditable
 *    hands us for every list a planter makes;
 *  - text is escaped, so a `<` an author typed stays a `<` they typed;
 *  - it is IDEMPOTENT — `sanitizeRichText(sanitizeRichText(x))` equals
 *    `sanitizeRichText(x)` for every input, entities included.
 *
 * That last one is load-bearing, not a nicety. The input is HTML, in which `&`,
 * `<`, `>` and U+00A0 are ALREADY entity-encoded by the browser's innerHTML
 * serialisation, and the body is sanitised more than once on the way to a
 * recipient (the editor on paste, then the server before storing, then the
 * renderer). Escaping raw source text would therefore escape the escapes, and
 * `Bob & Sue <3` would land in an inbox reading `Bob &amp; Sue &lt;3`. So text
 * nodes are DECODED and then re-escaped: `&lt;script&gt;` decodes to
 * `<script>` and re-escapes to `&lt;script&gt;`, unchanged and still inert,
 * because the decode only ever runs on text the parser already classified as
 * text — a decoded `<` is never re-read as the start of a tag.
 */
export function sanitizeRichText(input: string): string {
  if (!input) return "";

  const out: string[] = [];
  const stack: AllowedTag[] = [];
  // One entry per open `<div>`, so its `</div>` gets the same answer its `<div>`
  // did. Without this, an unwrapped div's closing tag would close an ancestor
  // paragraph that it never opened.
  const divDecisions: DivDecision[] = [];
  let i = 0;

  const closeThrough = (tag: AllowedTag) => {
    const at = stack.lastIndexOf(tag);
    if (at === -1) return;
    while (stack.length > at) {
      out.push(`</${stack.pop()}>`);
    }
  };

  /** A text node: decode what the serialiser encoded, then encode it once. */
  const pushText = (text: string) => {
    out.push(escapeHtml(decodeTextEntities(text)));
  };

  /**
   * Close the block an opening block tag implicitly ends, the way an HTML
   * parser does: a `<p>` ends at the next `<p>`, `<ul>` or `<ol>`, and an
   * `<li>` ends at the next `<li>`. Without this, an author's stray markup
   * stores `<p>…<ul>…</ul></p>` — a list inside a paragraph, which is the same
   * malformed shape the `<div>` alias used to produce, and which no two email
   * clients render alike.
   */
  const closeImpliedBlock = (opening: AllowedTag) => {
    if (!BLOCK_ELEMENTS.has(opening)) return;
    for (let at = stack.length - 1; at >= 0; at -= 1) {
      const open = stack[at];
      if (!BLOCK_ELEMENTS.has(open)) continue; // Inline wrappers close with it.
      if (open === "p" || (open === "li" && opening === "li")) {
        while (stack.length > at) {
          out.push(`</${stack.pop()}>`);
        }
      }
      return; // Only the INNERMOST open block can be implied closed.
    }
  };

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      pushText(input.slice(i));
      break;
    }
    if (lt > i) pushText(input.slice(i, lt));

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

    if (rawName === "div") {
      if (isClosing) {
        // An orphan `</div>` closes nothing: it never opened a paragraph.
        if (divDecisions.pop() === "paragraph") closeThrough("p");
        continue;
      }
      const decision: DivDecision =
        divHoldsBlock(input, i) || stack.length >= MAX_DEPTH
          ? "unwrap"
          : "paragraph";
      if (!tag.selfClosing) divDecisions.push(decision);
      // An unwrapped div still ends the paragraph its block children may not
      // sit inside — the `<p>` closes here, not after the list.
      closeImpliedBlock(decision === "unwrap" ? "ul" : "p");
      if (decision === "unwrap") continue;
      out.push("<p>");
      stack.push("p");
      if (tag.selfClosing) closeThrough("p");
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

    closeImpliedBlock(mapped);
    out.push(`<${mapped}>`);
    stack.push(mapped);
    if (tag.selfClosing) closeThrough(mapped);
  }

  while (stack.length > 0) {
    out.push(`</${stack.pop()}>`);
  }

  return out.join("");
}
