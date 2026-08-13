import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NON_TEXT_CONTRAST,
  SURFACES,
  composite,
  contrastRatio,
  markupLines,
  oklchToSrgb,
  readToken,
  themes,
} from "./theme-color";

// ----------------------------------------------------------------------------
// The focus indicator, and only it. Split out of theme-tokens.test.ts because
// it answers a different question with a different standard: the rest of the
// token layer is TEXT owing WCAG AA 4.5:1, this is a 3px outline owing SC
// 1.4.11's 3:1 — and it is the one part of the layer whose verdict depends on
// what the components paint (the alpha), not only on what globals.css declares.
// ----------------------------------------------------------------------------

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
//
// A ring is painted OUTSIDE the control's box, so the colour it must contrast
// with is the ground BEHIND the control — the same eight surfaces every other
// token is measured on, never the control's own fill.

/** The grounds --sidebar-ring can land on: the sidebar's own share of the set. */
const SIDEBAR_RING_SURFACES = SURFACES.filter((surface) =>
  surface.startsWith("sidebar")
);

/**
 * The alpha the ring is ACTUALLY painted at, read out of the shipped markup.
 * Hard-coding 0.5 here would let a component introduce `ring-ring/30` and keep
 * this file green while the ring it describes goes invisible, so the worst
 * (lowest) alpha in the tree is what gets measured.
 */
function paintedRingAlphas(): { where: string; alpha: number }[] {
  return markupLines().flatMap(({ where, line }) =>
    [...line.matchAll(/\bring-ring(?:\/(\d+))?\b/g)].map((match) => ({
      where,
      alpha: match[1] === undefined ? 1 : Number(match[1]) / 100,
    }))
  );
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
  for (const surface of SURFACES) {
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
  return markupLines().flatMap(({ where, line }) =>
    [
      ...line.matchAll(/(dark:)?focus-visible:ring-destructive(?:\/(\d+))?\b/g),
    ].map((match) => ({
      where,
      dark: match[1] !== undefined,
      alpha: match[2] === undefined ? 1 : Number(match[2]) / 100,
    }))
  );
}

test("every destructive focus-ring override is visible too", () => {
  // Zero sites is a legitimate state: it means everything inherits --ring,
  // which the cases above already measure.
  for (const { where, dark, alpha } of paintedDestructiveRings()) {
    const themesForRule = dark ? (["dark"] as const) : themes;

    for (const theme of themesForRule) {
      for (const surface of SURFACES) {
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
