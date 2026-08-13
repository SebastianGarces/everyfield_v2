import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TEMPLATE_REIMPORT_NOTE,
  planTemplateImport,
  templateDueDate,
} from "./import";
import {
  TASK_TEMPLATES,
  findTaskTemplate,
  taskTemplateItemPriority,
  type TaskTemplate,
} from "./templates";

// ----------------------------------------------------------------------------
// T-012 — relative dates, proven at two clock values.
//
// The criterion is the one thing a stored template cannot fake: import the
// same checklist on two different days and the due dates must differ by
// exactly the gap between those days. Everything here is pure — no database is
// involved in working out when a task is due, which is what makes the schedule
// testable at any clock at all.
// ----------------------------------------------------------------------------

const TEMPLATE = findTaskTemplate("vision-meeting-preparation") as TaskTemplate;

const MARCH = new Date("2026-03-02T09:15:00.000Z");
const SEPTEMBER = new Date("2026-09-14T09:15:00.000Z");

test("the fixture template exists", () => {
  assert.ok(TEMPLATE, "vision-meeting-preparation must be in the catalog");
});

test("a due date is the import day plus the item's offset", () => {
  assert.equal(templateDueDate("2026-03-02", 0), "2026-03-02");
  assert.equal(templateDueDate("2026-03-02", 1), "2026-03-03");
  assert.equal(templateDueDate("2026-03-02", 14), "2026-03-16");
});

test("day arithmetic crosses month and year ends", () => {
  assert.equal(templateDueDate("2026-01-25", 10), "2026-02-04");
  assert.equal(templateDueDate("2026-02-25", 7), "2026-03-04");
  // 2028 is a leap year: the 29th exists and must be counted.
  assert.equal(templateDueDate("2028-02-27", 3), "2028-03-01");
  assert.equal(templateDueDate("2026-12-28", 7), "2027-01-04");
});

test("the same template imported on two days yields different due dates", () => {
  const spring = planTemplateImport(TEMPLATE, MARCH);
  const autumn = planTemplateImport(TEMPLATE, SEPTEMBER);

  assert.equal(spring.importedOn, "2026-03-02");
  assert.equal(autumn.importedOn, "2026-09-14");
  assert.equal(spring.tasks.length, autumn.tasks.length);

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const gapDays =
    (Date.parse("2026-09-14T00:00:00Z") - Date.parse("2026-03-02T00:00:00Z")) /
    MS_PER_DAY;

  for (const [index, springTask] of spring.tasks.entries()) {
    const autumnTask = autumn.tasks[index];

    assert.equal(springTask.itemKey, autumnTask.itemKey);
    assert.notEqual(
      springTask.dueDate,
      autumnTask.dueDate,
      `${springTask.itemKey} has the same due date in March and September — the date is stored, not computed`
    );

    const shift =
      (Date.parse(`${autumnTask.dueDate}T00:00:00Z`) -
        Date.parse(`${springTask.dueDate}T00:00:00Z`)) /
      MS_PER_DAY;
    assert.equal(
      shift,
      gapDays,
      `${springTask.itemKey} moved ${shift} days when the import date moved ${gapDays}`
    );
  }
});

test("the hour of the import instant never moves a task to another day", () => {
  // `due_date` is a calendar day and the arithmetic is UTC. One minute before
  // midnight and one minute after it are different days; one minute after
  // midnight and midday are not.
  const justAfterMidnight = planTemplateImport(
    TEMPLATE,
    new Date("2026-03-02T00:01:00.000Z")
  );
  const midday = planTemplateImport(
    TEMPLATE,
    new Date("2026-03-02T12:00:00.000Z")
  );
  const lateEvening = planTemplateImport(
    TEMPLATE,
    new Date("2026-03-02T23:59:00.000Z")
  );

  assert.deepEqual(
    justAfterMidnight.tasks.map((task) => task.dueDate),
    midday.tasks.map((task) => task.dueDate)
  );
  assert.deepEqual(
    lateEvening.tasks.map((task) => task.dueDate),
    midday.tasks.map((task) => task.dueDate)
  );
});

test("no planned task is due before the day it was imported", () => {
  for (const template of TASK_TEMPLATES) {
    const plan = planTemplateImport(template, MARCH);
    for (const task of plan.tasks) {
      assert.ok(
        task.dueDate >= plan.importedOn,
        `${template.key}/${task.itemKey} is due ${task.dueDate}, before the import day ${plan.importedOn}`
      );
    }
  }
});

test("a planned task carries its template's category and its own priority", () => {
  for (const template of TASK_TEMPLATES) {
    const plan = planTemplateImport(template, MARCH);
    assert.equal(plan.category, template.category);

    for (const [index, task] of plan.tasks.entries()) {
      const item = template.items[index];
      assert.equal(task.title, item.title);
      assert.equal(task.category, template.category);
      assert.equal(task.priority, taskTemplateItemPriority(template, item));
      assert.equal(task.description, item.description ?? null);
      assert.equal(task.offsetDays, item.offsetDays);
    }
  }
});

test("the plan names the template it came from", () => {
  const plan = planTemplateImport(TEMPLATE, MARCH);
  assert.equal(plan.templateKey, TEMPLATE.key);
  assert.equal(plan.templateName, TEMPLATE.name);
  assert.equal(plan.phase, TEMPLATE.phase);
});

test("the repeat policy is stated, not implied", () => {
  // Importing twice creates two sets. That is a choice, and the AC allows it
  // only if the product says so out loud — this is the sentence, and
  // `template-picker.test.ts` asserts the picker renders it.
  assert.match(TEMPLATE_REIMPORT_NOTE, /again/i);
  assert.match(TEMPLATE_REIMPORT_NOTE, /second copy/i);
  assert.match(TEMPLATE_REIMPORT_NOTE, /merged|replaced|skipped/i);
});

test("planning twice on the same day produces two identical sets", () => {
  // The pure evidence for "no dedupe": nothing in the plan varies with what
  // was imported before, so the second import is a second full set. The DB
  // half of this is in `import-live.test.ts`.
  const first = planTemplateImport(TEMPLATE, MARCH);
  const second = planTemplateImport(TEMPLATE, MARCH);
  assert.deepEqual(first, second);
});
