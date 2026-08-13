import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  GLOBALS_CSS,
  SRC,
  css,
  markupLines,
  matchingBrace,
  stripCssComments,
  tsxFiles,
} from "@/lib/testing/theme-color";

// ----------------------------------------------------------------------------
// The guards that read what SHIPS rather than what the token layer declares:
// markup under src/, and the other stylesheets under src/app/. A perfect token
// layer still fails a user if the markup paints a utility the layer never
// declared, or if an unlayered sheet quietly deletes the rule that carried a
// WCAG criterion — neither is visible to colour math.
//
// The token layer's own identity and contrast assertions live next door in
// theme-tokens.test.ts and focus-ring.test.ts; the colour math all three use
// lives in theme-color.ts.
// ----------------------------------------------------------------------------

// --- a foreground token that no longer exists is a colour that no longer
//     renders (#411) -------------------------------------------------------
//
// An undeclared `*-foreground` utility emits NO CSS, so the element keeps
// whatever it inherited and nothing fails loudly. This is the cheap half of the
// #411 defect: necessary, but it proves only that a token is DECLARED. What
// actually paints is guarded below.

test("every `*-foreground` colour utility in shipped markup names a token that exists", () => {
  const theme = css.slice(css.indexOf("@theme inline {"));
  const declared = new Set(
    [...theme.matchAll(/--color-([\w-]+):/g)].map((match) => match[1])
  );

  const used = new Map<string, string>();
  for (const { where, line } of markupLines()) {
    for (const match of line.matchAll(
      /\b(?:text|bg|border|ring|fill|stroke)-([a-z][\w-]*-foreground)(?:\/\d+)?\b/g
    )) {
      if (!used.has(match[1])) used.set(match[1], where);
    }
  }

  const missing = [...used]
    .filter(([token]) => !declared.has(token))
    .map(([token, where]) => `${token} (${where})`);

  assert.deepEqual(
    missing,
    [],
    "shipped markup paints a `--color-*-foreground` the token layer does not define. Tailwind emits nothing for an unknown utility, so the element keeps whatever colour it inherited. Declare the token in globals.css"
  );
});

// --- what PAINTS, not what is declared: `asChild` Button wrappers (#411) ----
//
// The real #411 defect was never a missing token. `AlertDialogAction` wraps
// `Button` with `asChild`; Radix's Slot CONCATENATES buttonVariants() with the
// child's className, and the `cn(className)` inside the wrapper is handed only
// the CALLER's classes — it never sees the variant's. So a call site that
// hand-paints `bg-destructive text-destructive-foreground` ships BOTH that and
// the default variant's `bg-primary text-primary-foreground` to the DOM, and
// CSS source order decides. Five Delete buttons rendered the neutral ink fill
// (#181d19 on #fafafa) in both themes while every token assertion passed.
//
// Colour math cannot see this and neither can a token check: both classes are
// declared and both are correct in isolation. The only guard that sees it is
// one over the CALL SITE — the wrapper list is derived from the ui/ source, so
// a new `asChild` Button wrapper is covered the day it is written.

/**
 * The opening tag of every `<Name …>` in `source`, attributes included.
 *
 * Depth-aware, and that is the whole point: a JSX prop contains `>` all the
 * time (`onClick={() => close()}`), so a tag matcher that stops at the first
 * `>` truncates mid-attribute. This is the file's ONE answer to "where does an
 * opening tag end" — the discovery step below uses it too, because a second,
 * naive answer there silently dropped whole wrappers out of the guard.
 */
function openingTags(source: string, name: string): string[] {
  const tags: string[] = [];
  const opener = new RegExp(`<${name}(?=[\\s/>])`, "g");
  for (const match of source.matchAll(opener)) {
    let depth = 0;
    for (let i = match.index! + match[0].length; i < source.length; i++) {
      const char = source[i];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) {
        tags.push(source.slice(match.index!, i + 1));
        break;
      }
    }
  }
  return tags;
}

/** The components declared in `source` that wrap `<Button … asChild>`. */
function asChildButtonWrappersIn(source: string): string[] {
  const names: string[] = [];
  // Function blocks, so a `<Button asChild>` is attributed to its own
  // component rather than to whatever was declared first in the file.
  const starts = [...source.matchAll(/^function (\w+)\(/gm)];
  for (const [index, start] of starts.entries()) {
    const from = start.index!;
    const to = starts[index + 1]?.index ?? source.length;
    for (const tag of openingTags(source.slice(from, to), "Button")) {
      if (/\basChild\b/.test(tag)) names.push(start[1]);
    }
  }
  return names;
}

/** Components in `src/components/ui/` that wrap `<Button … asChild>`. */
function asChildButtonWrappers(): string[] {
  const names = tsxFiles(path.join(SRC, "components", "ui")).flatMap((file) =>
    asChildButtonWrappersIn(readFileSync(file, "utf8"))
  );
  return [...new Set(names)];
}

/**
 * Every string and template literal inside a JSX expression, at any depth.
 *
 * `className={cn("bg-destructive", busy && "opacity-50")}` is the idiom this
 * codebase reaches for by default, and a matcher that reads only `"…"` or
 * `` {`…`} `` sees NOTHING in it — the call site then contributes nothing and
 * passes. So the expression is walked: quoted strings, template literals, and
 * the strings inside a template's `${…}` holes all come back.
 */
function expressionLiterals(expr: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < expr.length; i++) {
    const quote = expr[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;

    let text = "";
    let j = i + 1;
    for (; j < expr.length && expr[j] !== quote; j++) {
      if (expr[j] === "\\") {
        j++;
        continue;
      }
      if (quote === "`" && expr[j] === "$" && expr[j + 1] === "{") {
        let depth = 0;
        let k = j + 1;
        for (; k < expr.length; k++) {
          if (expr[k] === "{") depth++;
          else if (expr[k] === "}" && --depth === 0) break;
        }
        out.push(...expressionLiterals(expr.slice(j + 2, k)));
        j = k;
        continue;
      }
      text += expr[j];
    }
    out.push(text);
    i = j;
  }
  return out;
}

/** Every class-name string this opening tag can put on the element. */
function classNameLiterals(tag: string): string[] {
  const out: string[] = [];
  for (const match of tag.matchAll(/\bclassName=/g)) {
    const at = match.index! + match[0].length;
    const char = tag[at];

    if (char === '"' || char === "'") {
      const end = tag.indexOf(char, at + 1);
      out.push(tag.slice(at + 1, end === -1 ? tag.length : end));
      continue;
    }
    if (char !== "{") continue;

    // Balanced braces — the same depth technique `openingTags` uses.
    let depth = 0;
    let end = tag.length;
    for (let i = at; i < tag.length; i++) {
      if (tag[i] === "{") depth++;
      else if (tag[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    out.push(...expressionLiterals(tag.slice(at + 1, end)));
  }
  return out;
}

// `text-` is the one prefix that is not always a colour.
const NON_COLOUR_TEXT =
  /^(xs|sm|base|lg|xl|\d?xl|left|center|right|justify|start|end|balance|pretty|nowrap|wrap|clip|ellipsis|\[.*\])$/;

function isColourUtility(raw: string): boolean {
  const utility = raw.replace(/^.*:/, "");
  return (
    utility.startsWith("bg-") ||
    (utility.startsWith("text-") &&
      !NON_COLOUR_TEXT.test(utility.slice("text-".length)))
  );
}

/** The hand-painted colours `wrappers`' call sites in one file declare. */
function handPaintedColours(
  source: string,
  where: string,
  wrappers: string[]
): { offenders: string[]; scanned: number } {
  const offenders: string[] = [];
  let scanned = 0;
  for (const wrapper of wrappers) {
    for (const tag of openingTags(source, wrapper)) {
      scanned++;
      for (const literal of classNameLiterals(tag)) {
        for (const raw of literal.split(/\s+/)) {
          if (isColourUtility(raw))
            offenders.push(`${where}: <${wrapper} className="…${raw}…">`);
        }
      }
    }
  }
  return { offenders, scanned };
}

test("no `asChild` Button call site hand-paints its colour in className", () => {
  const wrappers = asChildButtonWrappers();
  assert.ok(
    wrappers.includes("AlertDialogAction") &&
      wrappers.includes("AlertDialogCancel"),
    `the asChild-Button wrapper scan found ${JSON.stringify(wrappers)} — it has gone vacuous. Fix the scan before trusting a pass`
  );

  const offenders: string[] = [];
  let scanned = 0;
  for (const file of tsxFiles(SRC)) {
    const found = handPaintedColours(
      readFileSync(file, "utf8"),
      path.relative(process.cwd(), file),
      wrappers
    );
    offenders.push(...found.offenders);
    scanned += found.scanned;
  }

  assert.ok(
    scanned >= 20,
    `only ${scanned} asChild-Button call sites were found; there are twenty-two. The scan has gone vacuous`
  );

  assert.deepEqual(
    offenders,
    [],
    'an `asChild` Button call site paints a bg-*/text-* utility in className. That className lands on the Slot CHILD, so tailwind-merge never sees it against buttonVariants() — both colours reach the DOM and CSS source order picks the winner, which is how five Delete buttons shipped in the primary fill. Pass `variant="destructive"` (or the variant you want) instead'
  );
});

// --- the guard's own two failure modes, mutated ------------------------------
//
// Both halves of the guard above USED to answer their question the easy way,
// and both easy answers are silent: a wrapper that is never discovered takes
// every one of its call sites out of the scan, and a className spelling that is
// never read makes a call site contribute nothing. Neither shows up as a
// failure — the suite just stops covering things. So both are mutated here.

test("the wrapper scan reads a JSX tag by depth, not to the first `>`", () => {
  // `onClick={() => close()}` puts a `>` inside the attribute list. A
  // `/<Button\b[^>]*>/` matcher stops at the arrow, never sees `asChild`, and
  // drops the whole component — and every call site of it — out of the guard.
  const source = [
    "function Zealot(props) {",
    '  return <Button variant="ghost" onClick={() => close()} asChild {...props} />;',
    "}",
  ].join("\n");

  assert.deepEqual(
    asChildButtonWrappersIn(source),
    ["Zealot"],
    "an `asChild` Button wrapper whose tag contains a `>` inside a prop was not discovered — the discovery step has gone back to a naive tag regex"
  );
});

test("the call-site guard reads every className spelling, `cn()` included", () => {
  const fires = (markup: string) =>
    handPaintedColours(markup, "synthetic.tsx", ["AlertDialogAction"]).offenders
      .length;

  // The spelling the five Delete buttons actually shipped.
  assert.equal(
    fires('<AlertDialogAction className="bg-destructive text-white" />'),
    2,
    "a plain string className no longer fires the guard"
  );

  // The same defect in the idiom this codebase reaches for by default.
  assert.equal(
    fires(
      '<AlertDialogAction className={cn("bg-destructive", busy && "text-white")} />'
    ),
    2,
    "a `cn()` className no longer fires the guard — the original #411 defect can be respelled straight past it"
  );
  assert.equal(
    fires("<AlertDialogAction className={cn(`bg-destructive`, styles)} />"),
    1,
    "a template literal inside `cn()` no longer fires the guard"
  );

  // …and it is not simply always-on: non-colour utilities are legitimate.
  assert.equal(
    fires(
      '<AlertDialogAction className={cn("w-full text-sm", busy && "p-2")} />'
    ),
    0,
    "the guard now fires on non-colour utilities — every call site would have to strip its layout classes"
  );
});

// --- inline links in prose: SC 1.4.1 (#386 ruling, PR #387) -----------------
//
// --primary (ink) against --muted-foreground measures 2.85:1 in the light theme
// and 2.06:1 in the dark one, both under the 3:1 SC 1.4.1 asks when colour is
// the only distinguisher — the numbers are pinned in theme-tokens.test.ts. The
// 2026-08-10 ruling paid that cost in CSS rather than by capping how far
// --muted-foreground may darken, so what has to hold HERE is the cue itself:
// the base-layer underline, and the fact that nothing later deletes it.

test("inline links in prose carry a permanent underline in the base layer", () => {
  const baseLayer = css.indexOf("@layer base {");
  assert.notEqual(baseLayer, -1, "@layer base block not found in globals.css");

  const rule = /p\s+a\[href\]\s*\{[^}]*text-decoration(?:-line)?:\s*underline/;
  const match = css.slice(baseLayer).match(rule);

  assert.ok(
    match,
    "globals.css no longer underlines `p a[href]` in @layer base — /login's \"Sign up\" is 2.85:1 against the text around it, so removing the underline puts SC 1.4.1 back in the token's hands (memory/invariants.md → Design Tokens — Contrast)"
  );
});

// --- the cascade hole the base-layer rule cannot see -------------------------
//
// `@layer base` is the weakest place a rule can live: an UNLAYERED normal
// declaration beats every layered one no matter the specificity. So any
// stylesheet under src/app/ that is not itself wrapped in `@layer` can strip
// the prose underline with a selector as weak as `.marketing a`, and neither
// the globals.css grep above nor the `no-underline` grep below can tell.
// That is exactly what happened: `src/app/(marketing)/marketing.css` set
// `text-decoration: none` on `.marketing a`, and /terms and /privacy shipped
// four colour-only links at 1.36:1 while /login passed. The fingerprint was
// `text-underline-offset: 4px` computing on a link whose `text-decoration-line`
// was `none` — the base rule landing on one property and losing the other.

type CssRule = { selectors: string[]; body: string };

/**
 * The part of a stylesheet that sits OUTSIDE every `@layer` block — the
 * declarations that outrank all layered CSS regardless of specificity.
 */
function unlayeredPart(source: string): string {
  const sheet = stripCssComments(source);
  let out = "";
  let i = 0;
  while (i < sheet.length) {
    const at = sheet.indexOf("@layer", i);
    if (at === -1) return out + sheet.slice(i);
    out += sheet.slice(i, at);

    const open = sheet.indexOf("{", at);
    const semi = sheet.indexOf(";", at);
    // `@layer theme, base, utilities;` is a statement, not a block.
    if (open === -1 || (semi !== -1 && semi < open)) {
      i = semi === -1 ? sheet.length : semi + 1;
      continue;
    }
    i = matchingBrace(sheet, open) + 1;
  }
  return out;
}

/** Flatten a CSS fragment to style rules, descending through `@media` etc. */
function cssRules(sheet: string): CssRule[] {
  const out: CssRule[] = [];
  let i = 0;
  while (i < sheet.length) {
    const open = sheet.indexOf("{", i);
    if (open === -1) break;
    const prelude = sheet
      .slice(i, open)
      .trim()
      .replace(/^[;}]+/, "")
      .trim();
    const close = matchingBrace(sheet, open);
    const body = sheet.slice(open + 1, close);
    if (prelude.startsWith("@")) out.push(...cssRules(body));
    else
      out.push({
        selectors: prelude
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        body,
      });
    i = close + 1;
  }
  return out;
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.isFile() && entry.name.endsWith(".css") ? [full] : [];
  });
}

/** A selector whose subject is a bare `a` — `a`, `.marketing a`, `main > a`. */
const BARE_ANCHOR_SUBJECT = /(?:^|[\s>+~])a$/;

/** A selector that re-establishes the prose link — `.x p a[href]`, `p a[href]`. */
const PROSE_LINK_SUBJECT = /(?:^|[\s>+~])p\s+a\[href\]$/;

/** The last `text-decoration` / `text-decoration-line` value a rule declares. */
function declaredDecoration(body: string): string | null {
  const matches = [
    ...body.matchAll(/text-decoration(?:-line)?\s*:\s*([^;}]+)/g),
  ];
  return matches.length ? matches[matches.length - 1][1].trim() : null;
}

test("no unlayered stylesheet strips the prose underline it cannot restore", () => {
  const sheets = cssFiles(path.join(SRC, "app")).filter(
    (file) => file !== GLOBALS_CSS
  );
  assert.ok(
    sheets.length > 0,
    "no stylesheets found under src/app — this guard has gone vacuous, fix the walk before trusting a pass"
  );

  const offenders = sheets.flatMap((file) => {
    const rules = cssRules(unlayeredPart(readFileSync(file, "utf8")));

    const strips = rules.some(({ selectors, body }) => {
      const decoration = declaredDecoration(body);
      return (
        decoration !== null &&
        !decoration.includes("underline") &&
        selectors.some((s) => BARE_ANCHOR_SUBJECT.test(s))
      );
    });
    if (!strips) return [];

    const restores = rules.some(
      ({ selectors, body }) =>
        selectors.some((s) => PROSE_LINK_SUBJECT.test(s)) &&
        /text-decoration-line\s*:\s*underline/.test(body)
    );
    return restores ? [] : [path.relative(process.cwd(), file)];
  });

  assert.deepEqual(
    offenders,
    [],
    "an unlayered stylesheet sets text-decoration on a bare `a` selector and never restores it for prose. Unlayered normal declarations beat `@layer base` at ANY specificity, so this silently deletes the SC 1.4.1 underline across that whole surface (it did: /terms and /privacy shipped four links at 1.36:1). Add `<scope> p a[href] { text-decoration-line: underline; text-underline-offset: 4px }` to the SAME sheet — not `!important` in globals.css"
  );
});

test("the marketing surface is inside the guard, not merely quiet", () => {
  // The guard above passes for a sheet that strips nothing. This pins the one
  // sheet that DOES strip, so deleting its restore can never read as "clean".
  const marketing = path.join(SRC, "app", "(marketing)", "marketing.css");
  const rules = cssRules(unlayeredPart(readFileSync(marketing, "utf8")));

  assert.ok(
    rules.some(({ selectors, body }) => {
      const decoration = declaredDecoration(body);
      return (
        decoration === "none" &&
        selectors.some((s) => BARE_ANCHOR_SUBJECT.test(s))
      );
    }),
    "marketing.css no longer strips text-decoration on a bare `a` — if that reset is genuinely gone, delete this canary and the `.marketing p a[href]` restore together"
  );

  assert.ok(
    rules.some(
      ({ selectors, body }) =>
        selectors.some((s) => PROSE_LINK_SUBJECT.test(s)) &&
        /text-decoration-line\s*:\s*underline/.test(body)
    ),
    "marketing.css strips the underline without restoring it for `p a[href]` — /terms and /privacy go back to colour-only links at 1.36:1 (WCAG SC 1.4.1)"
  );
});

/** Every `<p>…</p>` in shipped markup that contains a link, with its file. */
function proseBlocksContainingLinks(): { file: string; block: string }[] {
  return tsxFiles(SRC).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const blocks = source.match(/<p[\s>][\s\S]*?<\/p>/g) ?? [];
    return blocks
      .filter((block) => /<Link[\s>]|<a[\s>]/.test(block))
      .map((block) => ({ file: path.relative(process.cwd(), file), block }));
  });
}

test("no link inside prose opts out of the underline", () => {
  // The base rule is defeated by one utility class, and utilities outrank
  // base — so `no-underline` on a prose link silently reintroduces the
  // colour-only link. Legitimate elsewhere (nav is a list OF links, not
  // prose), which is why the guard is scoped to `<p>` rather than to the
  // class name.
  const offenders = proseBlocksContainingLinks()
    .filter(({ block }) => /\bno-underline\b/.test(block))
    .map(({ file }) => file);

  assert.deepEqual(
    offenders,
    [],
    "a link inside a paragraph carries `no-underline` — that puts it back at 2.85:1 against its own sentence with no non-colour cue (WCAG SC 1.4.1). Move the link out of the prose block or drop the class"
  );
});

test('the /login "Sign up" link is still inside a paragraph, where the rule reaches it', () => {
  // The proven case for the whole ruling. The base rule keys on `p a[href]`,
  // so refactoring this paragraph into a <div> would delete the fix without
  // touching a line of CSS.
  const loginForm = path.join(SRC, "app", "(auth)", "login", "login-form.tsx");
  const blocks = proseBlocksContainingLinks().filter(({ file }) =>
    loginForm.endsWith(file)
  );

  assert.ok(
    blocks.some(({ block }) => /href="\/register"/.test(block)),
    'login-form.tsx no longer wraps its "Sign up" link in a <p> — the `p a[href]` underline in globals.css no longer reaches it, and Lighthouse\'s link-in-text-block finding comes back'
  );
});

// --- regression guard -------------------------------------------------------

test("no meaningful text is painted with text-foreground/50 — decorative uses must carry an a11y-decorative marker", () => {
  // Ruling on #151 (PR #173, option b): the guard is scoped to the AC's
  // wording. WCAG imposes no contrast floor on decorative elements (icons
  // tinted via currentColor, ornaments), so a line may keep the class by
  // declaring itself decorative with an inline `a11y-decorative` comment on
  // that same line — legal, greppable, and auditable. Any unmarked use is
  // treated as meaningful text and fails. The 3.30:1 the class measures is
  // pinned in theme-tokens.test.ts.
  const offenders = markupLines()
    .filter(
      ({ line }) =>
        line.includes("text-foreground/50") && !line.includes("a11y-decorative")
    )
    .map(({ where }) => where);

  assert.deepEqual(
    offenders,
    [],
    "text-foreground/50 is 3.30:1 on white — use text-muted-foreground for text that carries meaning, or mark the line {/* a11y-decorative */} if it is genuinely decorative"
  );
});
