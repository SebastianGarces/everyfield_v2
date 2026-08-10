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

/**
 * WCAG SC 1.4.1 (Use of Color). When colour is the ONLY thing telling a link
 * apart from the text around it, that colour difference has to reach 3:1 —
 * the same threshold non-text contrast uses. Below it, the link needs a cue
 * that is not colour.
 */
const SC_1_4_1_NON_COLOUR_THRESHOLD = 3;

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
function readTokenOklch(
  theme: "light" | "dark",
  name: string
): [number, number, number] {
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
  return [L, Number(match[2]), Number(match[3])];
}

function readToken(theme: "light" | "dark", name: string): Rgb {
  return oklchToSrgb(...readTokenOklch(theme, name));
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

// --- --muted-foreground on every surface it can land on (#341, #238) --------
//
// The token is app-wide, so "does it pass" is not a question about one screen:
// `text-muted-foreground` is painted on the page ground, on cards and popovers,
// on the sidebar, and on the muted/secondary/accent tiles. Before #341 it
// cleared 4.5:1 on white ONLY — which is why the audits disagreed with each
// other: /communication/history measured it on `bg-card` and passed, while
// /settings and /notifications measured it on `bg-background` and failed at
// 4.38:1. Enumerating the surfaces is what stops that from recurring.
//
// The list is deliberately the full set rather than the two pages in the
// issues: a token fix that only satisfies the reported screens is a token fix
// that fails on the next screen.
const MUTED_FOREGROUND_SURFACES = [
  "background",
  "card",
  "popover",
  "muted",
  "secondary",
  "accent",
  "sidebar",
  "sidebar-accent",
] as const;

for (const theme of themes) {
  for (const surface of MUTED_FOREGROUND_SURFACES) {
    test(`--muted-foreground clears AA body text on --${surface} in the ${theme} theme`, () => {
      const ratio = contrastRatio(
        readToken(theme, "muted-foreground"),
        readToken(theme, surface)
      );

      assert.ok(
        ratio >= AA_BODY_TEXT,
        `text-muted-foreground on --${surface} in ${theme} is ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1 — fix the token in globals.css, never with a per-component color override`
      );
    });
  }
}

// --- the AA limit the globals.css comment names (#357) ----------------------
//
// That comment exists to stop a future agent from lightening the token, and it
// argues from a single number: the lightest L that still clears 4.5:1 on
// --muted, the darkest surface --muted-foreground lands on. #341 published that
// number wrong (L 0.5055, which actually measures 4.91:1 there — it understated
// the headroom rather than overstating the margin, so nothing unsafe shipped,
// but it was a wrong measurement in the one comment whose job is to be right).
// So the limit is DERIVED here and the comment is required to agree with it.
const DOCUMENTED_MUTED_AA_LIMIT = 0.526;

/**
 * Contrast against a light surface falls monotonically as L rises, so bisection
 * finds the boundary: `pass` stays the lightest neutral L known to clear AA.
 */
function lightestPassingL(surface: Rgb): number {
  let pass = 0;
  let fail = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (pass + fail) / 2;
    if (contrastRatio(oklchToSrgb(mid, 0, 0), surface) >= AA_BODY_TEXT) {
      pass = mid;
    } else {
      fail = mid;
    }
  }
  return pass;
}

test("the AA limit documented in globals.css is the one the math actually gives", () => {
  const limit = lightestPassingL(readToken("light", "muted"));

  assert.ok(
    Math.abs(limit - DOCUMENTED_MUTED_AA_LIMIT) < 0.001,
    `the AA limit on --muted is L ${limit.toFixed(4)}, not ${DOCUMENTED_MUTED_AA_LIMIT} — update the comment in globals.css and this constant together`
  );

  const comment = css.slice(0, css.indexOf("--muted-foreground:"));
  assert.match(
    comment,
    /L ≈ 0\.526/,
    "the --muted-foreground comment no longer names the L 0.526 AA limit it argues from"
  );
  assert.doesNotMatch(
    comment,
    /0\.5055/,
    "0.5055 is the wrong AA limit (#357) — it measures 4.91:1 on --muted, not 4.5:1"
  );
});

test("the shipped --muted-foreground sits under that limit rather than on it", () => {
  const [L] = readTokenOklch("light", "muted-foreground");

  assert.ok(
    L < DOCUMENTED_MUTED_AA_LIMIT,
    `--muted-foreground is L ${L} — at or above the L ${DOCUMENTED_MUTED_AA_LIMIT} AA limit on --muted. Darken the token in globals.css; never paper over it with a per-component color override`
  );
});

test("the avatar fallback reads at AA because of the token, not an override", () => {
  // #238's sidebar finding measured 3.97:1. That is not a sidebar bug: the
  // fallback is `bg-muted text-muted-foreground`, and --muted is the darkest
  // light surface the token lands on, so it was the worst case of the SAME
  // failure #341 describes. This test exists to keep the two facts wired
  // together — if AvatarFallback ever stops using this pair, the ratio asserted
  // above stops being the ratio a user sees, and the assertion below says so.
  const avatar = readFileSync(
    path.join(SRC, "components", "ui", "avatar.tsx"),
    "utf8"
  );
  const fallback = avatar.slice(avatar.indexOf("function AvatarFallback"));

  assert.match(
    fallback,
    /bg-muted text-muted-foreground/,
    "AvatarFallback no longer pairs bg-muted with text-muted-foreground — re-measure the fallback against whatever surface it now uses (#238)"
  );

  const ratio = contrastRatio(
    readToken("light", "muted-foreground"),
    readToken("light", "muted")
  );
  assert.ok(
    ratio >= AA_BODY_TEXT,
    `avatar-fallback initials measure ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1`
  );
});

test("the pre-#341 --muted-foreground genuinely failed, so the fix is not taste", () => {
  // Records what was wrong, so a revert to the shadcn default cannot be argued
  // back in as "it was fine on cards" — it was, and that was the trap.
  const PRE_341 = oklchToSrgb(0.556, 0, 0);

  const onBackground = contrastRatio(PRE_341, readToken("light", "background"));
  const onMuted = contrastRatio(PRE_341, readToken("light", "muted"));
  const onCard = contrastRatio(PRE_341, readToken("light", "card"));

  assert.ok(
    Math.abs(onBackground - 4.38) < 0.02,
    `expected the reported ~4.38:1 on --background, got ${onBackground.toFixed(2)}:1 — the surface tokens moved and these numbers are stale`
  );
  assert.ok(
    Math.abs(onMuted - 3.97) < 0.02,
    `expected the reported ~3.97:1 on --muted (the avatar fallback), got ${onMuted.toFixed(2)}:1`
  );
  // The reason the failure survived an earlier audit: on white it passed.
  assert.ok(onCard > AA_BODY_TEXT);
});

test("the old token is kept out because it genuinely fails, not by taste", () => {
  // Light theme is where it failed: ~3.69:1 with the pre-sharp near-black
  // foreground (the number in the issue); ~3.27:1 since foreground became ink
  // #181D19. Either way it sits under the 4.5:1 floor, which is the point.
  const surface = readToken("light", "card");
  const faded = composite(readToken("light", "foreground"), surface, 0.5);
  const ratio = contrastRatio(faded, surface);

  assert.ok(
    ratio < AA_BODY_TEXT,
    `text-foreground/50 measured ${ratio.toFixed(2)}:1 — if this now passes, the tokens moved and this test is stale`
  );
  assert.ok(Math.abs(ratio - 3.3) < 0.1, `expected ~3.30:1, got ${ratio}`);
});

// --- inline links in prose: SC 1.4.1 (#386 ruling, PR #387) -----------------
//
// Darkening --muted-foreground for AA moves it TOWARD --primary, which is the
// colour an inline link is painted in. So the token's AA headroom against its
// own surface and its separation from link text move in OPPOSITE directions,
// and the second one fell through the floor while the first was being fixed:
// Lighthouse flagged `link-in-text-block` on /login's "Sign up".
//
// The 2026-08-10 ruling took that cost out of the token's way rather than
// capping how far the token may darken — inline links carry a permanent
// underline, which holds at any lightness. These tests pin BOTH halves: the
// arithmetic that makes the underline load-bearing, and the underline itself.

test("colour alone cannot separate an inline link from muted prose, in either theme", () => {
  // The measured pairing behind the finding: `text-primary` link inside a
  // `text-muted-foreground` paragraph, which is exactly /login's "Sign up".
  const light = contrastRatio(
    readToken("light", "primary"),
    readToken("light", "muted-foreground")
  );
  const dark = contrastRatio(
    readToken("dark", "primary"),
    readToken("dark", "muted-foreground")
  );

  // Quoted in memory/invariants.md and in the globals.css comment. If the
  // tokens move these drift, and the prose that argues from them goes stale.
  assert.ok(
    Math.abs(light - 2.85) < 0.02,
    `expected the recorded ~2.85:1 link/prose separation in light, got ${light.toFixed(2)}:1 — update memory/invariants.md and the globals.css comment with the new figures`
  );
  assert.ok(
    Math.abs(dark - 2.06) < 0.02,
    `expected the recorded ~2.06:1 link/prose separation in dark, got ${dark.toFixed(2)}:1 — update memory/invariants.md and the globals.css comment with the new figures`
  );

  for (const [theme, ratio] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    assert.ok(
      ratio < SC_1_4_1_NON_COLOUR_THRESHOLD,
      `link/prose separation in ${theme} is now ${ratio.toFixed(2)}:1, at or over ${SC_1_4_1_NON_COLOUR_THRESHOLD}:1 — colour alone would satisfy SC 1.4.1 again. The permanent underline is still ruled (PR #387, it must not depend on where the token sits); re-record the numbers rather than dropping it`
    );
  }
});

test("the pre-#341 token is not an escape hatch — it only passes SC 1.4.1 by giving AA back", () => {
  // Option (b) on the ruling was "cap the darkening at the 1.4.1 boundary".
  // This records why it was rejected: the lightest L that clears 3:1 against
  // --primary is lighter than the AA ceiling on --muted, so honouring both
  // with colour alone leaves the token almost no room at all.
  const primary = readToken("light", "primary");
  const aaCeiling = lightestPassingL(readToken("light", "muted"));

  const atAaCeiling = contrastRatio(oklchToSrgb(aaCeiling, 0, 0), primary);
  assert.ok(
    atAaCeiling > SC_1_4_1_NON_COLOUR_THRESHOLD,
    `at the AA ceiling L ${aaCeiling.toFixed(4)} the link separation is ${atAaCeiling.toFixed(2)}:1`
  );

  // ...but the shipped token is a real step below that ceiling (by design —
  // see globals.css), and there the colour-only answer fails. The window
  // where both hold is the sliver between the two, which is why the remedy
  // is a non-colour cue instead of a lightness cap.
  const [shipped] = readTokenOklch("light", "muted-foreground");
  assert.ok(
    contrastRatio(oklchToSrgb(shipped, 0, 0), primary) <
      SC_1_4_1_NON_COLOUR_THRESHOLD,
    "the shipped token now clears 3:1 against --primary — re-read the PR #387 ruling before treating a lightness cap as sufficient"
  );
});

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

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Index of the `}` closing the `{` at `open`. */
function matchingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  return css.length;
}

/**
 * The part of a stylesheet that sits OUTSIDE every `@layer` block — the
 * declarations that outrank all layered CSS regardless of specificity.
 */
function unlayeredPart(source: string): string {
  const css = stripCssComments(source);
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@layer", i);
    if (at === -1) return out + css.slice(i);
    out += css.slice(i, at);

    const open = css.indexOf("{", at);
    const semi = css.indexOf(";", at);
    // `@layer theme, base, utilities;` is a statement, not a block.
    if (open === -1 || (semi !== -1 && semi < open)) {
      i = semi === -1 ? css.length : semi + 1;
      continue;
    }
    i = matchingBrace(css, open) + 1;
  }
  return out;
}

/** Flatten a CSS fragment to style rules, descending through `@media` etc. */
function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const prelude = css
      .slice(i, open)
      .trim()
      .replace(/^[;}]+/, "")
      .trim();
    const close = matchingBrace(css, open);
    const body = css.slice(open + 1, close);
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
