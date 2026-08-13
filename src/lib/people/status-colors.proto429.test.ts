import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  AA_BODY_TEXT,
  SRC,
  contrastRatio,
  hexToSrgb,
  readPaletteColour,
  readToken,
  type Rgb,
  themes,
} from "@/lib/testing/theme-color";
import { STATUS_BADGE_CONFIG } from "@/lib/people/status-colors";
import {
  PROTO_429_BADGE_CLASSES,
  PROTO_429_DOT_CLASSES,
  PROTO_429_OPTIONS,
} from "@/lib/people/status-colors.proto429";
import { STATUS_ORDER } from "@/lib/people/status.shared";
import type { PersonStatus } from "@/lib/people/types";

// ----------------------------------------------------------------------------
// PROTOTYPE ONLY — never merge. Delete with the rest of the #429 scaffolding
// once the ruling lands.
//
// The brief for the ruling is "every candidate clears AA 4.5:1 in BOTH themes",
// and the way that claim goes stale is the way #357 went stale: a number typed
// into a PR body, re-derived by nothing. So the ratios are computed HERE, from
// the same class strings the browser paints, resolved through the same
// `theme-color` math the shipped suites use — Tailwind's own theme.css for the
// palette steps, globals.css for the tokens, badge.tsx for the variant a status
// falls back to.
//
// `current` is measured too and deliberately NOT asserted: it is the failing
// baseline, and `DEFERRED_STATUS_BADGE_FILLS` in `src/app/theme-tokens.test.ts`
// already holds it to its exact numbers. Asserting it here would be a second
// owner for one measurement.
// ----------------------------------------------------------------------------

/** One `badgeVariants` variant's class list, read out of badge.tsx. */
function badgeVariantClasses(variant: string): string[] {
  const source = readFileSync(
    path.join(SRC, "components", "ui", "badge.tsx"),
    "utf8"
  );
  const match = new RegExp(`\\b${variant}:\\s*\\n?\\s*"([^"]+)"`).exec(source);
  assert.ok(match, `badge.tsx no longer declares a \`${variant}:\` variant`);
  return match[1].split(/\s+/);
}

/**
 * The colour a `bg-`/`text-` suffix paints: a Tailwind palette entry
 * (`blue-600`), a bare keyword, or one of our own tokens.
 */
function utilityColour(theme: "light" | "dark", suffix: string): Rgb {
  if (suffix === "white") return hexToSrgb("#ffffff");
  if (suffix === "black") return hexToSrgb("#000000");
  if (/^[a-z]+-\d{2,3}$/.test(suffix)) return readPaletteColour(suffix);
  return readToken(theme, suffix);
}

/**
 * The prototype classes an option contributes, in cascade order: the
 * theme-independent ones first, then — in the dark theme only — the
 * `.dark`-qualified ones, which carry higher specificity and therefore win.
 * That is the browser's own resolution order, written out.
 */
function optionUtilities(
  status: PersonStatus,
  option: string,
  theme: "light" | "dark"
): string[] {
  const CLASS =
    /^\[\[data-proto-429=(\w+)\](\.dark)?_&\]:((?:bg|text|border)-[\w-]+)$/;

  const parsed = PROTO_429_BADGE_CLASSES[status]
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const match = CLASS.exec(raw);
      assert.ok(
        match,
        `\`${raw}\` (${status}) is not a recognised prototype variant class. Every entry must be [[data-proto-429=<id>]<.dark>_&]:<utility> — anything else emits CSS this measurement cannot see`
      );
      return {
        option: match[1],
        dark: match[2] !== undefined,
        utility: match[3],
      };
    });

  assert.ok(
    parsed.every((entry) =>
      (PROTO_429_OPTIONS as readonly string[]).includes(entry.option)
    ),
    `${status} names an option id the switcher does not offer — those classes would be dead CSS`
  );

  return [
    ...parsed.filter((e) => e.option === option && !e.dark),
    ...(theme === "dark"
      ? parsed.filter((e) => e.option === option && e.dark)
      : []),
  ].map((e) => e.utility);
}

/** The last utility with this prefix wins, as the cascade decides it. */
function lastWithPrefix(classes: string[], prefix: string): string | undefined {
  return classes.filter((c) => c.startsWith(prefix)).at(-1);
}

/** What a badge actually paints, for one status under one option and theme. */
function paintedPair(
  status: PersonStatus,
  option: string,
  theme: "light" | "dark"
): { fill: Rgb; label: Rgb; classes: string } {
  const config = STATUS_BADGE_CONFIG[status];

  // The stack, weakest first: the badge variant, the shipped per-status
  // override, then the prototype's own classes.
  const stack = [
    ...badgeVariantClasses(config.variant).filter((c) => !c.includes(":")),
    ...config.className.split(/\s+/).filter((c) => c && !c.includes(":")),
    ...optionUtilities(status, option, theme),
  ];

  const fillClass = lastWithPrefix(stack, "bg-");
  const labelClass = lastWithPrefix(stack, "text-");
  assert.ok(fillClass && labelClass, `${status}/${option} paints no pair`);

  return {
    fill: utilityColour(theme, fillClass.slice("bg-".length)),
    label: utilityColour(theme, labelClass.slice("text-".length)),
    classes: `${fillClass} ${labelClass}`,
  };
}

test("the resolver reads the real class strings, not an empty parse", () => {
  // The anti-vacuity guard. Every assertion below is downstream of the parse,
  // and a regex that matched nothing would make all of them pass in silence.
  assert.deepEqual(
    STATUS_ORDER.length,
    Object.keys(PROTO_429_BADGE_CLASSES).length,
    "the prototype does not cover every status in STATUS_ORDER"
  );

  for (const option of ["a", "b", "c", "d"]) {
    const covered = STATUS_ORDER.filter(
      (status) => optionUtilities(status, option, "light").length > 0
    );
    assert.ok(
      covered.length >= 6,
      `option ${option} contributes classes for only ${covered.length} statuses — a half-built option biases the ruling toward whichever one was finished`
    );
  }

  // `current` must contribute NOTHING, or the baseline is not the baseline.
  for (const status of STATUS_ORDER) {
    assert.deepEqual(
      optionUtilities(status, "current", "dark"),
      [],
      `the "current" option paints ${status} — it exists to be today's palette untouched`
    );
  }
});

for (const option of ["a", "b", "c", "d"]) {
  for (const theme of themes) {
    test(`option ${option} clears AA body text on every status in the ${theme} theme`, () => {
      for (const status of STATUS_ORDER) {
        const { fill, label, classes } = paintedPair(status, option, theme);
        const ratio = contrastRatio(label, fill);
        assert.ok(
          ratio >= AA_BODY_TEXT,
          `${option}/${theme}/${status} (${classes}) is ${ratio.toFixed(2)}:1, below ${AA_BODY_TEXT}:1 — an option that fails is an option the reviewer cannot choose`
        );
      }
    });
  }
}

test("option C's dot is a colour the eye can find on the neutral badge", () => {
  // The dot carries no meaning the label does not already carry (it is
  // aria-hidden, and the status is a word beside it), so SC 1.4.11 is not
  // engaged. 3:1 is held anyway: a mark nobody can see is not an accent, it is
  // decoration that looks like an accent.
  const DOT = /^\[\[data-proto-429=c\](\.dark)?_&\]:(bg-[\w-]+)$/;

  for (const theme of themes) {
    const surface = readToken(theme, "secondary");
    for (const status of STATUS_ORDER) {
      const parsed = PROTO_429_DOT_CLASSES[status]
        .split(/\s+/)
        .filter(Boolean)
        .map((raw) => {
          const match = DOT.exec(raw);
          assert.ok(match, `\`${raw}\` (${status}) is not a dot variant class`);
          return { dark: match[1] !== undefined, utility: match[2] };
        });

      const applied = [
        ...parsed.filter((e) => !e.dark),
        ...(theme === "dark" ? parsed.filter((e) => e.dark) : []),
      ].at(-1);
      assert.ok(applied, `${status} has no dot colour in the ${theme} theme`);

      const ratio = contrastRatio(
        utilityColour(theme, applied.utility.slice("bg-".length)),
        surface
      );
      assert.ok(
        ratio >= 3,
        `the ${status} dot (${applied.utility}) is ${ratio.toFixed(2)}:1 on the ${theme} badge surface`
      );
    }
  }
});

test("the measured table, for the PR body", () => {
  // Not an assertion — the report. Printing it from the code that resolves the
  // classes is what stops the PR's numbers and the branch's numbers from being
  // two different things.
  const rows: string[] = [];
  for (const option of PROTO_429_OPTIONS) {
    for (const theme of themes) {
      const measured = STATUS_ORDER.map((status) => ({
        status,
        ratio: contrastRatio(
          ...([
            paintedPair(status, option, theme).label,
            paintedPair(status, option, theme).fill,
          ] as const)
        ),
      }));
      const worst = measured.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
      rows.push(
        `${option}\t${theme}\tworst ${worst.ratio.toFixed(2)}:1 (${worst.status})\t` +
          measured.map((m) => `${m.status} ${m.ratio.toFixed(2)}`).join(" · ")
      );
    }
  }
  console.log("\n[#429 PROTOTYPE TABLE]\n" + rows.join("\n") + "\n");
});
