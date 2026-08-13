import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  AA_BODY_TEXT,
  SURFACES,
  NON_TEXT_CONTRAST,
  type Rgb,
  SAME_COLOUR,
  SC_1_4_1_NON_COLOUR_THRESHOLD,
  SRC,
  composite,
  contrastRatio,
  css,
  declaredTokens,
  declaredValue,
  hexToSrgb,
  markupLines,
  oklchToSrgb,
  readToken,
  readTokenOklch,
  themeBlock,
  themes,
} from "./theme-color";

// ----------------------------------------------------------------------------
// The token layer itself: identity (is a token still the colour the design
// authority ruled?) and contrast (does it clear its WCAG floor on every ground
// it lands on?). Mostly colour math over globals.css.
//
// Three siblings, one subject each, over the shared math in `./theme-color`:
//   · this file          — token identity and token-on-surface contrast
//   · focus-ring.test.ts — the focus indicator, which owes SC 1.4.11 not AA
//   · text-contrast.test.ts — what SHIPS: .tsx markup and the other stylesheets
// ----------------------------------------------------------------------------

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
//
// The node under test is the filter-result count on /communication/history
// ("2 matching messages"). #17 turned that paragraph from decoration into
// information, so it owes the AA 4.5:1 floor for body text. It renders inside
// the page header, which is `bg-card`.

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

for (const theme of themes) {
  for (const surface of SURFACES) {
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
// one declaration (`--ink`) that everything else points at.
//
// The guard is DERIVED from the block rather than run against a list of the ten
// tokens that happen to point at the ink today. A hand-kept list catches a token
// that STOPS pointing at `--ink`; it cannot catch the failure the alias exists
// to prevent — an ELEVENTH role token with the oklch literal pasted onto it,
// which is exactly how the ten copies accumulated. A list also has to be edited
// by hand every time a role token is added, so it goes stale in silence: the
// same defect as the two spellings, moved out of the CSS and into the test.

/** DESIGN.md → Colors. The brand ink, and the app's only dark value. */
const DESIGN_MD_INK = "#181D19";

test("--ink is the DESIGN.md ink, and no other token respells it", () => {
  const ink = readToken("light", "ink");
  assert.ok(
    contrastRatio(ink, hexToSrgb(DESIGN_MD_INK)) < SAME_COLOUR,
    `--ink no longer resolves to DESIGN.md's ${DESIGN_MD_INK} — globals.css and the design authority have drifted apart`
  );

  const block = themeBlock("light");
  const tokens = declaredTokens(block);
  assert.ok(
    tokens.length > 20,
    `only ${tokens.length} tokens were found in :root — the block reader has gone vacuous, fix it before trusting a pass`
  );

  const respellers = tokens.filter((name) => {
    if (name === "ink") return false;
    // Pointing at the alias is the whole point; that is not a respelling.
    if (declaredValue(block, name) === "var(--ink)") return false;
    let colour: Rgb;
    try {
      colour = readToken("light", name);
    } catch {
      return false; // `--radius: 0rem` and friends are not colours at all.
    }
    return contrastRatio(colour, ink) < SAME_COLOUR;
  });

  assert.deepEqual(
    respellers,
    [],
    `a token is the ink written out again instead of \`var(--ink)\`. One colour, one declaration: a second copy is a token that goes stale the next time the ink moves and says nothing when it does. Point it at --ink`
  );
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
    ) < SAME_COLOUR,
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
  for (const surface of SURFACES) {
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

// --- the destructive TINT, which is the ground the errors are actually read on
//
// `bg-destructive/10 text-destructive` is the app's one destructive pattern with
// real reach: eleven error banners plus the destructive dropdown item, twelve
// call sites in all. The plain-surface cases above pass; the tinted ones do not,
// and the tint is made from THIS token, so ink and backdrop darken together and
// no token value can fix it. The remedy is the component's (a solid ground, the
// csf-scorecard.tsx precedent) or a new text-on-tint role token — both design
// rulings, recorded as a DECISION on the PR rather than decided in a sweep.
//
// What is NOT deferred is measuring it. The tests the pass shipped stopped
// exactly where the token stops passing, which is structurally the #341 defect
// ("it passed on white, which is why it survived this long"). So every shipped
// alpha, on every surface, is measured here, and the ones the DECISION accepts
// are pinned to their number with an INVERTED assertion: they must still fail,
// at that value, or this file demands an explanation.

/**
 * Every `bg-destructive/<alpha>` in shipped markup that is painted UNDER
 * `text-destructive`, read out of the tree rather than listed here. Naming the
 * files is what let the previous pass believe there were six of them.
 *
 * `dark:` decides the themes: a `dark:`-prefixed tint applies to the dark theme
 * only, and an unprefixed one applies to both UNLESS the same line overrides it
 * in dark — which is exactly what `ui/dropdown-menu.tsx` does (/10 light, /20
 * dark).
 */
function shippedDestructiveTints(): {
  where: string;
  alpha: number;
  themes: readonly ("light" | "dark")[];
}[] {
  // The variant chain between `dark:` and the utility is arbitrary
  // (`dark:data-[variant=destructive]:focus:bg-destructive/20`), so the prefix
  // is matched as "everything back to the last whitespace" — anything narrower
  // loses the `dark:` and files the dark-only tint under the light theme.
  const TINT = /(dark:)?[\w[\]=.:-]*bg-destructive\/(\d+)\b/g;
  const INK = /\btext-destructive(?![\w-])/;

  return markupLines().flatMap(({ where, line }) => {
    if (!INK.test(line)) return [];
    const found = [...line.matchAll(TINT)].map((match) => ({
      dark: match[1] !== undefined,
      alpha: Number(match[2]) / 100,
    }));
    const hasDarkOverride = found.some((tint) => tint.dark);

    return found.map(({ dark, alpha }) => ({
      where,
      alpha,
      themes: dark
        ? (["dark"] as const)
        : hasDarkOverride
          ? (["light"] as const)
          : themes,
    }));
  });
}

/**
 * The DECISION ledger: every shipped destructive tint that does NOT clear AA,
 * and the number being accepted. Anything a shipped tint lands on that is not
 * listed here MUST clear AA — so a new call site, a new alpha or a token move
 * fails this file rather than passing quietly.
 */
const DEFERRED_DESTRUCTIVE_TINTS: Record<string, number> = {
  "light /10 on --muted": 4.07,
  "light /10 on --secondary": 4.07,
  "light /10 on --accent": 4.07,
  "light /10 on --sidebar-accent": 4.42,
  "light /10 on --background": 4.46,
  "dark /20 on --muted": 3.89,
  "dark /20 on --secondary": 3.89,
  "dark /20 on --accent": 3.89,
  "dark /20 on --sidebar-accent": 3.89,
};

test("every shipped `bg-destructive` tint under `text-destructive` is measured", () => {
  const sites = shippedDestructiveTints();
  assert.ok(
    sites.length >= 12,
    `only ${sites.length} destructive tint call sites were found; there were twelve. The scan has gone vacuous — fix it before trusting a pass`
  );

  const unexpectedlyPassing: string[] = [];
  for (const { where, alpha, themes: applies } of sites) {
    for (const theme of applies) {
      for (const surface of SURFACES) {
        const ink = readToken(theme, "destructive");
        const ground = readToken(theme, surface);
        const tint = composite(ink, ground, alpha);
        const ratio = contrastRatio(ink, tint);

        const key = `${theme} /${Math.round(alpha * 100)} on --${surface}`;
        const deferred = DEFERRED_DESTRUCTIVE_TINTS[key];

        if (deferred === undefined) {
          assert.ok(
            ratio >= AA_BODY_TEXT,
            `${key} (${where}) is ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1, and no DECISION covers it. Either give this banner a solid ground (csf-scorecard.tsx sets the precedent) or record the number in DEFERRED_DESTRUCTIVE_TINTS with a ruling behind it`
          );
          continue;
        }

        assert.ok(
          Math.abs(ratio - deferred) < 0.02,
          `${key} (${where}) measures ${ratio.toFixed(2)}:1, not the recorded ${deferred}:1 — a token moved. Re-record the DECISION with the new number`
        );
        if (ratio >= AA_BODY_TEXT) unexpectedlyPassing.push(key);
      }
    }
  }

  // The inverted half: a deferred entry that starts PASSING means the DECISION
  // was resolved somewhere, and leaving it listed would hide the next one.
  assert.deepEqual(
    [...new Set(unexpectedlyPassing)],
    [],
    `a destructive tint recorded as failing now clears AA. Good news — delete its entry from DEFERRED_DESTRUCTIVE_TINTS so the ledger only holds what is genuinely still open`
  );
});

// --- a foreground token that no longer exists is a colour that no longer
//     renders (#411) -------------------------------------------------------

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
      for (const surface of SURFACES) {
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
    for (const surface of SURFACES) {
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

// --- --ef-dark is the ink that reads on GREEN, and on nothing else -----------
//
// `--ef-dark` is `var(--ink)` and the dark block deliberately declares no twin:
// the logo tile is the same green in both themes, so the ink that reads on it
// does not invert. The cascade therefore hands the dark theme the LIGHT value,
// which is correct on the green tile and catastrophic anywhere else — ink on
// `--card` measures 1.05:1 in the dark theme, which is text nobody can see.
// That is not hypothetical: `people/status-timeline.tsx` painted the current
// step's LABEL with it, on the card ground rather than on the tile.
//
// So the rule is a rule about GROUND, not about a number, and both halves are
// pinned: the tile passes in both themes, every other ground fails, and shipped
// markup may only paint this token where the green is.

const GREEN_GROUND = /\bbg-(?:ef\b|\[var\(--color-ef\)\])/;
const EF_DARK_INK = /\btext-(?:ef-dark\b|\[var\(--color-ef-dark\)\])/;

for (const theme of themes) {
  test(`--ef-dark clears AA on the green tile in the ${theme} theme`, () => {
    // Reading it in the dark theme is the point: neither --ef-dark nor --ef is
    // redeclared there, so this only has a value at all because the resolver
    // inherits from :root the way the browser does.
    const ratio = contrastRatio(
      readToken(theme, "ef-dark"),
      readToken(theme, "ef")
    );
    assert.ok(
      ratio >= AA_BODY_TEXT,
      `--ef-dark on --ef in ${theme} is ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1 — this pair is the logo tile`
    );
  });
}

test("--ef-dark on a page or card ground is invisible in the dark theme, which is why the guard below exists", () => {
  for (const [surface, expected] of [
    ["card", 1.05],
    ["background", 1.16],
  ] as const) {
    const ratio = contrastRatio(
      readToken("dark", "ef-dark"),
      readToken("dark", surface)
    );
    assert.ok(
      Math.abs(ratio - expected) < 0.02,
      `expected the measured ~${expected}:1 for --ef-dark on --${surface} in dark, got ${ratio.toFixed(2)}:1`
    );
    assert.ok(
      ratio < AA_BODY_TEXT,
      `--ef-dark now reads on --${surface} in the dark theme (${ratio.toFixed(2)}:1) — if it gained a dark value, delete this test and let the guard below relax`
    );
  }
});

test("nothing paints --ef-dark as text except on the green ground", () => {
  const offenders = markupLines()
    .filter(({ line }) => EF_DARK_INK.test(line) && !GREEN_GROUND.test(line))
    .map(({ where }) => where);

  assert.deepEqual(
    offenders,
    [],
    "--ef-dark is painted as text without the green under it. It has no dark value by design (it is the ink that reads on the logo tile, which is one colour in both themes), so on any other ground the dark theme paints ink on near-black — 1.05:1 on --card. Page text uses text-foreground"
  );
});

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
    `text-foreground at half alpha measured ${ratio.toFixed(2)}:1 — if this now passes, the tokens moved and this test is stale`
  );
  assert.ok(Math.abs(ratio - 3.3) < 0.1, `expected ~3.30:1, got ${ratio}`);
});

// --- inline links in prose: the arithmetic behind the SC 1.4.1 ruling --------
//
// Darkening --muted-foreground for AA moves it TOWARD --primary, which is the
// colour an inline link is painted in. So the token's AA headroom against its
// own surface and its separation from link text move in OPPOSITE directions,
// and the second one fell through the floor while the first was being fixed:
// Lighthouse flagged `link-in-text-block` on /login's "Sign up".
//
// The 2026-08-10 ruling took that cost out of the token's way rather than
// capping how far the token may darken. The CSS half of that ruling — the
// permanent underline and the sheets that can defeat it — is guarded in
// text-contrast.test.ts; the numbers that make the underline load-bearing are
// token math, so they are pinned here.

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
