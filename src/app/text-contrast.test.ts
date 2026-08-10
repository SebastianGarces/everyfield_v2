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
    // --ring would still leave the sidebar failing.
    for (const surface of ["sidebar", "sidebar-accent"] as const) {
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

test("the destructive button's focus ring is visible too", () => {
  // The danger variant overrides the ring color, so the token fix does not
  // reach it. shadcn's defaults were /20 light and /40 dark — 1.43:1 and
  // 1.95:1 composited, i.e. a Delete button that showed no focus at all.
  const button = readFileSync(
    path.join(SRC, "components", "ui", "button.tsx"),
    "utf8"
  );
  const matches = [
    ...button.matchAll(/(dark:)?focus-visible:ring-destructive(?:\/(\d+))?\b/g),
  ];
  assert.ok(
    matches.length > 0,
    "button.tsx no longer gives the destructive variant its own focus ring — it now inherits --ring, which is measured above; drop this test"
  );

  for (const match of matches) {
    const themesForRule = match[1] ? (["dark"] as const) : themes;
    const alpha = match[2] === undefined ? 1 : Number(match[2]) / 100;

    for (const theme of themesForRule) {
      for (const surface of ["background", "card"] as const) {
        const ground = readToken(theme, surface);
        const ratio = contrastRatio(
          composite(readToken(theme, "destructive"), ground, alpha),
          ground
        );
        assert.ok(
          ratio >= NON_TEXT_CONTRAST,
          `the destructive focus ring (alpha ${alpha}) on --${surface} in ${theme} is ${ratio.toFixed(2)}:1, below ${NON_TEXT_CONTRAST}:1`
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
