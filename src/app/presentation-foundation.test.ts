import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  AA_BODY_TEXT,
  NON_TEXT_CONTRAST,
  contrastRatio,
  readToken,
  themes,
} from "@/lib/testing/theme-color";

const source = (file: string) =>
  readFileSync(path.join(process.cwd(), file), "utf8");

const GLOBALS = source("src/app/globals.css");
const MARKETING = source("src/app/(marketing)/marketing.css");
const DESIGN = source("DESIGN.md");
const DECISIONS = source("product-docs/decisions.md");

test("the app restores shadcn geometry without flattening intentional pills", () => {
  assert.match(GLOBALS, /--radius:\s*0\.625rem;/);
  assert.match(MARKETING, /\.marketing\s*\{[\s\S]*?--radius:\s*0rem;/);
  assert.match(source("src/components/ui/badge.tsx"), /rounded-full/);
  assert.match(source("src/components/ui/avatar.tsx"), /rounded-full/);
});

test("the app bar roles keep the green-on-ink exception logo-only", () => {
  assert.match(GLOBALS, /--color-app-bar:\s*var\(--app-bar\);/);
  assert.match(
    GLOBALS,
    /--color-app-bar-foreground:\s*var\(--app-bar-foreground\);/
  );
  assert.match(GLOBALS, /--color-app-bar-logo:\s*var\(--app-bar-logo\);/);
  assert.match(GLOBALS, /--app-bar:\s*var\(--ink\);/);
  assert.match(GLOBALS, /--app-bar-foreground:\s*oklch\(0\.985 0 0\);/);
  assert.match(GLOBALS, /--app-bar-logo:\s*var\(--ef\);/);
  assert.match(DESIGN, /24px brand\s+mark is the sole green-on-ink exception/i);
});

for (const theme of themes) {
  test(`the app bar roles remain readable in the ${theme} theme`, () => {
    const bar = readToken(theme, "app-bar");
    assert.ok(
      contrastRatio(readToken(theme, "app-bar-foreground"), bar) >= AA_BODY_TEXT
    );
    assert.ok(
      contrastRatio(readToken(theme, "app-bar-logo"), bar) >= NON_TEXT_CONTRAST
    );
  });
}

test("the app geometry ruling is recorded without changing marketing Sharp", () => {
  assert.match(DESIGN, /Marketing remains\s+Sharp/i);
  assert.match(DESIGN, /authenticated app uses shadcn[^\n]*0\.625rem/i);
  assert.match(DECISIONS, /authenticated app restores shadcn geometry/i);
  assert.match(DECISIONS, /Marketing remains Sharp/i);
});
