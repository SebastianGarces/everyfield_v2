import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { STATUS_BADGE_CONFIG } from "@/lib/people/status-colors";
import { STATUS_LABELS } from "@/lib/people/status.shared";
import {
  AA_BODY_TEXT,
  type Rgb,
  SRC,
  contrastRatio,
  hexToSrgb,
  isSameColour,
  readPaletteColour,
  readToken,
  relativeLuminance,
  themes,
} from "@/lib/testing/theme-color";

// ----------------------------------------------------------------------------
// The person-status badge scale, and only it. A fourth sibling to
// theme-tokens.test.ts (token identity and token-on-surface contrast),
// focus-ring.test.ts (the focus indicator, SC 1.4.11 rather than AA) and
// text-contrast.test.ts (what SHIPS: .tsx markup and the other stylesheets),
// over the same colour math in `@/lib/testing/theme-color`.
//
// It is its own suite because it asks about a different subject with a
// different source of truth: the other three resolve colours from
// src/app/globals.css and DESIGN.md, this one resolves them from Tailwind's
// own palette (`node_modules/tailwindcss/theme.css`) and from badge.tsx, and it
// carries rules the token layer has no vocabulary for — six classes per status,
// one hue family, the light/dark mirror, two named ruling exceptions. It is
// also the only suite in the set that reads the people domain
// (`STATUS_BADGE_CONFIG`, `STATUS_LABELS`), which is what a token suite has no
// business importing.
// ----------------------------------------------------------------------------

// --- the ruled tinted scale, measured (#429) --------------------------------
//
// `STATUS_BADGE_CONFIG` paints the /people badges with RAW Tailwind palette
// classes rather than tokens, so nothing in globals.css can say what they paint
// and none of the three markup guards next door (destructive tints, attention
// inks, --ef-dark grounds) can see them. That is exactly how the scale this one
// replaced shipped a 1.91:1 label — `bg-yellow-500` under `text-white`, eight of
// its twelve pairs below AA, found in a browser rather than by any suite here.
//
// #429 ruled the replacement: direction B, "tinted editorial" — a pale ground,
// deep ink and hairline border of ONE hue per status, mirrored in the dark
// theme. The deferral ledger that carried the old numbers (
// `DEFERRED_STATUS_BADGE_FILLS`) is GONE with the residual it recorded: every
// status/theme pair now owes AA outright, and there is no list to add to. Do not
// re-introduce one — a scale that cannot clear 4.5:1 is a ruling to reopen, not
// an entry to write.
//
// Nothing below is a number anyone typed. The grounds, inks and borders are read
// from Tailwind's own `theme.css`, the neutral fallback from `badge.tsx`'s own
// variant, and the ratios are computed here.

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

/**
 * The utility with `prefix` that actually WINS in `theme` — `dark:bg-blue-950`
 * in the dark theme, `bg-blue-50` in the light one, and the base class in the
 * dark theme when no `dark:` twin exists (the cascade inherits it, which is the
 * `--ef-dark` trap one layer out).
 *
 * Any other modifier is skipped rather than measured: `[a&]:hover:bg-primary/90`
 * paints a state this badge never enters, and reading it as the resting fill
 * would measure a pair nothing renders.
 */
function themedUtility(
  classes: string[],
  prefix: string,
  theme: "light" | "dark"
): string | undefined {
  const base = classes.find((c) => !c.includes(":") && c.startsWith(prefix));
  if (theme === "light") return base;

  const darkTwin = classes.find(
    (c) =>
      c.startsWith(`dark:${prefix}`) && !c.slice("dark:".length).includes(":")
  );
  return darkTwin ? darkTwin.slice("dark:".length) : base;
}

/**
 * The colour a `bg-`/`text-`/`border-` utility's suffix paints — a Tailwind
 * palette entry (`yellow-500`), a bare keyword (`white`), or one of our own
 * tokens.
 */
function utilityColour(theme: "light" | "dark", suffix: string): Rgb {
  if (suffix === "white") return hexToSrgb("#ffffff");
  if (suffix === "black") return hexToSrgb("#000000");
  if (/^[a-z]+-\d{2,3}$/.test(suffix)) return readPaletteColour(suffix);
  return readToken(theme, suffix);
}

type StatusBadgePaint = {
  status: string;
  ground: Rgb;
  ink: Rgb;
  border: Rgb | null;
  classes: string;
};

/**
 * What every status badge PAINTS in `theme`: its own classes first, and the
 * Badge variant it names for anything it leaves to the token layer (Prospect,
 * which the ruling keeps neutral, colours nothing itself).
 */
function statusBadgePaint(theme: "light" | "dark"): StatusBadgePaint[] {
  return Object.entries(STATUS_BADGE_CONFIG).map(
    ([status, { className, variant }]) => {
      const own = className.split(/\s+/).filter(Boolean);
      const fromVariant = badgeVariantClasses(variant);

      const groundClass =
        themedUtility(own, "bg-", theme) ??
        themedUtility(fromVariant, "bg-", theme);
      const inkClass =
        themedUtility(own, "text-", theme) ??
        themedUtility(fromVariant, "text-", theme);

      assert.ok(
        groundClass,
        `${status} has no ground in the ${theme} theme — neither its own classes nor the \`${variant}\` badge variant paint a bg-, so its label is read on whatever is behind it`
      );
      assert.ok(
        inkClass,
        `${status} has no label colour in the ${theme} theme — neither its own classes nor the \`${variant}\` badge variant paint a text-`
      );

      const borderClass = themedUtility(own, "border-", theme);

      return {
        status,
        ground: utilityColour(theme, groundClass.slice("bg-".length)),
        ink: utilityColour(theme, inkClass.slice("text-".length)),
        border: borderClass
          ? utilityColour(theme, borderClass.slice("border-".length))
          : null,
        classes: [groundClass, inkClass, borderClass].filter(Boolean).join(" "),
      };
    }
  );
}

test("every person-status badge reads its label at AA, in both themes", () => {
  const measured: string[] = [];

  for (const theme of themes) {
    for (const { status, ground, ink, classes } of statusBadgePaint(theme)) {
      measured.push(`${theme} ${status}`);
      const ratio = contrastRatio(ink, ground);
      assert.ok(
        ratio >= AA_BODY_TEXT,
        `${theme} ${status} (${classes}) is ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1. #429 ruled a scale that clears AA on every pair — deepen the ink or lighten the ground on the SAME hue; do not re-open a deferral ledger`
      );
    }
  }

  // Anti-vacuity, and it has to be pinned against something OTHER than the
  // object the loop just walked: counting `STATUS_BADGE_CONFIG`'s own keys
  // would be a tautology — `statusBadgePaint` is a total map over that object,
  // so the equality would hold for seven statuses, three, or none, and report
  // "0 of 0" as a pass. Both floors below are external to it:
  //   · the ABSOLUTE fourteen — seven statuses across two themes, Prospect
  //     included now that its neutral variant is resolved rather than skipped.
  //     memory/invariants.md and product-docs/decisions.md both cite that
  //     number, so it is asserted here rather than narrated there.
  //   · `STATUS_LABELS` (`status.shared.ts`), the domain's one status map — so
  //     a status that gains a label but no badge fails here too.
  assert.ok(
    measured.length >= 14,
    `only ${measured.length} status/theme pairs were measured, short of the fourteen #429 ruled. The scan has gone vacuous — fix it before trusting a pass`
  );
  const expected = Object.keys(STATUS_LABELS).length * themes.length;
  assert.equal(
    measured.length,
    expected,
    `${measured.length} status/theme pairs were measured, not the ${expected} that STATUS_LABELS × ${themes.length} themes requires — every status in the domain owes a badge in both themes. The scan has gone vacuous — fix it before trusting a pass`
  );
});

/** A `bg-blue-50` / `dark:text-amber-200` class split into its parts. */
function paletteClass(utility: string): {
  theme: "light" | "dark";
  role: string;
  family: string;
  step: number;
} {
  const match =
    /^(dark:)?(bg|text|border)-([a-z]+)-(\d{2,3})$/.exec(utility) ?? null;
  assert.ok(
    match,
    `\`${utility}\` is not a themed palette utility. #429's scale is spelled out one class per role per theme, because Tailwind scans source TEXT — a class assembled at runtime emits no CSS at all`
  );
  return {
    theme: match[1] ? "dark" : "light",
    role: match[2],
    family: match[3],
    step: Number(match[4]),
  };
}

/** The statuses that carry a hue, i.e. everything the ruling did not keep neutral. */
function tintedStatuses(): [string, string[]][] {
  return Object.entries(STATUS_BADGE_CONFIG)
    .map(
      ([status, { className }]) =>
        [status, className.split(/\s+/).filter(Boolean)] as [string, string[]]
    )
    .filter(([, classes]) => classes.length > 0);
}

test("each tinted status paints one hue three ways, mirrored in the dark theme", () => {
  const tinted = tintedStatuses();
  assert.ok(
    tinted.length >= 6,
    `only ${tinted.length} statuses carry a tint; #429's scale colours six of the seven. The scan has gone vacuous — fix it before trusting a pass`
  );

  for (const [status, classes] of tinted) {
    const parts = classes.map(paletteClass);

    // Six classes: ground, ink and border, once per theme. A missing dark twin
    // inherits the light value, which is how ink lands on ink.
    const declared = parts.map((p) => `${p.theme} ${p.role}`).sort();
    assert.deepEqual(
      declared,
      [
        "dark bg",
        "dark border",
        "dark text",
        "light bg",
        "light border",
        "light text",
      ],
      `${status} does not spell all six of #429's classes (${classes.join(" ")}). Direction B is a ground, an ink AND a hairline border, stated in both themes`
    );

    const families = [...new Set(parts.map((p) => p.family))];
    assert.deepEqual(
      families.length,
      1,
      `${status} mixes hues (${families.join(", ")}). Direction B tints ONE hue three ways — the ground, the ink and the border are the same colour at different weights`
    );

    // The mirror, measured rather than asserted off the step numbers: pale
    // ground under deep ink in the light theme, and the other way round in the
    // dark one. A dark theme that forgot to invert is the failure that shipped
    // `text-ef-dark` onto a dark card.
    const paint = {
      light: statusBadgePaint("light").find((p) => p.status === status)!,
      dark: statusBadgePaint("dark").find((p) => p.status === status)!,
    };
    assert.ok(
      relativeLuminance(paint.light.ground) >
        relativeLuminance(paint.light.ink),
      `${status} is not the ruled tint in the light theme: its ground is no lighter than its ink (${paint.light.classes})`
    );
    assert.ok(
      relativeLuminance(paint.dark.ground) < relativeLuminance(paint.dark.ink),
      `${status} does not mirror in the dark theme: its ground is no darker than its ink (${paint.dark.classes}). The dark theme inverts the pair, it does not re-use the light one`
    );
    assert.ok(
      relativeLuminance(paint.light.ground) >
        relativeLuminance(paint.dark.ground),
      `${status} paints a dark ground that is no darker than its light one (${paint.light.classes} / ${paint.dark.classes})`
    );

    assert.ok(
      paint.light.border && paint.dark.border,
      `${status} loses its hairline border in one theme (${paint.light.classes} / ${paint.dark.classes})`
    );
  }
});

test("the #429 ruling's two named exceptions still hold", () => {
  // Prospect stays neutral — ruled, not overlooked. It is the pipeline's zero,
  // so it carries the token-backed variant and paints nothing of its own.
  assert.equal(
    STATUS_BADGE_CONFIG.prospect.className,
    "",
    "Prospect paints a colour of its own. #429 ruled it stays neutral — give it a tint and the scale loses the rung that means 'no colour yet'"
  );
  assert.equal(
    STATUS_BADGE_CONFIG.prospect.variant,
    "secondary",
    "Prospect no longer carries the `secondary` variant, so the one status the ruling keeps token-backed now paints something else"
  );

  // Attendee and Launch Team stay on ONE hue and separate by TINT LEVEL. The
  // ruling was offered the hue split and declined it, so splitting them is a
  // new ruling rather than a commit.
  const hueOf = (status: "attendee" | "launch_team") => {
    const families = STATUS_BADGE_CONFIG[status].className
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => paletteClass(c).family);
    return families[0];
  };
  assert.equal(
    hueOf("attendee"),
    hueOf("launch_team"),
    "Attendee and Launch Team no longer share a hue. #429 considered splitting them and ruled they separate by TINT LEVEL instead — reopen the ruling, do not re-hue them here"
  );

  for (const theme of themes) {
    const paint = statusBadgePaint(theme);
    const attendee = paint.find((p) => p.status === "attendee")!;
    const launchTeam = paint.find((p) => p.status === "launch_team")!;
    assert.ok(
      !isSameColour(attendee.ground, launchTeam.ground),
      `Attendee and Launch Team paint the same ground in the ${theme} theme (${attendee.classes}). They share a hue by ruling, so the TINT LEVEL is the only thing telling them apart`
    );
  }
});
