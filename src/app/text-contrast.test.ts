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

/**
 * WCAG 2.2 SC 1.4.11 Non-text Contrast — the floor a focus indicator owes
 * against the colors next to it. Text has a higher bar (AA_BODY_TEXT); a ring
 * is not text.
 */
const NON_TEXT_CONTRAST = 3;

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
function themeBlock(theme: "light" | "dark"): string {
  const selector = theme === "light" ? ":root" : ".dark";
  const blockStart = css.indexOf(`${selector} {`);
  assert.notEqual(blockStart, -1, `${selector} block not found in globals.css`);
  // Comments are stripped first: this file argues for its values in prose, and
  // prose that names a token ("never --ef-dark: see the PR") reads as a
  // declaration to any regex that does not.
  return stripCssComments(
    css.slice(blockStart, css.indexOf("\n}", blockStart))
  );
}

/** The literal right-hand side of `--name`, before any `var()` is followed. */
function declaredValue(block: string, name: string): string | null {
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

/**
 * Follow `var(--x)` the way the cascade does. A token that names another token
 * is not a different colour — `--primary: var(--ink)` renders exactly what
 * `--ink` renders — so a reader that stopped at the literal would report the
 * ink as "missing" the moment the file stopped repeating it nine times.
 */
function resolveVars(theme: "light" | "dark", name: string): string {
  const block = themeBlock(theme);
  let current = name;
  for (let hop = 0; hop < 8; hop += 1) {
    const value = declaredValue(block, current);
    assert.ok(
      value !== null,
      `--${current} is not declared in the ${theme} theme (following --${name})`
    );
    const indirection = value.match(/^var\(\s*--([\w-]+)\s*\)$/);
    if (!indirection) return value;
    current = indirection[1];
  }
  assert.fail(`--${name} loops through var() in the ${theme} theme`);
}

function readTokenOklch(
  theme: "light" | "dark",
  name: string
): [number, number, number] {
  const value = resolveVars(theme, name);
  const match = value.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  assert.ok(match, `--${name} is not an oklch() value in the ${theme} theme`);

  const rawL = match[1];
  const L = rawL.endsWith("%") ? Number(rawL.slice(0, -1)) / 100 : Number(rawL);
  return [L, Number(match[2]), Number(match[3])];
}

/** `#rrggbb` -> gamma-encoded sRGB channels in 0..1, for DESIGN.md's spellings. */
function hexToSrgb(hex: string): Rgb {
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
function readToken(theme: "light" | "dark", name: string): Rgb {
  const value = resolveVars(theme, name);
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return hexToSrgb(value);
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

// --- the ink has ONE spelling (#411) ----------------------------------------
//
// The ink was written down twice — `--ef-dark: #181d19` and
// `oklch(0.224 0.011 151.267)` on nine more tokens — for one colour with ten
// owners and nothing in the file saying they were the same value. They are now
// one declaration (`--ink`) that everything else points at. Two things have to
// stay true for that to be worth anything: the alias must still BE the DESIGN.md
// hex, and nobody may paste the literal back in beside it.

/** DESIGN.md → Colors. The brand ink, and the app's only dark value. */
const DESIGN_MD_INK = "#181D19";

test("--ink is the DESIGN.md ink, and every ink-coloured token points at it", () => {
  const ink = readToken("light", "ink");
  assert.ok(
    contrastRatio(ink, hexToSrgb(DESIGN_MD_INK)) < 1.01,
    `--ink no longer resolves to DESIGN.md's ${DESIGN_MD_INK} — globals.css and the design authority have drifted apart`
  );

  // Every token the ink actually paints. Each is asserted through the resolver,
  // so a literal pasted back over one of them fails the identity below.
  const inkTokens = [
    "foreground",
    "card-foreground",
    "popover-foreground",
    "primary",
    "secondary-foreground",
    "accent-foreground",
    "sidebar-foreground",
    "sidebar-primary",
    "sidebar-accent-foreground",
    "ef-dark",
  ];

  const literals = inkTokens.filter(
    (name) => declaredValue(themeBlock("light"), name) !== "var(--ink)"
  );
  assert.deepEqual(
    literals,
    [],
    "an ink-coloured token spells the ink out again instead of pointing at --ink. One colour, one declaration: a second copy is a token that goes stale the next time the ink moves and says nothing when it does"
  );

  for (const name of inkTokens) {
    assert.ok(
      contrastRatio(readToken("light", name), ink) < 1.01,
      `--${name} no longer resolves to the ink`
    );
  }
});

// --- --destructive is TEXT before it is a fill (#411) ------------------------
//
// 66 call sites, and most of them are `text-destructive` on a form error — the
// sentences a user is most likely to be stuck on. shadcn's default landed here
// unruled and failed AA on half the surfaces it paints (4.00:1 on --muted,
// --secondary and --accent; 4.41:1 on --background): the #341 defect, one token
// over. The value shipped now is DESIGN.md's ruled `danger`, which is what makes
// the fix a token fix rather than a number that happens to pass.

/** DESIGN.md → Colors. `danger` — "errors and 'don't' marks only". */
const DESIGN_MD_DANGER = "#B4432F";

test("--destructive is the danger colour DESIGN.md ruled, not a shadcn default", () => {
  assert.ok(
    contrastRatio(
      readToken("light", "destructive"),
      hexToSrgb(DESIGN_MD_DANGER)
    ) < 1.01,
    `--destructive is no longer DESIGN.md's ruled danger ${DESIGN_MD_DANGER}. If danger genuinely moved, move it in DESIGN.md first — the app "shares the palette" by the 2026-07-31 ruling`
  );

  // The dark theme lifts the SAME colour rather than carrying a second red.
  const [, lightC, lightH] = readTokenOklch("light", "destructive");
  const [, darkC, darkH] = readTokenOklch("dark", "destructive");
  assert.ok(
    Math.abs(lightC - darkC) < 0.001 && Math.abs(lightH - darkH) < 0.001,
    `the two themes' danger reds have drifted apart (light C ${lightC} H ${lightH}, dark C ${darkC} H ${darkH}) — only L should differ`
  );
});

for (const theme of themes) {
  for (const surface of MUTED_FOREGROUND_SURFACES) {
    test(`--destructive clears AA body text on --${surface} in the ${theme} theme`, () => {
      const ratio = contrastRatio(
        readToken(theme, "destructive"),
        readToken(theme, surface)
      );

      assert.ok(
        ratio >= AA_BODY_TEXT,
        `text-destructive on --${surface} in ${theme} is ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1 — form errors are the text this token exists for. Fix it in globals.css against DESIGN.md's danger, never with a per-component color override`
      );
    });
  }
}

test("the pre-#411 --destructive genuinely failed, so adopting the ruled danger is not taste", () => {
  // Records what shadcn's default measured, so a revert cannot be argued back
  // in as "red is red". It passed on white, which is why it survived this long.
  const PRE_411 = oklchToSrgb(0.577, 0.245, 27.325);

  const onMuted = contrastRatio(PRE_411, readToken("light", "muted"));
  const onBackground = contrastRatio(PRE_411, readToken("light", "background"));
  const onCard = contrastRatio(PRE_411, readToken("light", "card"));

  assert.ok(
    Math.abs(onMuted - 4.0) < 0.02,
    `expected the measured ~4.00:1 on --muted, got ${onMuted.toFixed(2)}:1 — the surface tokens moved and these numbers are stale`
  );
  assert.ok(
    Math.abs(onBackground - 4.41) < 0.02,
    `expected the measured ~4.41:1 on --background, got ${onBackground.toFixed(2)}:1`
  );
  assert.ok(onCard > AA_BODY_TEXT, "on white it passed — that was the trap");
});

// --- a foreground token that no longer exists is a colour that no longer
//     renders (#411) -------------------------------------------------------
//
// `--destructive-foreground` was dropped from the token layer when the newer
// shadcn button started hardcoding `text-white`, but four AlertDialogActions
// still carried `bg-destructive text-destructive-foreground`. tailwind-merge
// puts that in the same group as the variant's `text-primary-foreground` and
// keeps the LAST one, so it deleted the class that worked and kept the class
// that compiled to nothing — leaving the label at whatever it inherited: ink on
// red, 3.59:1. Nothing failed loudly; an unknown utility is simply not emitted.

test("every `*-foreground` colour utility in shipped markup names a token that exists", () => {
  const theme = css.slice(css.indexOf("@theme inline {"));
  const declared = new Set(
    [...theme.matchAll(/--color-([\w-]+):/g)].map((match) => match[1])
  );

  const used = new Map<string, string>();
  for (const file of tsxFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /\b(?:text|bg|border|ring|fill|stroke)-([a-z][\w-]*-foreground)(?:\/\d+)?\b/g
    )) {
      if (!used.has(match[1]))
        used.set(match[1], path.relative(process.cwd(), file));
    }
  }

  const missing = [...used]
    .filter(([token]) => !declared.has(token))
    .map(([token, file]) => `${token} (${file})`);

  assert.deepEqual(
    missing,
    [],
    "shipped markup paints a `--color-*-foreground` the token layer does not define. Tailwind emits nothing for an unknown utility, so the element keeps whatever colour it inherited — and tailwind-merge will have dropped the class that WAS working, because it counts as the same utility group. Declare the token in globals.css"
  );
});

for (const theme of themes) {
  test(`the destructive button label clears AA on the fill it is painted on, in the ${theme} theme`, () => {
    const label = readToken(theme, "destructive-foreground");
    const fill = readToken(theme, "destructive");

    // Light paints `bg-destructive`; dark paints `dark:bg-destructive/60` over
    // the dialog surface, which is where these buttons actually live.
    const ground =
      theme === "light"
        ? fill
        : composite(fill, readToken(theme, "popover"), 0.6);

    const ratio = contrastRatio(label, ground);
    assert.ok(
      ratio >= AA_BODY_TEXT,
      `--destructive-foreground on the destructive fill in ${theme} is ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1`
    );
  });
}

// --- the attention scale: WCAG binds, APCA advises (#386 ruling, #411) -------
//
// The inks are TEXT (`text-attention-high-ink` on the tile's label), and the
// globals.css comment used to justify them with APCA alone — which the #386
// ruling makes advisory. They clear AA comfortably, but nothing said so, which
// is the same gap --muted-foreground sat in before #341: a token asserted by a
// comment. The tint the tile paints under them is measured too, because that is
// the ground they are actually read on.

const ATTENTION_INKS = [
  { ink: "attention-high-ink", tint: "attention-high", alpha: 0.12 },
  { ink: "attention-medium-ink", tint: "attention-medium", alpha: 0.18 },
] as const;

for (const theme of themes) {
  for (const { ink, tint, alpha } of ATTENTION_INKS) {
    test(`--${ink} clears AA body text on every surface and on its own tint in the ${theme} theme`, () => {
      for (const surface of MUTED_FOREGROUND_SURFACES) {
        const ground = readToken(theme, surface);

        const plain = contrastRatio(readToken(theme, ink), ground);
        assert.ok(
          plain >= AA_BODY_TEXT,
          `--${ink} on --${surface} in ${theme} is ${plain.toFixed(2)}:1, below ${AA_BODY_TEXT}:1`
        );

        const tinted = composite(readToken(theme, tint), ground, alpha);
        const onTint = contrastRatio(readToken(theme, ink), tinted);
        assert.ok(
          onTint >= AA_BODY_TEXT,
          `--${ink} on bg-${tint}/${alpha * 100} over --${surface} in ${theme} is ${onTint.toFixed(2)}:1, below ${AA_BODY_TEXT}:1 — the tile tint is the ground this ink is read on`
        );
      }
    });
  }
}

// --- field green is an icon colour, so it owes SC 1.4.11 (#411) -------------
//
// `text-ef-field fill-current` paints the wiki bookmark, which is a STATE — the
// only thing telling a bookmarked article from an un-bookmarked one. It had a
// light value and no dark one, so on a dark ground it measured 2.79:1.

for (const theme of themes) {
  test(`--ef-field clears SC 1.4.11 on every surface in the ${theme} theme`, () => {
    for (const surface of MUTED_FOREGROUND_SURFACES) {
      const ratio = contrastRatio(
        readToken(theme, "ef-field"),
        readToken(theme, surface)
      );
      assert.ok(
        ratio >= NON_TEXT_CONTRAST,
        `--ef-field on --${surface} in ${theme} is ${ratio.toFixed(2)}:1, below ${NON_TEXT_CONTRAST}:1 — the bookmark icon is the only cue that an article is saved`
      );
    }
  });
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

// --- the focus ring: WCAG 2.2 SC 1.4.11 (#385) -------------------------------
//
// Two things make the focus ring easy to get wrong, and both are why this fix
// is a token fix with tests rather than a screenshot:
//
//  1. Lighthouse has NO focus-indicator contrast audit. Every audited page
//     scored 100 with the ring measuring 1.5:1, so a Lighthouse score is not
//     evidence about this criterion. The tokens are.
//  2. The token is never rendered at full strength where it matters:
//     `focus-visible:ring-ring/50` composites it 50% over whatever surface the
//     control sits on. A token that passes on its own can still paint an
//     invisible ring, which is exactly what shipped. So the assertion that
//     counts is the composited one, at the alpha the components really use.

/**
 * Every surface a focus ring can be drawn against. A ring is painted OUTSIDE
 * the control's box, so the color it must contrast with is the ground behind
 * the control — the page, a card or popover, a muted/secondary/accent tile, or
 * the sidebar — never the control's own fill. Enumerated for the same reason
 * the --muted-foreground list is: a fix that satisfies the two surfaces named
 * in the issue is a fix that fails on the third.
 */
const RING_SURFACES = [
  "background",
  "card",
  "popover",
  "muted",
  "secondary",
  "accent",
  "sidebar",
  "sidebar-accent",
] as const;

/** The grounds --sidebar-ring can land on: the sidebar's own share of the set. */
const SIDEBAR_RING_SURFACES = RING_SURFACES.filter((surface) =>
  surface.startsWith("sidebar")
);

/**
 * The alpha the ring is ACTUALLY painted at, read out of the shipped markup.
 * Hard-coding 0.5 here would let a component introduce `ring-ring/30` and keep
 * this file green while the ring it describes goes invisible, so the worst
 * (lowest) alpha in the tree is what gets measured.
 */
function paintedRingAlphas(): { where: string; alpha: number }[] {
  return tsxFiles(SRC).flatMap((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, i) => {
      const where = `${path.relative(process.cwd(), file)}:${i + 1}`;
      return [...line.matchAll(/\bring-ring(?:\/(\d+))?\b/g)].map((match) => ({
        where,
        alpha: match[1] === undefined ? 1 : Number(match[1]) / 100,
      }));
    });
  });
}

const PAINTED_RING_ALPHAS = paintedRingAlphas();

test("the components still paint the ring from the --ring token", () => {
  // If this list empties out, every ratio below is measuring a token nothing
  // renders. button.tsx and input.tsx are the two the issue measured.
  const painted = PAINTED_RING_ALPHAS;
  assert.ok(
    painted.some((p) => p.where.startsWith("src/components/ui/button.tsx")),
    "button.tsx no longer paints ring-ring — re-measure whatever colors its focus ring now"
  );
  assert.ok(
    painted.some((p) => p.where.startsWith("src/components/ui/input.tsx")),
    "input.tsx no longer paints ring-ring — re-measure whatever colors its focus ring now"
  );
});

for (const theme of themes) {
  for (const surface of RING_SURFACES) {
    test(`--ring clears SC 1.4.11 on --${surface} in the ${theme} theme, at the alpha the components paint it`, () => {
      const ground = readToken(theme, surface);
      const ring = readToken(theme, "ring");

      // Full strength first: `focus-visible:border-ring` and the sidebar's
      // `ring-2` render the token undiluted.
      const solid = contrastRatio(ring, ground);
      assert.ok(
        solid >= NON_TEXT_CONTRAST,
        `--ring on --${surface} in ${theme} is ${solid.toFixed(2)}:1 at full strength, below ${NON_TEXT_CONTRAST}:1`
      );

      // Then as rendered. Anything that fails here is invisible in the browser
      // however good the number above looks.
      for (const { where, alpha } of PAINTED_RING_ALPHAS) {
        const ratio = contrastRatio(composite(ring, ground, alpha), ground);
        assert.ok(
          ratio >= NON_TEXT_CONTRAST,
          `the rendered ring (${where}, alpha ${alpha}) on --${surface} in ${theme} is ${ratio.toFixed(2)}:1, below ${NON_TEXT_CONTRAST}:1 — darken --ring in globals.css or raise the alpha, never with a per-component color override`
        );
      }
    });
  }
}

for (const theme of themes) {
  test(`--sidebar-ring clears SC 1.4.11 on the sidebar in the ${theme} theme`, () => {
    // The sidebar paints `ring-sidebar-ring focus-visible:ring-2` — no alpha —
    // so full strength IS what renders there. It carries its own token, which
    // is why it needs its own assertion: the two drifted apart is how a fixed
    // --ring would still leave the sidebar failing. Its grounds are the sidebar
    // subset of RING_SURFACES rather than a second hand-written list, so adding
    // a sidebar surface there adds it here too.
    for (const surface of SIDEBAR_RING_SURFACES) {
      const ratio = contrastRatio(
        readToken(theme, "sidebar-ring"),
        readToken(theme, surface)
      );
      assert.ok(
        ratio >= NON_TEXT_CONTRAST,
        `--sidebar-ring on --${surface} in ${theme} is ${ratio.toFixed(2)}:1, below ${NON_TEXT_CONTRAST}:1`
      );
    }
  });
}

/**
 * Wherever a danger variant overrides the ring COLOR, the --ring fix above does
 * not reach it, so that override owes SC 1.4.11 on its own. Read out of the
 * shipped markup for the same reason `paintedRingAlphas()` is — naming one file
 * (it was button.tsx) let badge.tsx keep shadcn's defaults, /20 light and /40
 * dark, which composite to 1.44:1 and 1.98:1: a focused Delete control with no
 * visible focus at all. Scanning the tree is also what catches the next
 * component that reaches for `ring-destructive/30`.
 *
 * Deliberately NOT extended to `aria-invalid:ring-destructive/*`: that state is
 * carried at full strength by the sibling `aria-invalid:border-destructive`, so
 * a faint ring there is not the same failure.
 */
function paintedDestructiveRings(): {
  where: string;
  dark: boolean;
  alpha: number;
}[] {
  return tsxFiles(SRC).flatMap((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, i) => {
      const where = `${path.relative(process.cwd(), file)}:${i + 1}`;
      return [
        ...line.matchAll(
          /(dark:)?focus-visible:ring-destructive(?:\/(\d+))?\b/g
        ),
      ].map((match) => ({
        where,
        dark: match[1] !== undefined,
        alpha: match[2] === undefined ? 1 : Number(match[2]) / 100,
      }));
    });
  });
}

test("every destructive focus-ring override is visible too", () => {
  // Zero sites is a legitimate state: it means everything inherits --ring,
  // which the cases above already measure.
  for (const { where, dark, alpha } of paintedDestructiveRings()) {
    const themesForRule = dark ? (["dark"] as const) : themes;

    for (const theme of themesForRule) {
      // The same eight grounds the --ring cases measure: a destructive Button
      // lands in a bg-muted panel, a popover and the sidebar just as readily as
      // on the page ground, so measuring two surfaces here would be the exact
      // shortcut RING_SURFACES exists to refuse.
      for (const surface of RING_SURFACES) {
        const ground = readToken(theme, surface);
        const ratio = contrastRatio(
          composite(readToken(theme, "destructive"), ground, alpha),
          ground
        );
        assert.ok(
          ratio >= NON_TEXT_CONTRAST,
          `the destructive focus ring (${where}, alpha ${alpha}) on --${surface} in ${theme} is ${ratio.toFixed(2)}:1, below ${NON_TEXT_CONTRAST}:1 — paint the danger hue at full strength, the ring is the only thing carrying focus here`
        );
      }
    }
  }
});

test("the pre-#385 --ring genuinely failed, in both themes and for two different reasons", () => {
  // Records the reported numbers so the shadcn defaults cannot be argued back
  // in. The light token failed outright; the dark one passed on its own and
  // failed only once composited, which is why an audit that measured the token
  // instead of the paint called the dark theme fine.
  const PRE_385_LIGHT = oklchToSrgb(0.708, 0, 0);
  const PRE_385_DARK = oklchToSrgb(0.556, 0, 0);

  const lightBackground = readToken("light", "background");
  const lightCard = readToken("light", "card");

  const solidOnBackground = contrastRatio(PRE_385_LIGHT, lightBackground);
  const solidOnCard = contrastRatio(PRE_385_LIGHT, lightCard);
  assert.ok(
    Math.abs(solidOnBackground - 2.4) < 0.02,
    `expected the reported ~2.40:1 on --background, got ${solidOnBackground.toFixed(2)}:1 — the surface tokens moved and these numbers are stale`
  );
  assert.ok(
    Math.abs(solidOnCard - 2.59) < 0.02,
    `expected the reported ~2.59:1 on --card, got ${solidOnCard.toFixed(2)}:1`
  );

  // The number a user actually saw: ~1.5:1.
  const renderedOnCard = contrastRatio(
    composite(PRE_385_LIGHT, lightCard, 0.5),
    lightCard
  );
  assert.ok(
    Math.abs(renderedOnCard - 1.54) < 0.02,
    `expected the reported ~1.54:1 rendered, got ${renderedOnCard.toFixed(2)}:1`
  );

  // Dark: 4.18:1 and 3.79:1 unaided — passing — but 1.87:1 as painted.
  const darkCard = readToken("dark", "card");
  assert.ok(
    contrastRatio(PRE_385_DARK, darkCard) > NON_TEXT_CONTRAST,
    "the dark token used to pass unaided; if it no longer does, this test's story is stale"
  );
  const darkRendered = contrastRatio(
    composite(PRE_385_DARK, darkCard, 0.5),
    darkCard
  );
  assert.ok(
    darkRendered < NON_TEXT_CONTRAST,
    `the old dark ring measured ${darkRendered.toFixed(2)}:1 as painted — if this now passes, the tokens moved and this test is stale`
  );
});
