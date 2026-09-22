import assert from "node:assert/strict";
import { test } from "node:test";
import { strFromU8, unzipSync } from "fflate";

import {
  ORIENTATION_AGENDA_TEMPLATE,
  orientationAgendaContent,
} from "./content/orientation-agenda";
import { buildAutoFillDefaults, resolveMergeValues } from "./merge";
import { canRenderDocument, renderDocument } from "./render";
import { getTemplateById } from "./templates";

const values = {
  church_name: "North Ridge Church",
  meeting_title: "Core team orientation",
  meeting_date: "September 27, 2026 at 10:00 AM EDT",
  meeting_location: "Church, 123 A St., North Ridgeville, OH 44039",
  meeting_duration: "2 hours",
  meeting_agenda:
    "Welcome and introductions (15 minutes)\nMeet the ministry leaders (30 minutes)\n\nQuestions with José and Zoë (20 minutes)\nNext steps and closing (10 minutes)",
};

test("orientation agenda is its own native template with reviewed meeting fields", () => {
  const template = getTemplateById("orientation-agenda");
  assert.equal(template, ORIENTATION_AGENDA_TEMPLATE);
  assert.deepEqual(template.formats, ["pdf", "docx"]);
  assert.ok(canRenderDocument("pdf", template.id));
  assert.ok(canRenderDocument("docx", template.id));
  assert.equal(canRenderDocument("xlsx", template.id), false);
  assert.deepEqual(
    template.mergeFields
      .filter((field) => field.required)
      .map((field) => field.key),
    ["church_name", "meeting_title", "meeting_date", "meeting_agenda"]
  );
});

test("context only fills church name, never an unrelated launch date or meeting agenda", () => {
  const context = {
    churchName: "North Ridge Church",
    userName: "Pastor Different",
    launchDate: "2026-10-11",
  };
  assert.deepEqual(
    buildAutoFillDefaults(ORIENTATION_AGENDA_TEMPLATE, context),
    {
      church_name: context.churchName,
    }
  );
  const missing = resolveMergeValues(ORIENTATION_AGENDA_TEMPLATE, context, {});
  for (const key of ["meeting_title", "meeting_date", "meeting_agenda"]) {
    assert.equal(missing[key], "", `${key} must remain missing for validation`);
  }
  assert.deepEqual(orientationAgendaContent(missing).details, []);
  assert.deepEqual(
    resolveMergeValues(ORIENTATION_AGENDA_TEMPLATE, context, values),
    values
  );
});

test("agenda text preserves reviewed line order, Unicode, and blank lines without default items", () => {
  const content = orientationAgendaContent(values);
  assert.equal(content.meetingTitle, values.meeting_title);
  assert.equal(content.agendaLines.join("\n"), values.meeting_agenda);
  assert.deepEqual(
    orientationAgendaContent({ meeting_agenda: "First\r\n\r\nLast" })
      .agendaLines,
    ["First", "", "Last"]
  );
});

function assertContent(text: string) {
  for (const value of [
    "Orientation Agenda",
    values.church_name,
    values.meeting_title,
    values.meeting_date,
    values.meeting_location,
    values.meeting_duration,
    ...values.meeting_agenda.split("\n").filter(Boolean),
  ]) {
    assert.ok(text.includes(value), `Generated document omitted ${value}`);
  }
  assert.doesNotMatch(
    text,
    /Vision Meeting|GROW|PRAY|GIVE|45.60 minutes|Pastor Different/
  );
  assert.ok(
    text.indexOf("Welcome and introductions") <
      text.indexOf("Next steps and closing")
  );
}

test("native DOCX renderer contains actual orientation details and agenda as editable paragraphs", async () => {
  const bytes = await renderDocument("docx", "orientation-agenda", values);
  const xml = strFromU8(unzipSync(bytes)["word/document.xml"]);
  assertContent(xml.replace(/<[^>]+>/g, ""));
  assert.match(xml, /w:pStyle w:val="Title"/);
  assert.match(xml, /w:pgSz w:w="12240" w:h="15840"/);
  assert.ok(xml.includes("José"));
});

test("native PDF renderer contains actual orientation details and agenda without Vision Meeting content", async () => {
  const bytes = await renderDocument("pdf", "orientation-agenda", values);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
  });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 1);
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    assertContent(text);
  } finally {
    await task.destroy();
  }
});

test("long reviewed orientation agendas flow across PDF pages without dropping the last item", async () => {
  const lines = Array.from(
    { length: 80 },
    (_, index) =>
      `Orientation topic ${index + 1}: discuss the next steps with the team.`
  );
  const bytes = await renderDocument("pdf", "orientation-agenda", {
    ...values,
    meeting_agenda: lines.join("\n"),
  });
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
  });
  try {
    const pdf = await task.promise;
    assert.ok(pdf.numPages > 1);
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" ")
      );
    }
    const text = pageTexts.join(" ");
    for (const line of lines) assert.ok(text.includes(line), line);
    assert.ok(pageTexts.at(-1)?.includes(lines.at(-1)!));
  } finally {
    await task.destroy();
  }
});
