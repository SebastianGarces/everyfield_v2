import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { zipSync, strToU8 } from "fflate";
import {
  documentContentPage,
  documentReadShape,
  extractGeneratedDocument,
} from "./content-documents";

const ids = ["00000000-0000-4000-8000-000000000001"];
test("every large-document continuation remains legal and reaches the full extracted tail", async () => {
  const text = "A".repeat(210_000) + "FINAL AGENDA CHANGE";
  const bytes = zipSync({
    "word/document.xml": strToU8(
      `<w:document><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:document>`
    ),
  });
  const extracted = await extractGeneratedDocument(bytes, "docx");
  assert.equal(extracted.complete, true);
  assert.equal(extracted.sections[0]?.text, text);
  let offset = 0;
  let seen = "";
  for (let pageNumber = 0; pageNumber < 500; pageNumber++) {
    const input = z
      .object(documentReadShape)
      .parse({ ids, offset, maxCharacters: 500 });
    const page = documentContentPage(extracted, input);
    assert.equal(page.completeness, "Complete text extraction");
    seen += page.content;
    if (page.nextOffset === null) break;
    assert.ok(page.nextOffset > offset);
    assert.ok(
      z.object(documentReadShape).safeParse({ ids, offset: page.nextOffset })
        .success
    );
    offset = page.nextOffset;
  }
  assert.equal(seen, `[Paragraph 1]\n${extracted.sections[0]!.text}`);
  assert.ok(seen.endsWith("FINAL AGENDA CHANGE"));
  const last = documentContentPage(extracted, {
    offset: Number.MAX_SAFE_INTEGER,
    maxCharacters: 5000,
  });
  assert.equal(last.nextOffset, null);
  assert.equal(last.content, "");
  assert.equal(last.citationRange, "No extracted content at this offset");
  assert.equal(
    z.object(documentReadShape).safeParse({ ids, offset: 205_000 }).success,
    true
  );
  for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity])
    assert.equal(
      z.object(documentReadShape).safeParse({ ids, offset }).success,
      false
    );
});
test("short complete files retain citation text; parser limits remain visible", () => {
  const sections = [{ citation: "Page 1", text: "Welcome and pray." }];
  const page = documentContentPage(
    { sections, complete: true },
    { offset: 0, maxCharacters: 500 }
  );
  assert.equal(page.content, "[Page 1]\nWelcome and pray.");
  assert.equal(page.completeness, "Complete text extraction");
  assert.equal(page.nextOffset, null);
  assert.equal(
    documentContentPage(
      {
        sections,
        complete: false,
        limitation: "Only the first 50 pages were extracted",
      },
      { offset: 0, maxCharacters: 500 }
    ).completeness,
    "Only the first 50 pages were extracted"
  );
});
test("a page never splits a surrogate pair and continues without losing it", () => {
  const prefix = "[Page 1]\n";
  const extracted = {
    complete: true,
    sections: [
      { citation: "Page 1", text: "A".repeat(499 - prefix.length) + "😀tail" },
    ],
  };
  const page = documentContentPage(extracted, {
    offset: 0,
    maxCharacters: 500,
  });
  assert.equal(page.content.length, 499);
  assert.equal(page.nextOffset, 499);
  assert.equal(
    documentContentPage(extracted, {
      offset: page.nextOffset!,
      maxCharacters: 500,
    }).content,
    "😀tail"
  );
  assert.doesNotMatch(page.content, /[\uD800-\uDBFF]$/);
});
