import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

// ----------------------------------------------------------------------------
// AN HTML ENTITY IN JSX TEXT EATS THE SPACE NEXT TO IT (#593, from #575).
//
// THE BUG, EXACTLY. Next's compiler is SWC, and SWC drops the LEADING
// whitespace of a `JsxText` node that contains an HTML entity. Only the
// leading edge, and only when an entity is present. So this source
//
//     <span className="font-medium">{title}</span> will
//     be removed from this team&apos;s checklist.
//
// compiles to `[jsx("span", …), "will be removed from this team's checklist."]`
// — no space after the closing tag — and the planter reads
// "Curriculumwill be removed". Measured on a production `next build`, twice:
// the same sentence WITHOUT `&apos;` keeps its space, and the same sentence with
// the entity moved to the second line loses it just the same.
//
// THREE THINGS IT IS NOT, each measured rather than assumed, because the first
// diagnosis (#575's fix commit) got all three wrong:
//
//   * NOT about line wrapping. The same sentence on one line loses the space
//     too; the same sentence wrapped, without an entity, keeps it.
//   * NOT about the TRAILING edge. `…assessment &apos;… <span/>` keeps its
//     space. Only the leading edge is trimmed, so a guard that flags trailing
//     whitespace reports six sites in this repo that are all fine.
//   * NOT a reason to stop writing `</span> word`. That shape is correct and
//     stays correct as long as the text carries no entity.
//
// WHY THE LEADING EDGE IS WHAT MATTERS. Whitespace at the start of a JSX text
// node is only VISIBLE when a sibling renders before it — an element or an
// expression. A text node that is its parent's first child has its leading
// whitespace trimmed by ordinary JSX rules anyway, so an entity there costs
// nothing. That is the whole rule this test encodes, and why it does not simply
// ban entities: 110 of them live under `src/`, and `&nbsp;`, `&rsquo;` and
// friends are the right way to write a character that is invisible or ambiguous
// in source.
//
// WHY THIS IS A TEST AND NOT A LINT RULE. The repo carries no
// `eslint-plugin-react`, so there is no react rule set to extend and a custom
// rule would need plugin scaffolding for one check; `pnpm test` gates CI just
// as `pnpm lint` does. It parses with the TypeScript compiler rather than a
// regex, so "is this text node adjacent to a sibling" is answered by the syntax
// tree instead of guessed from characters.
//
// *** WHY A RENDER TEST CANNOT REPLACE THIS. *** The obvious guard — render the
// component and assert the string — is WORTHLESS here and must not be written.
// The test runner compiles TSX with esbuild (`tsx`), and esbuild does NOT have
// this bug: every shape below renders correctly under it. A render test would
// therefore be green on exactly the code that ships broken. The defect lives in
// the difference between the two compilers, so the only honest guard is one on
// the SOURCE, which is the same under both.
// ----------------------------------------------------------------------------

// `process.cwd()`, the idiom every source-shaped guard here already uses
// (`cursor-pointer.test.ts`, `navigating-clicks.test.ts`): `pnpm test` runs
// from the repo root. `import.meta.dirname` is NOT an option — tsx compiles a
// `.ts` test to CJS, where it is undefined.
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** `&apos;` `&amp;` `&#39;` `&#x27;` — any HTML entity reference. */
const ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]{1,9}|#\d{1,6}|#[xX][0-9a-fA-F]{1,6});/;

function tsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      tsxFiles(full, found);
    } else if (entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * A JSX child that RENDERS something, so whitespace beside it is visible.
 *
 * Comments and whitespace-only text are not: `{/* … *\/}` compiles away, and a
 * text node of pure whitespace between two elements is dropped by JSX itself.
 */
function isRenderingSibling(node: ts.Node | undefined): boolean {
  if (!node) return false;
  if (ts.isJsxExpression(node)) {
    // `{/* comment */}` is an expression with no expression inside it.
    return node.expression !== undefined;
  }
  if (ts.isJsxText(node)) return !node.containsOnlyTriviaWhiteSpaces;
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  );
}

interface Offence {
  file: string;
  line: number;
  text: string;
}

function offencesIn(file: string): Offence[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const offences: Offence[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children = node.children;
      children.forEach((child, index) => {
        if (!ts.isJsxText(child)) return;
        if (child.containsOnlyTriviaWhiteSpaces) return;

        // `getFullText`, NEVER `getText`. `getText()` starts at `getStart()`,
        // which skips leading trivia — so on a JsxText it hands back the node
        // with its leading whitespace already gone, and the very check this
        // test exists for silently never fires. Caught by running the guard
        // against the known-broken source and watching it pass.
        const raw = child.getFullText(source);
        if (!ENTITY.test(raw)) return;

        // A SAME-LINE leading space, and only when something renders before
        // it. Both halves are load-bearing:
        //
        //   * If the leading whitespace contains a NEWLINE, ordinary JSX rules
        //     drop it whatever the compiler — measured: the entity and
        //     entity-free versions of that shape emit the identical string. So
        //     there is no space for SWC to take, and flagging it reports files
        //     that are fine (`skills-list.tsx`, `generate-dialog.tsx`).
        //   * If nothing renders before the text, its leading whitespace is
        //     trimmed as a first child anyway.
        const leading = /^[^\S\n]+/.exec(raw);
        if (!leading) return;
        if (!isRenderingSibling(children[index - 1])) return;

        offences.push({
          file,
          line:
            source.getLineAndCharacterOfPosition(child.getStart(source)).line +
            1,
          text: raw.trim().replace(/\s+/g, " ").slice(0, 70),
        });
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return offences;
}

test("no JSX text puts an HTML entity next to a space that SWC will eat", () => {
  const offences = tsxFiles(SRC).flatMap(offencesIn);

  const report = offences.map(
    (o) => `  ${path.relative(ROOT, o.file)}:${o.line} — "${o.text}"`
  );

  assert.deepEqual(
    report,
    [],
    `An HTML entity in this JSX text makes Next's SWC drop the space in front of\n` +
      `it, so the rendered copy runs two words together. esbuild does not, so\n` +
      `\`pnpm test\` renders it correctly and only a production build shows it.\n\n` +
      `THE FIX: take the entity out of the JSX text. Write the character itself\n` +
      `("it's", not "it&apos;s") — nothing in this repo requires the entity form,\n` +
      `because \`react/no-unescaped-entities\` is not enabled. Where the character\n` +
      `must stay invisible-proof (a non-breaking space, a rare glyph), move the\n` +
      `whole run into a string expression instead — {"… \\u00a0 …"} — which no\n` +
      `compiler is free to re-trim.\n\n` +
      `Offending text:\n${report.join("\n")}\n`
  );
});
