import assert from "node:assert/strict";
import { test } from "node:test";

import { PRIORITY_CONFIG } from "./presentation";
import {
  AA_BODY_TEXT,
  composite,
  contrastRatio,
  readPaletteColour,
  readToken,
  themes,
} from "@/lib/testing/theme-color";

test("Task priority labels clear AA in both appearances", () => {
  for (const [priority, config] of Object.entries(PRIORITY_CONFIG)) {
    for (const theme of themes) {
      const classes = config.color.split(" ");
      const prefix = theme === "dark" ? "dark:" : "";
      const foreground = classes.find((name) =>
        name.startsWith(`${prefix}text-`)
      );
      const background = classes.find((name) =>
        name.startsWith(`${prefix}bg-`)
      );
      assert.ok(foreground && background, `${priority} ${theme} needs a pair`);
      const ratio = contrastRatio(
        readPaletteColour(foreground.slice(`${prefix}text-`.length)),
        readPaletteColour(background.slice(`${prefix}bg-`.length))
      );
      assert.ok(
        ratio >= AA_BODY_TEXT,
        `${priority} ${theme}: ${ratio.toFixed(2)}:1`
      );
    }
  }
});

test("Task delete ink clears AA on the outline button's resting and hover backgrounds", () => {
  for (const theme of themes) {
    const card = readToken(theme, "card");
    const grounds =
      theme === "light"
        ? [readToken(theme, "background"), readToken(theme, "accent")]
        : // --input itself is white at 15% opacity. The outline variant uses
          // 30% of that at rest and 50% on hover, over the detail Card.
          [
            composite([1, 1, 1], card, 0.15 * 0.3),
            composite([1, 1, 1], card, 0.15 * 0.5),
          ];
    for (const ground of grounds) {
      const ratio = contrastRatio(readToken(theme, "destructive"), ground);
      assert.ok(
        ratio >= AA_BODY_TEXT,
        `${theme} delete: ${ratio.toFixed(2)}:1`
      );
    }
  }
});
