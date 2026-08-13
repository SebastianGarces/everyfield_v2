/**
 * ELEMENTS AND THEIR ATTRIBUTES, READ OFF RENDERED MARKUP.
 *
 * Some component contracts are made entirely of attributes and class names —
 * `cursor-pointer` on every clickable (the project hard rule), an `aria-label`
 * on every icon button, a hidden input reaching the request under the name the
 * server action reads. None of that needs a DOM: `renderToStaticMarkup` gives
 * the exact string the browser will parse, and these helpers read it.
 *
 * They live here rather than in each suite because the regex is LOAD-BEARING.
 * It is the mechanism behind the cursor-pointer rule on every surface that
 * pins it, and a copy that quietly stops matching (a new attribute spelling, a
 * self-closing tag, an unquoted value) turns its suite's assertions green
 * without turning them true. Four copies is four places for that to happen
 * independently; one copy fails everywhere at once, which is the point.
 *
 * This is a markup reader, not a parser. It sees OPENING tags only, so it
 * cannot answer questions about nesting or text content — those want a real
 * DOM, and a suite that needs one should say so rather than stretch this.
 */

/** One opening tag: its name, and its attributes keyed lowercase. */
export interface RenderedElement {
  tag: string;
  attrs: Record<string, string>;
}

/**
 * Every opening tag in `html`, in document order.
 *
 * Attribute keys are LOWERCASED. React's server renderer keeps the JSX casing
 * (`contentEditable`, `aria-Label` is never written but `readOnly` is), and the
 * browser lowercases every one of them when it parses — so the assertions read
 * the way the DOM will, not the way the JSX did.
 */
export function parseElements(html: string): RenderedElement[] {
  const elements: RenderedElement[] = [];
  const tagPattern = /<([a-zA-Z][\w-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*\/?>/g;
  const attrPattern = /([\w:.-]+)="([^"]*)"/g;

  for (const match of html.matchAll(tagPattern)) {
    const attrs: Record<string, string> = {};
    for (const attr of (match[2] ?? "").matchAll(attrPattern)) {
      attrs[attr[1].toLowerCase()] = attr[2];
    }
    elements.push({ tag: match[1], attrs });
  }

  return elements;
}

/**
 * The `<button>` elements that carry an `aria-label` — a toolbar's controls,
 * and any other icon-only button.
 *
 * The label is what makes a button NAMED, so the filter doubles as the
 * accessibility check: a control that dropped its label leaves the set and the
 * count assertion above it fails, rather than the cursor-pointer loop passing
 * over one element fewer.
 */
export function namedButtons(html: string): RenderedElement[] {
  return parseElements(html).filter(
    (el) => el.tag === "button" && el.attrs["aria-label"] !== undefined
  );
}
