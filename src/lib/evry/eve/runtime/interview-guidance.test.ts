import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { authoredSkills } from "./authored-skills.generated";

const markdown = readFileSync(
  resolve("agent/skills/interview-review/SKILL.md"),
  "utf8"
);

test("the bundled interview guidance is the exact authored skill for routing and initial guidance", () => {
  const bundled = authoredSkills["interview-review"];
  assert.equal(bundled.markdown, markdown);
  assert.equal(
    bundled.description,
    markdown.match(/^description: (.+)$/m)?.[1]
  );
  assert.match(bundled.description, /individual 4C assessments/);
  assert.match(bundled.description, /complete history-note retrieval/);
});

test("complete note guidance preserves scope and independent record/content continuations", () => {
  const section = markdown.split("## Complete recorded notes\n")[1];
  assert.ok(section);
  assert.match(section, /one bounded `code_mode` program/);
  assert.match(section, /unchanged base filters/);
  assert.match(section, /date basis, dates, author filters/);
  assert.match(section, /text filter if requested, latest-record policy/);
  assert.match(section, /`Next page cursor` with `result.afterId`/);
  assert.match(section, /`Next content offset`/);
  assert.match(section, /at most 50 returned `recordIds`/);
  assert.match(section, /`result: \{ mode: "list", limit: 50 \}`/);
  assert.match(section, /omit the record-page cursor/);
  assert.match(
    section,
    /entry timestamps, source links and exact result references/
  );
  assert.match(section, /return each record once/);
});

test("the skill retains focused reads, honest partial evidence and model judgment", () => {
  assert.match(
    markdown,
    /Do not add a keyword filter to replace reading the notes/
  );
  assert.match(markdown, /report the evidence as partial rather than complete/);
  assert.match(markdown, /existing call, time and output limits/);
  assert.match(markdown, /Separate reads are not an atomic snapshot/);
  assert.match(markdown, /Use a focused query or count instead/);
  assert.doesNotMatch(
    markdown,
    /53 records|Jordan Fixture|Alex Fixture|assessments-03/
  );
});

test("direct code-mode discovery exposes the same bounded continuation pattern without requiring a skill load", () => {
  const tool = readFileSync(resolve("agent/tools/code_mode.ts"), "utf8");
  assert.match(tool, /For complete paged reads, keep a base input/);
  assert.match(
    tool,
    /record cursors and content offsets inside one bounded program/
  );
  assert.match(tool, /preserve filters and required result settings/);
  assert.match(
    tool,
    /report partial evidence if any continuation fails or a limit is reached/
  );
  assert.doesNotMatch(tool, /Always use code.mode|must load interview-review/);
});
