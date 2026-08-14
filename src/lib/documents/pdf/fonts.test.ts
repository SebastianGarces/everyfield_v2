import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { inflateSync } from "node:zlib";

import { createElement } from "react";

import {
  PDF_FACES,
  PDF_FONT,
  PDF_FONT_BASE_PATH,
  registerPdfFonts,
  type PdfFontRegistry,
} from "./fonts";

// ----------------------------------------------------------------------------
// The faces every generated PDF is set in (#398).
//
// The defect this closes was invisible in the SOURCE and invisible on the
// SCREEN: `@react-pdf/renderer`'s standard-14 fonts carry WinAnsi encoding
// only, and a character outside it is written with the wrong glyph rather than
// refused. So the assertions here are made against the RENDERED FILE — the
// bytes a reader's PDF viewer reads — and never against a style object.
//
// Two readings prove it, and the pair is the point:
//
//   `toUnicodeCodePoints`  what the file SAYS its text is. An embedded subset
//                          font writes glyph ids, so the file carries a
//                          ToUnicode CMap mapping them back to code points.
//                          That map is the only place a downstream reader —
//                          copy-paste, search, a screen reader — can learn that
//                          glyph 3 is `→`.
//   `shownBytes`           what the file actually DRAWS. Under a standard-14
//                          face there is no ToUnicode at all: the text is
//                          written as WinAnsi bytes, and this is what shows
//                          `→` leaving as 0x92 (`’`) and `─` as NUL.
//
// The second reading is kept even though the bug is fixed, because a claim
// about an encoding needs the failing case to stay legible: without it, the
// first reading only says "these code points are present" and nobody can tell
// what it saved us from.
//
// Font COVERAGE is read straight out of the TTF `cmap` instead, so the one gap
// the shipped subset does not close (see the bottom of this file) is a fact the
// suite holds rather than a sentence in `public/fonts/README.md`.
// ----------------------------------------------------------------------------

const FONT_DIRECTORY = path.join(process.cwd(), "public", "fonts");

/** The characters #398 is about — every one of them outside WinAnsi. */
const OUTSIDE_WINANSI = {
  "→": 0x2192,
  "↓": 0x2193,
  "✓": 0x2713,
  "✗": 0x2717,
  "─": 0x2500,
  "│": 0x2502,
  "┌": 0x250c,
  "┘": 0x2518,
};

/** …and the ones INSIDE it, which is why the bug was easy to miss. */
const INSIDE_WINANSI = { "—": 0x2014, "…": 0x2026, "•": 0x2022, "’": 0x2019 };

// --- reading a PDF ----------------------------------------------------------

/** Every deflate stream in `pdf`, inflated. Non-deflate streams are skipped. */
function inflatedStreams(pdf: Buffer): string[] {
  const raw = pdf.toString("latin1");
  const streams: string[] = [];
  const marker = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    try {
      streams.push(
        inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString(
          "latin1"
        )
      );
    } catch {
      // An embedded font file or an image — not our business here.
    }
  }
  return streams;
}

/** Every code point the file's ToUnicode CMaps claim to carry. */
function toUnicodeCodePoints(pdf: Buffer): Set<number> {
  const found = new Set<number>();
  for (const stream of inflatedStreams(pdf)) {
    if (!stream.includes("beginbfchar")) continue;
    for (const [, target] of stream.matchAll(
      /<[0-9a-f]{4}>\s*<([0-9a-f]{4,})>/gi
    )) {
      // A bfchar target may be a UTF-16BE string; the first unit is enough for
      // everything in this corpus.
      found.add(parseInt(target.slice(0, 4), 16));
    }
  }
  return found;
}

/** The bytes the page's text-showing operators actually draw. */
function shownBytes(pdf: Buffer): Buffer {
  const content = inflatedStreams(pdf).find(
    (stream) => stream.includes("BT") && stream.includes("Tf")
  );
  assert.ok(content, "the PDF has no text content stream");

  const shown = content.slice(content.indexOf("BT"), content.indexOf("ET"));
  const hex = [...shown.matchAll(/<([0-9a-f]*)>/gi)]
    .map(([, digits]) => digits)
    .join("");
  return Buffer.from(hex, "hex");
}

// --- reading a TTF ----------------------------------------------------------

/**
 * The code points a TTF maps to a real glyph, from its `cmap` format-4
 * subtable.
 *
 * Written out rather than pulled from `fontkit`: fontkit is a TRANSITIVE
 * dependency of `@react-pdf/renderer`, so importing it here would be a phantom
 * dependency that breaks the moment the renderer's tree changes.
 */
function mappedCodePoints(file: string): Set<number> {
  const font = readFileSync(path.join(FONT_DIRECTORY, file));

  let cmap = -1;
  for (let i = 0; i < font.readUInt16BE(4); i += 1) {
    const entry = 12 + i * 16;
    if (font.toString("latin1", entry, entry + 4) === "cmap") {
      cmap = font.readUInt32BE(entry + 8);
    }
  }
  assert.notEqual(cmap, -1, `${file} has no cmap table`);

  let subtable = -1;
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i += 1) {
    const record = cmap + 4 + i * 8;
    const offset = cmap + font.readUInt32BE(record + 4);
    if (font.readUInt16BE(offset) === 4) subtable = offset;
  }
  assert.notEqual(subtable, -1, `${file} has no format-4 cmap subtable`);

  const segments = font.readUInt16BE(subtable + 6) / 2;
  const endCodes = subtable + 14;
  const startCodes = endCodes + segments * 2 + 2;
  const idDeltas = startCodes + segments * 2;
  const idRangeOffsets = idDeltas + segments * 2;

  const mapped = new Set<number>();
  for (let segment = 0; segment < segments; segment += 1) {
    const end = font.readUInt16BE(endCodes + segment * 2);
    const start = font.readUInt16BE(startCodes + segment * 2);
    const delta = font.readInt16BE(idDeltas + segment * 2);
    const rangeOffset = font.readUInt16BE(idRangeOffsets + segment * 2);

    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const at =
          idRangeOffsets + segment * 2 + rangeOffset + (code - start) * 2;
        glyph = font.readUInt16BE(at);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) mapped.add(code);
    }
  }
  return mapped;
}

// --- rendering --------------------------------------------------------------

const SAMPLE = "A → B ↓ ✓ ✗ ─ │ ┌ ┘ — … • ’";

/** One page of `SAMPLE`, set in `fontFamily`, as a real PDF. */
async function renderSample(fontFamily: string): Promise<Buffer> {
  const { Document, Font, Page, Text, renderToBuffer } =
    await import("@react-pdf/renderer");
  await registerPdfFonts(Font, (file) =>
    readFileAsync(path.join(FONT_DIRECTORY, file))
  );

  return renderToBuffer(
    createElement(
      Document,
      null,
      createElement(
        Page,
        { size: "LETTER" },
        createElement(Text, { style: { fontFamily, fontSize: 12 } }, SAMPLE)
      )
    )
  );
}

// --- the fix ----------------------------------------------------------------

describe("the downloaded PDF, read as a file", () => {
  test("carries every character the printed page does, in the body face", async () => {
    const codePoints = toUnicodeCodePoints(await renderSample(PDF_FONT.body));

    for (const [character, codePoint] of Object.entries({
      ...OUTSIDE_WINANSI,
      ...INSIDE_WINANSI,
    })) {
      assert.ok(
        codePoints.has(codePoint),
        `${character} (U+${codePoint.toString(16).toUpperCase()}) is not in the file`
      );
    }
  });

  test("carries them in the mono face too — a code block is an arrow diagram", async () => {
    // `/wiki/getting-started/launch-process-goals` is the article that made
    // this visible: its code block is drawn with arrows and box rules.
    const codePoints = toUnicodeCodePoints(await renderSample(PDF_FONT.mono));

    for (const [character, codePoint] of Object.entries(OUTSIDE_WINANSI)) {
      assert.ok(codePoints.has(codePoint), `${character} is not in the file`);
    }
  });

  test("the standard-14 faces it replaced write the WRONG glyph, silently", async () => {
    // The defect, kept legible. Helvetica is a WinAnsi-encoded standard font,
    // so the text is written as single WinAnsi bytes with no ToUnicode map at
    // all — nothing in the file even claims these characters are present.
    const pdf = await renderSample("Helvetica");

    assert.equal(
      toUnicodeCodePoints(pdf).size,
      0,
      "a standard-14 page carries no ToUnicode map to be wrong about"
    );

    const drawn = shownBytes(pdf);
    // The mapping is positional in `SAMPLE`: byte 2 is the arrow, byte 6 the
    // down arrow, byte 8 the check mark, byte 12 the box rule.
    assert.equal(drawn[2], 0x92, "→ used to leave as ’");
    assert.equal(drawn[6], 0x93, "↓ used to leave as “");
    assert.equal(drawn[8], 0x13, "✓ used to leave as a control byte");
    assert.equal(drawn[12], 0x00, "─ used to leave as NUL");

    // …while the characters INSIDE WinAnsi were always fine, which is exactly
    // why nobody noticed: an em dash is 0x97, an ellipsis 0x85.
    assert.ok(drawn.includes(0x97), "— was never broken");
    assert.ok(drawn.includes(0x85), "… was never broken");
  });
});

// --- the asset --------------------------------------------------------------

describe("the shipped faces", () => {
  test("every registered face has a file, served from this app's origin", () => {
    assert.equal(PDF_FONT_BASE_PATH, "/fonts");
    assert.ok(
      !PDF_FONT_BASE_PATH.includes("//"),
      "a font must never be fetched from a third party on a reader's behalf"
    );

    assert.equal(PDF_FACES.length, Object.keys(PDF_FONT).length);
    for (const face of PDF_FACES) {
      assert.ok(
        readFileSync(path.join(FONT_DIRECTORY, face.file)).length > 0,
        `${face.file} is not shipped`
      );
    }
  });

  test("each face covers the characters the standard-14 ones corrupted", () => {
    // Per FACE, not per document: a bold arrow and an italic arrow are
    // different files, and a subset that dropped one of them would corrupt
    // only emphasized text — the hardest kind of gap to notice.
    for (const face of PDF_FACES) {
      const mapped = mappedCodePoints(face.file);
      const missing = Object.entries(OUTSIDE_WINANSI)
        .filter(([, codePoint]) => !mapped.has(codePoint))
        .map(([character]) => character);

      // The one documented hole, upstream in DejaVu Sans Mono Oblique rather
      // than in the subset: neither oblique mono face has ✓, ✗ or ⚠. It costs
      // an ITALIC INLINE-CODE run holding one of those three, which renders as
      // a .notdef box — a visible absence, not the silent wrong glyph #398 is
      // about. Pinned so the day it changes, `public/fonts/README.md` is wrong
      // here and not only in prose.
      const expected =
        face.file.includes("mono") && face.file.includes("italic")
          ? ["✓", "✗"]
          : [];
      assert.deepEqual(missing, expected, `${face.file} lost ${missing}`);
    }
  });
  test("every fallback name is a family the renderer already knows", async () => {
    // The alias in `register`'s catch reads `families[face.standard]`. A name
    // that is not there aliases to `undefined`, and the degrade path — the one
    // nobody exercises by hand — throws "Font family not registered" instead of
    // handing the reader the file they used to get.
    const { Font } = await import("@react-pdf/renderer");
    const known = new Set(Font.getRegisteredFontFamilies());

    for (const face of PDF_FACES) {
      assert.ok(known.has(face.standard), `${face.standard} is not a family`);
    }
  });

  test("a glyph no face in the stack has costs the REST of its run", async () => {
    // The residual `public/fonts/README.md` names, held as a fact rather than
    // as prose: DejaVu Sans Mono Oblique has no ✓ upstream, and
    // `fontSubstitution` ends the run at a character nothing in the stack can
    // draw. So an ITALIC INLINE-CODE span holding one loses the rest of itself.
    //
    // It is the renderer's STANDING behaviour, not something the subset
    // introduced — the standard-14 faces do the same today wherever no font in
    // the stack has the character at all. What #398 changes is how few
    // characters are left in that set.
    //
    // Read from what is DRAWN, never from the ToUnicode map: the embedded
    // subset is built from the whole string, so the map lists glyphs the page
    // never shows. Every id here is two bytes wide.
    const drawn = (pdf: Buffer) => shownBytes(pdf).length / 2;

    assert.equal(
      drawn(await renderSample(PDF_FONT.monoItalic)),
      SAMPLE.indexOf("✓"),
      "the italic mono run must stop exactly at the gap"
    );
    assert.equal(
      drawn(await renderSample(PDF_FONT.mono)),
      SAMPLE.length,
      "and every other mono face draws the whole line"
    );
  });
});

// --- the one place a face may be named --------------------------------------

const TEMPLATE_DIRECTORY = path.join(
  process.cwd(),
  "src",
  "lib",
  "documents",
  "pdf"
);

/** The standard-14 families, which resolve with no asset and corrupt silently. */
const STANDARD_14 =
  /\b(Helvetica|Courier|Times-Roman|Times-Bold|Times-Italic|Times-BoldItalic|Symbol|ZapfDingbats)\b/;

/**
 * Comments removed, so the guard below reads CODE only.
 *
 * A header that explains what WinAnsi cost is the point of these files; a
 * `fontFamily: "Helvetica-Bold"` is the defect. Without this, naming the fault
 * in prose would fail the test that exists to forbid shipping it.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Every template source on the F6 path, minus this table and its own test.
 *
 * The DIRECTORY is walked rather than a list of file names kept here: a new
 * template that pins `"Helvetica"` by hand is exactly the regression this
 * guards, and a hardcoded list would let the new file be the one that slips
 * past.
 */
function templateSources(): { file: string; code: string }[] {
  const exempt = new Set(["fonts.ts", "fonts.test.ts"]);
  return readdirSync(TEMPLATE_DIRECTORY, {
    recursive: true,
    encoding: "utf-8",
  })
    .filter(
      (entry) => /\.tsx?$/.test(entry) && !exempt.has(path.basename(entry))
    )
    .map((entry) => ({
      file: entry,
      code: codeOnly(
        readFileSync(path.join(TEMPLATE_DIRECTORY, entry), "utf-8")
      ),
    }));
}

describe("the F6 templates name a role, never a face", () => {
  test("no template under src/lib/documents/pdf/ spells a standard-14 family", () => {
    // The wiki half is guarded next door — `article-pdf/render.test.ts` pins
    // every emphasis combination to a face this table registers. This is the
    // same guard for the server half, and it has to hold the same way: a
    // standard-14 name RESOLVES without an asset, so re-pinning one here brings
    // the WinAnsi corruption back with nothing failing.
    const sources = templateSources();

    assert.ok(
      sources.some(({ file }) => file === "styles.ts"),
      "the shared stylesheet must be scanned"
    );
    assert.ok(
      sources.length >= 3,
      "the directory walk found almost nothing — it is scanning the wrong place"
    );

    for (const { file, code } of sources) {
      const found = code.match(STANDARD_14);
      assert.equal(
        found?.[0],
        undefined,
        `${file} names ${found?.[0]} — use a PDF_FONT role instead`
      );
      assert.ok(
        !/font(Weight|Style)\s*:/.test(code),
        `${file} sets a font axis — a single-source family throws on one`
      );
    }
  });

  test("the guard can see the shape it forbids", () => {
    // A scan that cannot fail is a scan nobody notices has stopped matching.
    assert.ok(STANDARD_14.test('fontFamily: "Helvetica-Bold",'));
    assert.ok(STANDARD_14.test('fontFamily: "Courier",'));
    assert.ok(!STANDARD_14.test("fontFamily: PDF_FONT.bold,"));
    assert.equal(
      codeOnly('// fontFamily: "Helvetica"\nconst a = 1;').trim(),
      "const a = 1;"
    );
  });
});

// --- degrading --------------------------------------------------------------

/**
 * A stand-in for `Font`, recording what it was asked to register.
 *
 * `families` starts with the eight standard-14 names the real store registers
 * in its constructor, because the fallback ALIASES onto them — and an alias
 * onto a name nobody registered would be `undefined`, which is the bug this
 * double has to be able to see.
 */
function fakeRegistry() {
  const registered: { family: string; src: string }[] = [];
  const families = Object.fromEntries(
    PDF_FACES.map((face) => [face.standard, { builtIn: face.standard }])
  );
  const Font = {
    register: (data: { family: string; src: string }) => registered.push(data),
    getRegisteredFonts: () => families,
  } as unknown as PdfFontRegistry;
  return { Font, registered, families };
}

describe("registerPdfFonts", () => {
  test("registers every face as a single-source family", async () => {
    const { Font, registered } = fakeRegistry();
    const loaded = await registerPdfFonts(Font, async () => new Uint8Array(8));

    assert.equal(loaded, true);
    assert.deepEqual(
      registered.map((entry) => entry.family),
      PDF_FACES.map((face) => face.family)
    );
    // Never a weight or a style: `@react-pdf/font` filters on `fontStyle`
    // FIRST, so a family with two faces throws the moment one is nested in the
    // other — a bold heading with an italic word would fail the download.
    for (const entry of registered) {
      assert.deepEqual(Object.keys(entry), ["family", "src"]);
      assert.match(entry.src, /^data:font\/ttf;base64,/);
    }
  });

  test("a font that will not load degrades to the standard-14 behaviour", async () => {
    // The acceptance criterion, exactly: the reader still gets a file. It is
    // the file they got before #398 — corrupt arrows and all — not an error
    // toast.
    const { Font, registered, families } = fakeRegistry();
    const loaded = await registerPdfFonts(Font, async () => {
      throw new Error("404");
    });

    assert.equal(loaded, false);
    assert.deepEqual(registered, [], "the fallback registers nothing");
    for (const face of PDF_FACES) {
      assert.equal(
        families[face.family],
        families[face.standard],
        `${face.family} must BE the built-in family, not a copy of it`
      );
    }
  });

  test("one missing face falls back ALL of them, never half a document", async () => {
    // Half a page in DejaVu and half in Helvetica is two faces at two
    // different heights on one sheet — worse than either alone.
    const { Font, registered } = fakeRegistry();
    const loaded = await registerPdfFonts(Font, async (file) => {
      if (file === PDF_FACES[3].file) throw new Error("404");
      return new Uint8Array(8);
    });

    assert.equal(loaded, false);
    assert.deepEqual(
      registered,
      [],
      "a partial load must register no shipped face at all"
    );
  });

  test("the alias renders the same file naming the standard family does", async () => {
    // The half a fake registry cannot prove, and the reason the fallback is an
    // alias at all: `@react-pdf/layout` appends `Helvetica` to every font
    // stack, and `fontSubstitution` breaks a run wherever the picked font
    // CHANGES. A family registered with `src: "Helvetica"` is a different
    // object from that appended one, so a character neither has swallows the
    // rest of the run — "A → B" comes out "A ". Aliasing onto the same family
    // object cannot do that, and this asserts it byte for byte.
    const { Font } = await import("@react-pdf/renderer");
    const families = Font.getRegisteredFonts();
    families["EFDocAliasProbe"] = families[PDF_FACES[0].standard];

    const [aliased, direct] = await Promise.all([
      renderSample("EFDocAliasProbe"),
      renderSample(PDF_FACES[0].standard),
    ]);

    assert.deepEqual(shownBytes(aliased), shownBytes(direct));
    // …and it is TODAY'S file it matches: WinAnsi, wrong arrow and all.
    assert.equal(shownBytes(aliased)[2], 0x92);
  });

  test("registers once per registry, however often a reader downloads", async () => {
    // `Font.register` APPENDS a source to a family, so a second call would
    // leave a dead duplicate behind on every download after the first.
    const { Font, registered } = fakeRegistry();
    let reads = 0;
    const load = async () => {
      reads += 1;
      return new Uint8Array(8);
    };

    await registerPdfFonts(Font, load);
    await registerPdfFonts(Font, load);

    assert.equal(reads, PDF_FACES.length);
    assert.equal(registered.length, PDF_FACES.length);
  });
});
