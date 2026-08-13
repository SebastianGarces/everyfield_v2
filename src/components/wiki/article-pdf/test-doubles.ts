// ============================================================================
// Article PDF — the stand-ins the download path is asserted against
// ============================================================================
//
// Not a test file (the runner matches `*.test.ts`), and not shipped code: the
// two halves of the download path have three test files between them, and each
// needs the same two stand-ins. Written once here so a change to what the
// extractor reads, or to how the renderer's tree is inspected, is made in one
// place rather than in three that drift.
//
//   `el` / `textNode`   a DOM small enough to read in a diff. `extract.ts`
//                       touches only the handful of members below, so a literal
//                       stand-in exercises it with no browser and no DOM
//                       library — which is what keeps extraction a plain unit
//                       test.
//   `primitives`        `Text` and `View` as bare strings. `render.tsx` takes
//                       its primitives from the caller, so the tree it builds
//                       can be inspected without `@react-pdf/renderer`, a
//                       browser or a rendered file. That seam is the reason the
//                       renderer stays off every wiki reader's bundle.
//
// Readers: `article-pdf/extract.test.ts`, `article-pdf/render.test.ts` and
// `article-actions.test.ts` (the cross-file print contract, which needs both).
// ============================================================================

import type { PrintRun } from "./extract";
import { PRINT_CALLOUT_ATTRIBUTE } from "./extract";
import type { renderBlock } from "./render";

// --- a DOM small enough to assert against -----------------------------------

export type StubChild = Element | Text;

export function textNode(value: string): Text {
  return { nodeType: 3, textContent: value } as unknown as Text;
}

export function el(
  tagName: string,
  children: StubChild[] = [],
  attributes: Record<string, string> = {}
): Element {
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: children,
    children: children.filter(
      (child) => (child as { nodeType: number }).nodeType === 1
    ),
    hasAttribute: (name: string) => name in attributes,
    getAttribute: (name: string) => attributes[name] ?? null,
    get textContent(): string {
      return children
        .map(
          (child) =>
            (child as { textContent?: string | null }).textContent ?? ""
        )
        .join("");
    },
    querySelectorAll: (selector: string) => descendants(node, selector),
  };
  return node as unknown as Element;
}

function descendants(node: { children: StubChild[] }, tagName: string) {
  const found: Element[] = [];
  for (const child of node.children as Element[]) {
    if (child.tagName === tagName.toUpperCase()) found.push(child);
    found.push(
      ...descendants(child as unknown as { children: StubChild[] }, tagName)
    );
  }
  return found;
}

/** One unemphasized run — what most prose reduces to. */
export const plain = (text: string): PrintRun[] => [{ text }];

/**
 * The DOM shape `callout.tsx` renders: the marker, the icon, the prose.
 *
 * Built here rather than by rendering the component, because what the extractor
 * reads is the markup — the component's half of the same contract is asserted
 * on its own, by calling it (`article-actions.test.ts`).
 *
 * The contents are `StubChild`, not `Element`, because a TEXT node is a shape
 * MDX really produces here: `<Callout>One line.</Callout>` written on one line
 * compiles to a bare string child with no `<p>` around it, and that callout has
 * no element children at all. Narrowing this to `Element` would have made the
 * case that broke the extractor unwritable.
 */
export const calloutEl = (label: string, ...children: StubChild[]): Element =>
  el(
    "div",
    [
      el("svg", [textNode("icon")]),
      // The component's `sr-only` label. It holds the same word the marker
      // does, so it must NOT reach the file a second time — which is why the
      // component marks it `data-print-hide`. Without that attribute here the
      // stub would stop resembling the markup and the leak it caused would go
      // unnoticed: nested in a list item the word welded itself to the
      // sentence ("Confirm the room. WarningChecklists are not optional.").
      el("span", [textNode(label)], { "data-print-hide": "" }),
      el("div", children),
    ],
    { [PRINT_CALLOUT_ATTRIBUTE]: label }
  );

// --- the tree the renderer builds -------------------------------------------

export type Rendered = {
  type: unknown;
  props: {
    style?: Record<string, unknown>;
    wrap?: boolean;
    children?: unknown;
  };
};

export const primitives = {
  Text: "Text",
  View: "View",
} as unknown as Parameters<typeof renderBlock>[2];

export const childrenOf = (node: Rendered): Rendered[] =>
  (Array.isArray(node.props.children)
    ? node.props.children
    : [node.props.children]) as Rendered[];
