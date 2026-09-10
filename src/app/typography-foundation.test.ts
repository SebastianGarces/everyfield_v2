import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const source = (file: string) =>
  readFileSync(path.join(process.cwd(), file), "utf8");
const design = source("DESIGN.md");
const catalog = source("docs/design-catalog.html");
const root = source("src/app/layout.tsx");
const globals = source("src/app/globals.css");
const marketing = source("src/app/(marketing)/marketing.css");

test("design and catalog assign display and working text to the approved families", () => {
  for (const text of [design, catalog]) {
    assert.match(
      text,
      /Bricolage Grotesque[^\n]*[Dd]isplay|[Dd]isplay[^\n]*Bricolage Grotesque/
    );
    assert.match(text, /Instrument Sans[^\n]*[Ww]orking text/);
    assert.match(text, /Outfit[^\n]*(?:\n[^\n]*)?outlined logo/i);
    assert.doesNotMatch(text, /Newsreader|DM Sans|Geist Sans/);
  }
  for (const role of ["display", "heading", "stat-numeral", "title"]) {
    assert.match(
      design,
      new RegExp(`${role}:\\s*\\n\\s*fontFamily: Bricolage Grotesque`)
    );
  }
  for (const role of ["lead", "marketing-body", "body", "caption", "label"]) {
    assert.match(
      design,
      new RegExp(`${role}:\\s*\\n\\s*fontFamily: Instrument Sans`)
    );
  }
  assert.match(catalog, /--display: "Bricolage Grotesque"/);
  assert.match(catalog, /--sans: "Instrument Sans"/);
  assert.doesNotMatch(
    catalog,
    /family=(?:Outfit|Newsreader|DM\+Sans|Geist(?:&|:))/
  );
});

test("the root and utility defaults share Instrument Sans, including italic working text", () => {
  assert.match(root, /Instrument_Sans\(\{/);
  assert.match(root, /style: \["normal", "italic"\]/);
  // Tailwind resolves its default on html. Defining only the variable on body
  // leaves root defaults unresolved, even though marketing can read it below.
  const html = root.match(/<html\b[\s\S]*?>/)?.[0];
  assert.ok(html);
  assert.match(html, /instrumentSans\.variable/);
  assert.match(html, /instrumentSans\.className/);
  assert.match(globals, /--font-sans: var\(--font-instrument-sans\)/);
  assert.match(marketing, /--display: var\(--font-bricolage-grotesque\)/);
  assert.match(marketing, /--sans: var\(--font-instrument-sans\)/);
  assert.doesNotMatch(marketing, /--serif/);
});

test("active app typography cannot load a retired proportional font", () => {
  const files = readdirSync("src", { recursive: true, withFileTypes: true });
  for (const file of files) {
    if (
      !file.isFile() ||
      !/\.(?:tsx?|css)$/.test(file.name) ||
      /\.test\./.test(file.name)
    )
      continue;
    const filename = path.join(file.parentPath, file.name);
    // PDF and email faces are explicitly outside the web type system.
    if (
      filename.startsWith("src/lib/email/") ||
      filename.startsWith("src/components/wiki/article-pdf/")
    )
      continue;
    assert.doesNotMatch(
      readFileSync(filename, "utf8"),
      /\b(?:Outfit|Newsreader|DM_Sans)\b|DM Sans|Geist Sans|font-geist-sans|\bGeist\s*[,({]/,
      filename
    );
  }
});

test("the approved outlined logo is byte-for-byte unchanged", () => {
  assert.equal(
    createHash("sha256")
      .update(source("src/components/logo.tsx"))
      .digest("hex"),
    "859352170db13e5d79cb560be94589041e4ef1276221c4c7d30577dc5f23fa42"
  );
});
