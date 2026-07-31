import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ----------------------------------------------------------------------------
// Contrast is a property of the design tokens, not of any one screen, so it can
// be asserted without a browser: read the oklch tokens straight out of
// globals.css, convert them the way a browser does (oklch -> linear sRGB ->
// gamma-encoded sRGB, alpha composited in gamma space), and compute the WCAG
// ratio.
//
// The node under test is the filter-result count on /communication/history
// ("2 matching messages"). #17 turned that paragraph from decoration into
// information, so it owes the AA 4.5:1 floor for body text. It renders inside
// the page header, which is `bg-card`.
// ----------------------------------------------------------------------------

const SRC = path.join(process.cwd(), "src");
const GLOBALS_CSS = path.join(SRC, "app", "globals.css");

const AA_BODY_TEXT = 4.5;

// --- color math -------------------------------------------------------------

type Rgb = [number, number, number];

/** oklch(L C H) -> gamma-encoded sRGB channels in 0..1. */
function oklchToSrgb(L: number, C: number, hDeg: number): Rgb {
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

function encodeSrgb(channel: number): number {
  const v = Math.min(1, Math.max(0, channel));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

function decodeSrgb(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * CSS composites a translucent color over its backdrop in gamma-encoded sRGB,
 * which is exactly why `text-foreground/50` looks lighter than its nominal
 * lightness suggests.
 */
function composite(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  return (
    0.2126 * decodeSrgb(r) + 0.7152 * decodeSrgb(g) + 0.0722 * decodeSrgb(b)
  );
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// --- token parsing ----------------------------------------------------------

const css = readFileSync(GLOBALS_CSS, "utf8");

/**
 * `:root` holds the light theme, `.dark` the dark one. Both are flat blocks of
 * custom properties, so the last declaration inside the requested block wins —
 * the same rule the cascade applies.
 */
function readToken(theme: "light" | "dark", name: string): Rgb {
  const selector = theme === "light" ? ":root" : ".dark";
  const blockStart = css.indexOf(`${selector} {`);
  assert.notEqual(blockStart, -1, `${selector} block not found in globals.css`);
  const blockEnd = css.indexOf("\n}", blockStart);
  const block = css.slice(blockStart, blockEnd);

  const match = block.match(
    new RegExp(
      `--${name}:\\s*oklch\\(\\s*([\\d.]+%?)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`
    )
  );
  assert.ok(match, `--${name} not found as an oklch() value in ${selector}`);

  const rawL = match[1];
  const L = rawL.endsWith("%") ? Number(rawL.slice(0, -1)) / 100 : Number(rawL);
  return oklchToSrgb(L, Number(match[2]), Number(match[3]));
}

const themes = ["light", "dark"] as const;

// --- the conversion itself --------------------------------------------------

test("oklch conversion reproduces the sRGB anchors it is measured against", () => {
  const white = oklchToSrgb(1, 0, 0);
  const black = oklchToSrgb(0, 0, 0);

  for (const channel of white) assert.ok(Math.abs(channel - 1) < 0.001);
  for (const channel of black) assert.ok(Math.abs(channel) < 0.001);

  // White on black is the maximum WCAG ratio, 21:1.
  assert.ok(Math.abs(contrastRatio(white, black) - 21) < 0.01);
});

// --- the node the issue is about --------------------------------------------

for (const theme of themes) {
  test(`the filter-result count clears AA body text in the ${theme} theme`, () => {
    const surface = readToken(theme, "card"); // the header is `bg-card`
    const text = readToken(theme, "muted-foreground");

    const ratio = contrastRatio(text, surface);
    assert.ok(
      ratio >= AA_BODY_TEXT,
      `text-muted-foreground on bg-card in ${theme} is ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1`
    );
  });
}

test("the old token is kept out because it genuinely fails, not by taste", () => {
  // Light theme is where it failed: ~3.69:1 with the pre-sharp gray tokens
  // (the number in the issue); ~3.30:1 since the sharp ink/cream palette.
  // Either way it sits under the 4.5:1 floor, which is the point.
  const surface = readToken("light", "card");
  const faded = composite(readToken("light", "foreground"), surface, 0.5);
  const ratio = contrastRatio(faded, surface);

  assert.ok(
    ratio < AA_BODY_TEXT,
    `text-foreground/50 measured ${ratio.toFixed(2)}:1 — if this now passes, the tokens moved and this test is stale`
  );
  assert.ok(Math.abs(ratio - 3.3) < 0.1, `expected ~3.30:1, got ${ratio}`);
});

// --- regression guard -------------------------------------------------------

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    if (!entry.isFile()) return [];
    // Tests name the banned token on purpose; only shipped markup is scanned.
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test("no meaningful text is painted with text-foreground/50 — decorative uses must carry an a11y-decorative marker", () => {
  // Ruling on #151 (PR #173, option b): the guard is scoped to the AC's
  // wording. WCAG imposes no contrast floor on decorative elements (icons
  // tinted via currentColor, ornaments), so a line may keep the class by
  // declaring itself decorative with an inline `a11y-decorative` comment on
  // that same line — legal, greppable, and auditable. Any unmarked use is
  // treated as meaningful text and fails.
  const offenders = tsxFiles(SRC).flatMap((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, i) =>
      line.includes("text-foreground/50") && !line.includes("a11y-decorative")
        ? [`${path.relative(process.cwd(), file)}:${i + 1}`]
        : []
    );
  });

  assert.deepEqual(
    offenders,
    [],
    "text-foreground/50 is 3.69:1 on white — use text-muted-foreground for text that carries meaning, or mark the line {/* a11y-decorative */} if it is genuinely decorative"
  );
});
