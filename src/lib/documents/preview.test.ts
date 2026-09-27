import assert from "node:assert/strict";
import { test } from "node:test";
import { DOCUMENT_TEMPLATES } from "./templates";
import { renderDocument } from "./render";
import { previewDocumentBytes } from "./preview";
import { documentPreviewSchema } from "./preview-model";

for (const template of DOCUMENT_TEMPLATES) {
  for (const format of template.formats) {
    test(`${template.id}/${format} previews actual resolved renderer content`, async () => {
      const values = Object.fromEntries(
        template.mergeFields.map((field) => [
          field.key,
          `VALUE_${field.key}_<safe>&_é`,
        ])
      );
      const bytes = await renderDocument(format, template.id, values);
      if (format === "pdf") {
        assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
        return;
      }
      const preview = await previewDocumentBytes(format, bytes);
      assert.equal(documentPreviewSchema.parse(preview).format, format);
      const text = JSON.stringify(preview);
      for (const field of template.mergeFields)
        assert.ok(
          text.includes(values[field.key]),
          `${template.id} did not preview ${field.key}`
        );
      if (preview.format === "docx") assert.ok(preview.blocks.length > 2);
      else {
        assert.ok(preview.sheets.length > 0);
        assert.ok(preview.sheets[0].rows.length > 5);
      }
      const empty = await previewDocumentBytes(
        format,
        await renderDocument(format, template.id, {})
      );
      assert.ok(JSON.stringify(empty).includes("Our Church"));
    });
  }
}

test("Word agenda preserves heading and ordered table content", async () => {
  const preview = await previewDocumentBytes(
    "docx",
    await renderDocument("docx", "vision-meeting-agenda", {
      church_name: "Test church",
      pastor_name: "A person",
      meeting_date: "Next week",
    })
  );
  assert.equal(preview.format, "docx");
  if (preview.format !== "docx") return;
  assert.ok(
    preview.blocks.some((block) => block.kind === "paragraph" && block.heading)
  );
  assert.ok(
    preview.blocks.some(
      (block) => block.kind === "table" && block.rows.length > 2
    )
  );
});

test("Excel budget retains rows, columns and formulas without duplicating merged titles", async () => {
  const preview = await previewDocumentBytes(
    "xlsx",
    await renderDocument("xlsx", "first-year-budget", {
      church_name: "One title",
    })
  );
  assert.equal(preview.format, "xlsx");
  if (preview.format !== "xlsx") return;
  const rows = preview.sheets[0].rows;
  assert.equal(rows[0].length, 14);
  assert.equal(
    rows[0].filter((cell) => cell.text.includes("One title")).length,
    1
  );
  assert.ok(rows.flat().some((cell) => cell.formula?.startsWith("SUM(")));
  assert.equal(rows[2][1].text, "Jan");
});
