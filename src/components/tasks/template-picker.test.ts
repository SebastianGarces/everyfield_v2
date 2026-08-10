import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TEMPLATE_REIMPORT_NOTE } from "@/lib/tasks/import";
import { TASK_TEMPLATES, taskTemplatesByPhase } from "@/lib/tasks/templates";

import { TaskTemplatePicker } from "./template-picker";

// ----------------------------------------------------------------------------
// The picker, rendered. These are DOM assertions, not source scans: the Cursor
// Pointer Rule is about what ships to a browser, so it is asserted on the
// markup a browser would receive.
// ----------------------------------------------------------------------------

function render(
  currentPhase?: number | null,
  headingLevel?: "h1" | "h2"
): string {
  return renderToStaticMarkup(
    createElement(TaskTemplatePicker, { currentPhase, headingLevel })
  );
}

/** Read a file of the app, by path from the repository root. */
function sourceOf(repoPath: string): string {
  return readFileSync(new URL(`../../../${repoPath}`, import.meta.url), "utf8");
}

/**
 * Undo React's HTML escaping, so an assertion can be written in the words a
 * reader sees. Half the catalog holds an apostrophe or an ampersand
 * ("Children's Ministry", "Training & Preparation").
 */
function decode(html: string): string {
  return html
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Strip tags — what a reader actually sees. Tags first, then entities, so a
 *  decoded `&lt;` can never be mistaken for markup. */
function textOf(html: string): string {
  return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
}

function buttons(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? [];
}

test("every import control carries cursor-pointer", () => {
  const html = render(2);
  const controls = buttons(html);

  assert.equal(
    controls.length,
    TASK_TEMPLATES.length,
    "expected one import control per template"
  );

  for (const control of controls) {
    assert.match(
      control,
      /cursor-pointer/,
      `an import control is missing cursor-pointer: ${control}`
    );
  }
});

test("every template in the catalog is offered, grouped under its phase", () => {
  const html = render(null);
  const text = textOf(html);

  for (const template of TASK_TEMPLATES) {
    assert.ok(
      text.includes(template.name),
      `${template.key} is not offered by the picker`
    );
  }

  for (const group of taskTemplatesByPhase()) {
    if (group.templates.length === 0) continue;
    assert.ok(
      text.includes(group.phaseName),
      `${group.phaseName} has templates but no heading`
    );
  }
});

test("each control names the template it imports", () => {
  // Nineteen buttons reading "Import" are nineteen identical accessible names.
  const html = decode(render(null));

  for (const template of TASK_TEMPLATES) {
    assert.ok(
      html.includes(`aria-label="Import ${template.name}"`),
      `${template.key} has no distinguishing accessible name`
    );
  }
});

test("the repeat policy is on screen before the press", () => {
  // The import does not dedupe. That is only acceptable if the planter is told
  // so where they press, not in a changelog.
  assert.ok(textOf(render(1)).includes(TEMPLATE_REIMPORT_NOTE));
});

test("the picker states what it creates, from the catalog itself", () => {
  const text = textOf(render(1));

  for (const template of TASK_TEMPLATES) {
    const furthest = template.items.reduce(
      (days, item) => Math.max(days, item.offsetDays),
      0
    );
    assert.ok(
      text.includes(`${template.items.length} tasks`),
      `${template.key} does not say how many tasks it creates`
    );
    assert.ok(
      text.includes(`spread over the ${furthest} days after you import it`),
      `${template.key} does not say how far its dates reach`
    );
  }
});

test("no count is ever fused to the word after it", () => {
  // The copy defect a number rendered next to a JSX expression produces
  // ("12tasks"). The sentence is one string, so the space is part of it.
  assert.doesNotMatch(textOf(render(3)), /\d\p{L}/u);
});

test("the plant's own stage is marked, not moved", () => {
  const marked = decode(render(2));
  const unmarked = decode(render(null));

  assert.ok(marked.includes("Your stage now"));
  assert.ok(!unmarked.includes("Your stage now"));

  // Journey order is the same either way: the current phase is highlighted in
  // place, so a planter can still see how far along the journey they are.
  const order = (html: string) =>
    taskTemplatesByPhase()
      .filter((group) => group.templates.length > 0)
      .map((group) => html.indexOf(group.phaseName));

  for (const html of [marked, unmarked]) {
    const positions = order(html);
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a - b)
    );
  }
});

test("no failure region renders until something fails", () => {
  // The error belongs to the row that produced it, so nothing is announced on
  // first paint.
  assert.ok(!render(2).includes('role="alert"'));
});

test("the catalog's title is the page title on its own route", () => {
  // The standalone route has no other heading, so an `h2` there would open the
  // document outline at level two. Embedded, the default stays `h2`.
  assert.match(render(2, "h1"), /<h1[^>]*>Checklist templates<\/h1>/);
  assert.match(render(2), /<h2[^>]*>Checklist templates<\/h2>/);
  assert.doesNotMatch(render(2), /<h1/);
});

test("the phase headings never skip a level under the title", () => {
  // A heading jump (h1 straight to h3) is read as a missing section, and it
  // was the defect a hard-coded `h3` produced the moment the title became h1.
  const standalone = decode(render(2, "h1"));
  const embedded = decode(render(2, "h2"));

  for (const group of taskTemplatesByPhase()) {
    if (group.templates.length === 0) continue;
    assert.ok(
      standalone.includes(`<h2 class="text-sm font-medium">${group.phaseName}`),
      `${group.phaseName} is not an h2 under the page title`
    );
    assert.ok(
      embedded.includes(`<h3 class="text-sm font-medium">${group.phaseName}`),
      `${group.phaseName} is not an h3 under an embedded h2`
    );
  }
});

// ----------------------------------------------------------------------------
// The catalog is REACHABLE. These are source assertions on purpose: whether a
// component is served by a route is a fact about the router's file tree, and
// no amount of rendering the component can prove it. A previous attempt shipped
// this picker correct, tested and mounted nowhere — every browser-level
// assertion below it passed against markup no browser could ever request.
// ----------------------------------------------------------------------------

const TEMPLATES_ROUTE = "src/app/(dashboard)/tasks/templates/page.tsx";

test("a route renders the picker", () => {
  const page = sourceOf(TEMPLATES_ROUTE);

  assert.match(
    page,
    /<TaskTemplatePicker/,
    `${TEMPLATES_ROUTE} must render the picker`
  );
  // Static segment beside `[id]`: without this file `/tasks/templates` resolves
  // to a task whose id is the word "templates" and answers 500.
  assert.match(page, /export default async function/);
});

test("the picker's route is linked from the task list", () => {
  const tasksPage = sourceOf("src/app/(dashboard)/tasks/page.tsx");

  assert.match(
    tasksPage,
    /href="\/tasks\/templates"/,
    "the /tasks header must link to the checklist catalog"
  );
});
