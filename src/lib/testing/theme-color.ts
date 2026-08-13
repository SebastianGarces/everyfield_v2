import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// ----------------------------------------------------------------------------
// The colour math and the token reader, in one place.
//
// Contrast is a property of the design tokens, not of any one screen, so it can
// be asserted without a browser: read the oklch tokens straight out of
// globals.css, convert them the way a browser does (oklch -> linear sRGB ->
// gamma-encoded sRGB, alpha composited in gamma space), and compute the WCAG
// ratio.
//
// This module exists because several different KINDS of test need it and none
// should own it: `theme-tokens.test.ts` does colour math over globals.css,
// `focus-ring.test.ts` measures the focus indicator against SC 1.4.11, and
// `text-contrast.test.ts` scans shipped markup and the other stylesheets. They
// share only these helpers, and a second copy of a contrast formula is the
// fastest way to get two files that disagree about whether the app passes.
//
// WHERE THIS LIVES. `src/lib/testing/` is the repo's home for test-only
// infrastructure (`source-span.ts`, `rendered-markup.ts` — see the second's
// header for the same argument). It used to sit in `src/app/`, which is the
// ROUTING layer and is also the tree `tsxFiles()` below walks as shipped
// markup, so the walk had to skip one hard-coded absolute path to stop the
// module from failing the guards it powers. That skip was an equality on a
// filename: rename or move the file and it silently stopped matching. The
// directory rule that replaced it covers this module AND its two neighbours,
// which had exactly the same hole open.
// ----------------------------------------------------------------------------

export const SRC = path.join(process.cwd(), "src");
export const GLOBALS_CSS = path.join(SRC, "app", "globals.css");

export const AA_BODY_TEXT = 4.5;

/**
 * WCAG SC 1.4.1 (Use of Color). When colour is the ONLY thing telling a link
 * apart from the text around it, that colour difference has to reach 3:1 —
 * the same threshold non-text contrast uses. Below it, the link needs a cue
 * that is not colour.
 */
export const SC_1_4_1_NON_COLOUR_THRESHOLD = 3;

/**
 * WCAG 2.2 SC 1.4.11 Non-text Contrast — the floor a focus indicator owes
 * against the colors next to it. Text has a higher bar (AA_BODY_TEXT); a ring
 * is not text.
 */
export const NON_TEXT_CONTRAST = 3;

/**
 * The tolerance an identity check needs, in 8-bit channel units. A hex and an
 * oklch spelling of one colour do not round-trip to the same bytes, but they
 * land within a fraction of one: the two pairs this module is used on measure
 * 0.109 and 0.058 apart. One whole unit is therefore a wide margin over the
 * round-trip noise and still far under any real colour difference.
 */
export const SAME_COLOUR_CHANNEL_DELTA = 1;

// --- color math -------------------------------------------------------------

export type Rgb = [number, number, number];

/** oklch(L C H) -> gamma-encoded sRGB channels in 0..1. */
export function oklchToSrgb(L: number, C: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const linear: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return linear.map(encodeSrgb) as Rgb;
}

export function encodeSrgb(channel: number): number {
  const v = Math.min(1, Math.max(0, channel));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

export function decodeSrgb(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * CSS composites a translucent color over its backdrop in gamma-encoded sRGB,
 * which is exactly why a foreground painted at half alpha looks lighter than
 * its nominal lightness suggests.
 */
export function composite(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return (
    0.2126 * decodeSrgb(r) + 0.7152 * decodeSrgb(g) + 0.0722 * decodeSrgb(b)
  );
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Is this the same colour written two ways? CHANNEL-WISE, deliberately.
 *
 * The obvious spelling — `contrastRatio(a, b) < 1.01` — is not an identity
 * check at all. Contrast is relative luminance, so hue and chroma are thrown
 * away before the comparison happens, and the guard then answers a question
 * nobody asked: `oklch(0.5354 0.151 320)` is a MAGENTA and it sits 1.0058:1
 * from DESIGN.md's danger red, so a luminance guard "proves" the ruled danger
 * colour still ships while the app renders purple. At the ink's chroma every
 * hue on the wheel passes. These are the only assertions holding globals.css
 * to the design authority, so they compare what a screen actually emits.
 */
export function isSameColour(a: Rgb, b: Rgb): boolean {
  return a.every(
    (channel, i) => Math.abs(channel - b[i]) * 255 < SAME_COLOUR_CHANNEL_DELTA
  );
}

// --- CSS structure ----------------------------------------------------------

export function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Index of the `}` closing the `{` at `open`. */
export function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return i;
  }
  return source.length;
}

export const css = readFileSync(GLOBALS_CSS, "utf8");

/**
 * Comments are stripped ONCE, before any index arithmetic — this file argues
 * for its values in ~100 lines of prose, and prose is not CSS. A comment line
 * that merely BEGINS with `}` (quoting a rule, closing a code sample) used to
 * truncate a whole theme block, after which every token below the cut failed
 * with "not declared in the light theme" and pointed the blame at globals.css
 * instead of at the parser.
 */
const cssWithoutComments = stripCssComments(css);

/**
 * `:root` holds the light theme, `.dark` the dark one. Both are flat blocks of
 * custom properties, so the last declaration inside the requested block wins —
 * the same rule the cascade applies. Bounds come from `matchingBrace`, the same
 * correct matcher the stylesheet walk uses, not from the first `\n}`.
 */
export function themeBlock(theme: "light" | "dark"): string {
  const selector = theme === "light" ? ":root" : ".dark";
  const blockStart = cssWithoutComments.indexOf(`${selector} {`);
  assert.notEqual(blockStart, -1, `${selector} block not found in globals.css`);

  const open = cssWithoutComments.indexOf("{", blockStart);
  return cssWithoutComments.slice(
    open + 1,
    matchingBrace(cssWithoutComments, open)
  );
}

// --- token reading ----------------------------------------------------------

/**
 * The literal right-hand side of `--name`, before any `var()` is followed.
 *
 * The LAST declaration wins, which is what `themeBlock` above already claims
 * the reader does and what the cascade actually does. Taking the first one
 * instead is a guard that reads a value the browser never uses: re-declare a
 * token lower in the same block — the ordinary way a value is overridden in
 * place — and every assertion in the suite would go on measuring the line
 * above it.
 */
export function declaredValue(block: string, name: string): string | null {
  const matches = [
    ...block.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g")),
  ];
  return matches.length ? matches[matches.length - 1][1].trim() : null;
}

/** Every `--name` this block declares, in source order. */
export function declaredTokens(block: string): string[] {
  return [...block.matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1]);
}

/**
 * Follow `var(--x)` the way the cascade does. Two things that means:
 *
 *  1. A token that names another token is not a different colour —
 *     `--primary: var(--ink)` renders exactly what `--ink` renders — so a
 *     reader that stopped at the literal would report the ink as "missing" the
 *     moment the file stopped repeating it nine times.
 *  2. `.dark` INHERITS every `:root` declaration it does not override. A token
 *     the dark block never mentions still has a dark value in the browser: the
 *     light one. Refusing to resolve it was how a real dark-theme failure
 *     (`--ef-dark` is `var(--ink)` and has no dark twin, so painting it as page
 *     text in the dark theme is ink on a dark ground) became untestable and had
 *     to be argued in prose instead of pinned by a number.
 */
export function resolveVars(theme: "light" | "dark", name: string): string {
  const block = themeBlock(theme);
  const root = themeBlock("light");
  let current = name;

  for (let hop = 0; hop < 8; hop += 1) {
    const value = declaredValue(block, current) ?? declaredValue(root, current);
    assert.ok(
      value !== null,
      `--${current} is not declared in the ${theme} theme or in :root (following --${name})`
    );
    const indirection = value.match(/^var\(\s*--([\w-]+)\s*\)$/);
    if (!indirection) return value;
    current = indirection[1];
  }
  assert.fail(`--${name} loops through var() in the ${theme} theme`);
}

/** `oklch(L C H)` -> its three numbers; `L` may be a percentage or a ratio. */
function parseOklch(value: string): [number, number, number] | null {
  const match = value.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!match) return null;
  const rawL = match[1];
  const L = rawL.endsWith("%") ? Number(rawL.slice(0, -1)) / 100 : Number(rawL);
  return [L, Number(match[2]), Number(match[3])];
}

export function readTokenOklch(
  theme: "light" | "dark",
  name: string
): [number, number, number] {
  const value = resolveVars(theme, name);
  const parsed = parseOklch(value);
  assert.ok(parsed, `--${name} is not an oklch() value in the ${theme} theme`);
  return parsed;
}

/** `#rrggbb` -> gamma-encoded sRGB channels in 0..1, for DESIGN.md's spellings. */
export function hexToSrgb(hex: string): Rgb {
  const digits = hex.replace("#", "");
  return [0, 2, 4].map(
    (i) => parseInt(digits.slice(i, i + 2), 16) / 255
  ) as Rgb;
}

/**
 * The colour a token resolves to, whichever way it is spelled. Most of the
 * layer is oklch; the brand tokens are the hexes DESIGN.md publishes, and a
 * brand token lands on a surface exactly like any other.
 */
export function readToken(theme: "light" | "dark", name: string): Rgb {
  const value = resolveVars(theme, name);
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return hexToSrgb(value);
  return oklchToSrgb(...readTokenOklch(theme, name));
}

// --- Tailwind's own palette -------------------------------------------------

/**
 * `bg-yellow-500` is not a token this repo declares, so nothing in globals.css
 * can say what it paints — and any guard over an off-token fill has to know.
 *
 * The answer is READ, never typed. A hex pasted into a test is the #357 defect
 * one level up (a measurement re-derived by nothing: right on the day it is
 * typed, authoritative-sounding forever after), and a palette bump in a
 * Tailwind upgrade would move the pixels while the constant stayed still. The
 * stylesheet the build compiles against is the same source the browser renders
 * from, so the guard reads that file.
 */
export const TAILWIND_THEME_CSS = path.join(
  process.cwd(),
  "node_modules",
  "tailwindcss",
  "theme.css"
);

let tailwindTheme: string | null = null;

/** The colour Tailwind's default palette gives `<name>`, e.g. `yellow-500`. */
export function readPaletteColour(name: string): Rgb {
  tailwindTheme ??= stripCssComments(readFileSync(TAILWIND_THEME_CSS, "utf8"));

  const value = declaredValue(tailwindTheme, `color-${name}`);
  assert.ok(
    value,
    `tailwindcss/theme.css declares no --color-${name}. Either the class name is wrong or the palette moved — do not fall back to a literal`
  );

  const parsed = parseOklch(value);
  assert.ok(
    parsed,
    `--color-${name} is not an oklch() value in Tailwind's theme.css`
  );
  return oklchToSrgb(...parsed);
}

export const themes = ["light", "dark"] as const;

/**
 * Every surface a colour token can land on. The list is deliberately the full
 * set rather than the surfaces named in whichever issue is open: a token fix
 * that only satisfies the reported screens is a token fix that fails on the
 * next screen. #341's whole shape was `--muted-foreground` clearing 4.5:1 on
 * white ONLY, which is why /communication/history passed and /settings did not.
 */
export const SURFACES = [
  "background",
  "card",
  "popover",
  "muted",
  "secondary",
  "accent",
  "sidebar",
  "sidebar-accent",
] as const;

// --- shipped markup ---------------------------------------------------------

/**
 * The repo's home for test-only support code, and therefore not markup: the
 * walk below skips the whole directory, for the same reason it skips the
 * `.test.tsx?` files.
 *
 * Without the skip the guards scan their OWN implementation, and every class
 * name a module here has to NAME in order to describe a rule reads as a shipped
 * USE of it — the module fails the tests it powers, and the only defence left is
 * a comment asking future authors to describe the rules without naming them.
 *
 * A DIRECTORY, not a filename. The rule used to be `full === <one absolute
 * path>`, which covered this module only: rename it and the skip stopped
 * matching in silence, while `rendered-markup.ts` and `source-span.ts` — test
 * support in this same directory — were scanned as shipped markup the whole
 * time, and would have failed a guard the first time one of them had to write
 * `text-ef-dark` or `bg-destructive/10` to describe the rule it enforces. One
 * rule now covers every module here and survives any rename inside it.
 */
export const TEST_SUPPORT_DIR = path.join(SRC, "lib", "testing");

/** Every `.ts`/`.tsx` file under `dir` that ships (tests are not markup). */
export function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return full === TEST_SUPPORT_DIR ? [] : tsxFiles(full);
    }
    if (!entry.isFile()) return [];
    // Tests name the banned tokens on purpose; only shipped markup is scanned.
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Each line of shipped markup, tagged with the `path:line` that produced it. */
export function markupLines(): { where: string; line: string }[] {
  return tsxFiles(SRC).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => ({
        where: `${path.relative(process.cwd(), file)}:${i + 1}`,
        line,
      }))
  );
}
