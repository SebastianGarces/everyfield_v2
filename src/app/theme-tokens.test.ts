import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  AA_BODY_TEXT,
  SURFACES,
  NON_TEXT_CONTRAST,
  type Rgb,
  SC_1_4_1_NON_COLOUR_THRESHOLD,
  SRC,
  composite,
  contrastRatio,
  css,
  declaredTokens,
  declaredValue,
  hexToSrgb,
  isSameColour,
  markupLines,
  oklchToSrgb,
  readPaletteColour,
  readToken,
  readTokenOklch,
  themeBlock,
  themes,
} from "@/lib/testing/theme-color";
import { STATUS_BADGE_CONFIG } from "@/lib/people/status-colors";

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

// --- the design authority, READ from DESIGN.md ------------------------------
//
// The two assertions below are the only mechanism stopping the palette and the
// app from separating, and they are assertions ABOUT DESIGN.md: globals.css
// says so ("If danger has to move it moves in DESIGN.md FIRST"), memory says so
// twice. So they read DESIGN.md.
//
// They used to compare globals.css against two hexes typed into this file, which
// is the #357 defect one level up — a value re-derived by nothing is correct on
// the day it is typed. Edit `danger:` in DESIGN.md and stop there, exactly as
// the instruction says to, and the whole suite stayed green while the design
// authority and the app now disagreed. Three owners for one colour, again.
//
// The parse is asserted before it is used, the way every scan in this suite is:
// a DESIGN.md reformat fails loudly here rather than degrading these two guards
// into no-ops.

const DESIGN_MD = path.join(process.cwd(), "DESIGN.md");

/**
 * DESIGN.md's `colors:` block, as `name -> #rrggbb`.
 *
 * Bounded to that block on purpose. The document repeats the palette lower down
 * in a prose table, and a reader that matched the whole file would answer from
 * whichever copy came first — which is a second owner arriving by another route,
 * the thing this reader exists to prevent. The block ends at the next
 * top-level key (`typography:`), so the bound is the YAML's own structure.
 *
 * Non-hex entries (the `rgba(...)` hairlines) are simply not colours this
 * comparison can make, and are skipped.
 */
function designMdColours(): Map<string, string> {
  const source = readFileSync(DESIGN_MD, "utf8");

  const heading = source.search(/^colors:$/m);
  assert.notEqual(
    heading,
    -1,
    `DESIGN.md has no top-level \`colors:\` block — the design-authority reader has gone vacuous, fix it before trusting a pass (${DESIGN_MD})`
  );

  const body = source.slice(source.indexOf("\n", heading) + 1);
  const nextTopLevelKey = body.search(/^\S/m);
  const block = nextTopLevelKey === -1 ? body : body.slice(0, nextTopLevelKey);

  const colours = new Map(
    [...block.matchAll(/^\s+([\w-]+):\s*"(#[0-9a-fA-F]{6})"/gm)].map(
      (match) => [match[1], match[2].toUpperCase()] as const
    )
  );

  assert.ok(
    colours.size > 10,
    `only ${colours.size} hex colours were read out of DESIGN.md's colors block — the reader has gone vacuous, fix it before trusting a pass`
  );
  return colours;
}

const DESIGN_MD_COLOURS = designMdColours();

/** One published colour, or a loud failure naming the key that vanished. */
function designMdColour(name: string): string {
  const colour = DESIGN_MD_COLOURS.get(name);
  assert.ok(
    colour,
    `DESIGN.md's colors block no longer publishes a hex \`${name}\`. These guards hold globals.css to DESIGN.md, so a renamed key must be renamed here too — never dropped, which would silently unhook the app from the palette`
  );
  return colour;
}

/** DESIGN.md → Colors. The brand ink, and the app's only dark value. */
const DESIGN_MD_INK = designMdColour("ink");

/** DESIGN.md → Colors. `danger` — "errors and 'don't' marks only". */
const DESIGN_MD_DANGER = designMdColour("danger");

test("the identity check reads hue and chroma, not only lightness", () => {
  // The guard that guards the guards. Both DESIGN.md assertions below are the
  // only thing tying globals.css to the design authority, and the first way
  // they were written compared colours with `contrastRatio`, which is relative
  // luminance alone. Under that spelling a MAGENTA passed as the ruled danger
  // red and, at the ink's chroma, so did every hue on the wheel — the guard
  // was load-bearing and inert at the same time.
  const MAGENTA = oklchToSrgb(0.5354, 0.151, 320);
  const WARM_INK = oklchToSrgb(0.224, 0.011, 30);

  assert.ok(
    contrastRatio(MAGENTA, hexToSrgb(DESIGN_MD_DANGER)) < 1.01,
    "the magenta no longer sits within 1.01:1 of danger — this test's story is stale, pick another mutant"
  );
  assert.ok(
    contrastRatio(WARM_INK, hexToSrgb(DESIGN_MD_INK)) < 1.01,
    "the warm ink no longer sits within 1.01:1 of the ink — this test's story is stale"
  );

  assert.equal(
    isSameColour(MAGENTA, hexToSrgb(DESIGN_MD_DANGER)),
    false,
    "a magenta passes as DESIGN.md's danger red — the identity check has gone back to comparing luminance"
  );
  assert.equal(
    isSameColour(WARM_INK, hexToSrgb(DESIGN_MD_INK)),
    false,
    "an off-hue ink passes as DESIGN.md's ink — the identity check has gone back to comparing luminance"
  );

  // ...and it still accepts the two spellings it exists to accept. Derived from
  // the parsed ink rather than typed, so this stays a claim about SPELLING and
  // never becomes a third place the ink's value is written down.
  assert.ok(
    isSameColour(
      hexToSrgb(DESIGN_MD_INK),
      hexToSrgb(DESIGN_MD_INK.toLowerCase())
    )
  );
});

test("the DESIGN.md reader found real colours, not an empty parse", () => {
  // The anti-vacuity check, stated as a test as well as at the read, because
  // every assertion tying globals.css to the design authority is downstream of
  // this parse. `designMdColours()` already throws on a missing block or a
  // near-empty one; this says the two keys those guards name are the two keys
  // that came back, and that they are distinct colours rather than one value
  // read twice.
  assert.match(DESIGN_MD_INK, /^#[0-9A-F]{6}$/);
  assert.match(DESIGN_MD_DANGER, /^#[0-9A-F]{6}$/);
  assert.notEqual(
    DESIGN_MD_INK,
    DESIGN_MD_DANGER,
    "the ink and the danger red read back as the same value — the DESIGN.md reader is matching one entry for both keys"
  );
});

test("--ink is the DESIGN.md ink, and no other token respells it", () => {
  const ink = readToken("light", "ink");
  assert.ok(
    isSameColour(ink, hexToSrgb(DESIGN_MD_INK)),
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
    return isSameColour(colour, ink);
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

test("--destructive is the danger colour DESIGN.md ruled, not a shadcn default", () => {
  assert.ok(
    isSameColour(
      readToken("light", "destructive"),
      hexToSrgb(DESIGN_MD_DANGER)
    ),
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

// --- the destructive button, measured as the PAIR IT RENDERS (#411) ---------
//
// The first version of this test read `--destructive-foreground` against
// `--destructive` and passed — while every Delete button on the site rendered
// `bg-primary text-primary-foreground`, because the call sites hand-painted
// their colour past the variant (see text-contrast.test.ts). Measuring two
// tokens that appear together in a comment proves nothing about a pixel.
//
// So the pair is DERIVED from button.tsx's `destructive` variant, which is the
// only thing that colours a destructive button now that the call sites pass
// `variant`. Change the variant's label or fill and this test changes with it;
// delete the variant and it fails loudly rather than quietly measuring a pair
// nothing paints.

/** The `destructive` variant's class list, read out of button.tsx. */
function destructiveVariantClasses(): string[] {
  const source = readFileSync(
    path.join(SRC, "components", "ui", "button.tsx"),
    "utf8"
  );
  const match = /destructive:\s*\n?\s*"([^"]+)"/.exec(source);
  assert.ok(
    match,
    'button.tsx no longer declares a `destructive:` variant — the destructive dialogs pass `variant="destructive"` and now have no colour'
  );
  return match[1].split(/\s+/);
}

for (const theme of themes) {
  test(`the destructive button paints an AA label on its own fill, in the ${theme} theme`, () => {
    const classes = destructiveVariantClasses();

    // The label. `text-white` is a literal, not a token — read it as one so a
    // move back to `text-destructive-foreground` is measured, not assumed.
    const labelClass = classes.find((c) => /^text-[a-z]/.test(c));
    assert.ok(labelClass, "the destructive variant paints no text colour");
    const label =
      labelClass === "text-white"
        ? hexToSrgb("#ffffff")
        : readToken(theme, labelClass.replace(/^text-/, ""));

    // The fill. Light paints `bg-destructive` solid; dark overrides it with
    // `dark:bg-destructive/60`, which composites over the dialog surface these
    // buttons actually live on.
    const fill = readToken(theme, "destructive");
    const darkAlpha = classes
      .map((c) => /^dark:bg-destructive\/(\d+)$/.exec(c))
      .find(Boolean);
    const ground =
      theme === "dark" && darkAlpha
        ? composite(
            fill,
            readToken(theme, "popover"),
            Number(darkAlpha[1]) / 100
          )
        : fill;

    const ratio = contrastRatio(label, ground);
    assert.ok(
      ratio >= AA_BODY_TEXT,
      `the destructive button's ${labelClass} on its fill in ${theme} is ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1`
    );
  });
}

// --- the person-status badges: off-token fills, measured (#411) -------------
//
// `STATUS_BADGE_CONFIG` paints seven badges with RAW Tailwind palette classes —
// `bg-yellow-500`, `bg-emerald-600` — over the Badge variant's own label token.
// That is the "per-component color override" the Design Tokens invariant
// forbids, and no token value can fix it: the fills are not tokens, so the
// three markup guards next door (destructive tints, attention inks, --ef-dark
// grounds) cannot see them and neither can any assertion over globals.css.
//
// Four of them fail AA on the live preview, worst 1.91:1 (Following Up), which
// Lighthouse reports as the single failing accessibility audit on /people.
// WHICH colours the status scale uses is a design ruling, so the numbers are
// RECORDED here rather than changed — the same treatment `bg-destructive/10`
// got, with the same inverted assertion, so a new status or a palette bump
// fails loudly instead of arriving unmeasured.
//
// The fills are read from Tailwind's own theme.css and the labels from
// badge.tsx, so nothing here is a hex anyone typed.

/** One `badgeVariants` variant's class list, read out of badge.tsx. */
function badgeVariantClasses(variant: string): string[] {
  const source = readFileSync(
    path.join(SRC, "components", "ui", "badge.tsx"),
    "utf8"
  );
  const match = new RegExp(`\\b${variant}:\\s*\\n?\\s*"([^"]+)"`).exec(source);
  assert.ok(
    match,
    `badge.tsx no longer declares a \`${variant}:\` variant — STATUS_BADGE_CONFIG asks for it by name, so the badges have no label colour`
  );
  return match[1].split(/\s+/);
}

/** The unprefixed (no `hover:`, no `[a&]:`) utility with this prefix. */
function baseUtility(classes: string[], prefix: string): string | undefined {
  return classes.find((c) => !c.includes(":") && c.startsWith(prefix));
}

/**
 * The colour a `bg-`/`text-` utility's suffix paints — a Tailwind palette
 * entry (`yellow-500`), a bare keyword (`white`), or one of our own tokens.
 */
function utilityColour(theme: "light" | "dark", suffix: string): Rgb {
  if (suffix === "white") return hexToSrgb("#ffffff");
  if (suffix === "black") return hexToSrgb("#000000");
  if (/^[a-z]+-\d{2,3}$/.test(suffix)) return readPaletteColour(suffix);
  return readToken(theme, suffix);
}

/** Every status badge that paints its OWN fill, with the label over it. */
function statusBadgePairs(
  theme: "light" | "dark"
): { status: string; fill: Rgb; label: Rgb; classes: string }[] {
  return Object.entries(STATUS_BADGE_CONFIG).flatMap(
    ([status, { className, variant }]) => {
      const own = className.split(/\s+/).filter(Boolean);
      const fillClass = baseUtility(own, "bg-");
      // No fill of its own means the token-backed variant paints it, and the
      // token layer's assertions above already cover that pair.
      if (!fillClass) {
        assert.ok(
          !baseUtility(own, "text-"),
          `${status} overrides the badge's label colour without overriding its fill — that pair is measured by nothing`
        );
        return [];
      }

      const labelClass =
        baseUtility(own, "text-") ??
        baseUtility(badgeVariantClasses(variant), "text-");
      assert.ok(labelClass, `the badge \`${variant}\` variant paints no label`);

      return [
        {
          status,
          fill: utilityColour(theme, fillClass.slice("bg-".length)),
          label: utilityColour(theme, labelClass.slice("text-".length)),
          classes: `${fillClass} ${labelClass}`,
        },
      ];
    }
  );
}

/**
 * The DECISION ledger: every status badge whose label does NOT clear AA on its
 * own fill, and the number being accepted. Anything not listed MUST clear AA,
 * so a new status, a palette bump or a variant change fails this file instead
 * of passing quietly.
 *
 * The remedy is a design ruling, not a sweep's call: token-backed status
 * colours, or darker fills chosen from the ruled palette.
 */
const DEFERRED_STATUS_BADGE_FILLS: Record<string, number> = {
  "light following_up": 1.91,
  "light leader": 2.05,
  "light core_group": 3.51,
  "light attendee": 3.6,
  "light interviewed": 3.94,
  "dark following_up": 1.91,
  "dark launch_team": 3.41,
  "dark interviewed": 4.35,
};

test("every person-status badge paints a measured label on its own fill", () => {
  const measured: string[] = [];
  const unexpectedlyPassing: string[] = [];

  for (const theme of themes) {
    for (const { status, fill, label, classes } of statusBadgePairs(theme)) {
      const key = `${theme} ${status}`;
      measured.push(key);
      const ratio = contrastRatio(label, fill);
      const deferred = DEFERRED_STATUS_BADGE_FILLS[key];

      if (deferred === undefined) {
        assert.ok(
          ratio >= AA_BODY_TEXT,
          `${key} (${classes}) is ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1, and no DECISION covers it. Move the fill onto a token that clears AA, or record the number in DEFERRED_STATUS_BADGE_FILLS with a ruling behind it`
        );
        continue;
      }

      assert.ok(
        Math.abs(ratio - deferred) < 0.02,
        `${key} (${classes}) measures ${ratio.toFixed(2)}:1, not the recorded ${deferred}:1 — a fill, a label or the palette moved. Re-record the DECISION with the new number`
      );
      if (ratio >= AA_BODY_TEXT) unexpectedlyPassing.push(key);
    }
  }

  assert.ok(
    measured.length >= 12,
    `only ${measured.length} status-badge pairs were measured; there are twelve (six own-fill statuses across two themes). The scan has gone vacuous — fix it before trusting a pass`
  );

  // The inverted half, as with DEFERRED_DESTRUCTIVE_TINTS: an entry that
  // starts PASSING means the DECISION was resolved somewhere, and leaving it
  // listed would hide the next one.
  assert.deepEqual(
    unexpectedlyPassing,
    [],
    "a status badge recorded as failing now clears AA. Good news — delete its entry from DEFERRED_STATUS_BADGE_FILLS so the ledger only holds what is genuinely still open"
  );
});

// --- the attention scale: WCAG binds, APCA advises (#386 ruling, #411) -------
//
// The inks are TEXT (`text-attention-high-ink` on the tile's label), and the
// globals.css comment used to justify them with APCA alone — which the #386
// ruling makes advisory. They clear AA comfortably, but nothing said so, which
// is the same gap --muted-foreground sat in before #341: a token asserted by a
// comment. The tint the tile paints under them is measured too, because that is
// the ground they are actually read on.

/**
 * Every `text-attention-*-ink` in shipped markup, paired with the tint alphas
 * shipped under the same scale — read out of the tree the way
 * `shippedDestructiveTints()` and `paintedRingAlphas()` are. A hardcoded roll
 * cannot see a THIRD step of the scale, or an existing step gaining a heavier
 * tint, which is the failure mode a list always has.
 */
function shippedAttentionInks(): {
  ink: string;
  tint: string;
  alpha: number;
}[] {
  const inks = new Set<string>();
  const alphas = new Map<string, Set<number>>();

  for (const { line } of markupLines()) {
    for (const match of line.matchAll(/\btext-(attention-[a-z]+-ink)\b/g)) {
      inks.add(match[1]);
    }
    for (const match of line.matchAll(
      /\b(?:dark:)?bg-(attention-[a-z]+)\/(\d+)\b/g
    )) {
      const found = alphas.get(match[1]) ?? new Set<number>();
      found.add(Number(match[2]) / 100);
      alphas.set(match[1], found);
    }
  }

  return [...inks].flatMap((ink) => {
    const tint = ink.replace(/-ink$/, "");
    return [...(alphas.get(tint) ?? new Set([1]))].map((alpha) => ({
      ink,
      tint,
      alpha,
    }));
  });
}

const ATTENTION_INKS = shippedAttentionInks();

test("the attention-ink scan finds the scale it is meant to guard", () => {
  assert.ok(
    ATTENTION_INKS.length >= 2 &&
      new Set(ATTENTION_INKS.map((entry) => entry.ink)).size >= 2,
    `only ${ATTENTION_INKS.length} attention ink/tint pairs were found across ${new Set(ATTENTION_INKS.map((e) => e.ink)).size} inks; the scale ships at least two of each. The scan has gone vacuous — fix it before trusting a pass`
  );
});

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
// The tree had exactly that line: `people/status-timeline.tsx` painted the
// current step's LABEL with it, on the card ground rather than on the tile. It
// was LATENT rather than shipped — the component has no call sites — but the
// guard is deliberately over the whole tree and not over what is mounted,
// because "nothing renders it today" is not a property anyone maintains.
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

// --- globals.css states intent; the tests state the numbers (#357, #411) ----
//
// #357 was one wrong figure in a comment whose whole job was to be right. The
// answer to that is not "write the figures more carefully": a measurement in a
// stylesheet is correct on the day it is typed, is re-checked by nothing, and
// keeps sounding authoritative once the tokens under it have moved — the same
// one-value-several-owners shape the `--ink` alias exists to end, moved from
// the declarations into the prose. A pass that doubled the file's comments to
// ~12 fresh measurements reproduced it exactly.
//
// So the rule is: globals.css says what a token IS and what it is FOR, and
// every measured ratio lives in a test that re-derives it. The only ratios the
// stylesheet may name are the STANDARD's own thresholds, which are constants
// rather than measurements — and they are constants here too, so this guard is
// derived from them rather than from a list.

test("globals.css names no contrast ratio except the standard's thresholds", () => {
  const THRESHOLDS = new Set(
    [AA_BODY_TEXT, NON_TEXT_CONTRAST, SC_1_4_1_NON_COLOUR_THRESHOLD].map(String)
  );

  const named = [...css.matchAll(/(\d+(?:\.\d+)?)\s*:\s*1\b/g)]
    .map((match) => match[1])
    .filter((figure) => !THRESHOLDS.has(figure));

  assert.deepEqual(
    [...new Set(named)],
    [],
    "globals.css names a measured contrast ratio. Nothing re-derives it, so it is free to go stale while still reading as fact (#357). Put the number in the test that measures it and leave the intent here"
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
