import assert from "node:assert/strict";
import { test } from "node:test";

import { taskCategories, taskPriorities } from "@/db/schema/tasks";
import { PHASES } from "@/lib/constants";

import {
  TASK_TEMPLATES,
  findTaskTemplate,
  taskTemplateItemPriority,
  taskTemplateSize,
  taskTemplatesByPhase,
} from "./templates";

// ----------------------------------------------------------------------------
// T-011 — the catalog's shape.
//
// The catalog is code, so a defect in it is a defect that ships: a duplicate
// key silently shadows a template, a stray category makes tasks unfilterable,
// and a negative offset creates work that was overdue the moment it arrived.
// None of those are visible in review of a 700-line list, so they are asserted
// over the whole catalog rather than sampled.
// ----------------------------------------------------------------------------

const CATEGORIES = new Set<string>(taskCategories);
const PRIORITIES = new Set<string>(taskPriorities);
const PHASE_NUMBERS = Object.keys(PHASES).map(Number);

test("every template declares a phase and a category", () => {
  assert.ok(TASK_TEMPLATES.length > 0, "the catalog must not be empty");

  for (const template of TASK_TEMPLATES) {
    assert.ok(
      PHASE_NUMBERS.includes(template.phase),
      `${template.key} declares phase ${template.phase}, which is not a phase`
    );
    assert.ok(
      CATEGORIES.has(template.category),
      `${template.key} declares category "${template.category}", which the tasks table cannot store`
    );
    assert.ok(
      PRIORITIES.has(template.defaultPriority),
      `${template.key} declares an unknown default priority`
    );
  }
});

test("template keys are unique — a duplicate would shadow a whole checklist", () => {
  const keys = TASK_TEMPLATES.map((template) => template.key);
  assert.equal(new Set(keys).size, keys.length);

  // `findTaskTemplate` is a linear find, so a duplicate key would return the
  // first and leave the second unreachable from the picker.
  for (const key of keys) {
    assert.equal(findTaskTemplate(key)?.key, key);
  }
});

test("an unknown key is null, never a throw", () => {
  // The key arrives from a client. A refusal has to be a value the action can
  // turn into a message, not an exception it has to catch.
  assert.equal(findTaskTemplate("no-such-template"), null);
  assert.equal(findTaskTemplate(""), null);
});

test("every template has items, with unique keys and non-negative offsets", () => {
  for (const template of TASK_TEMPLATES) {
    assert.ok(
      template.items.length > 0,
      `${template.key} has no items — importing it would report success and create nothing`
    );
    assert.equal(taskTemplateSize(template), template.items.length);

    const itemKeys = template.items.map((item) => item.key);
    assert.equal(
      new Set(itemKeys).size,
      itemKeys.length,
      `${template.key} has duplicate item keys`
    );

    for (const item of template.items) {
      assert.ok(
        Number.isInteger(item.offsetDays) && item.offsetDays >= 0,
        `${template.key}/${item.key} has offsetDays ${item.offsetDays} — a template may not create work that is already overdue`
      );
      assert.ok(
        item.title.trim().length > 0,
        `${template.key}/${item.key} has an empty title`
      );
      assert.ok(
        PRIORITIES.has(taskTemplateItemPriority(template, item)),
        `${template.key}/${item.key} resolves to an unknown priority`
      );
    }
  }
});

test("no template holds an absolute date", () => {
  // The whole of T-012 rests on this: the catalog says "seven days after you
  // import it", never "the 14th of March". A date typed into a title or an
  // offset would be stale the first time the template is reused.
  const serialised = JSON.stringify(TASK_TEMPLATES);
  assert.doesNotMatch(
    serialised,
    /\d{4}-\d{2}-\d{2}/,
    "a template contains something shaped like a calendar date"
  );
});

test("an item's priority is its own, or its template's", () => {
  const template = TASK_TEMPLATES[0];
  const withOverride = template.items.find((item) => item.priority);
  const withoutOverride = template.items.find((item) => !item.priority);

  assert.ok(withoutOverride, "expected at least one item to inherit");
  assert.equal(
    taskTemplateItemPriority(template, withoutOverride),
    template.defaultPriority
  );

  if (withOverride) {
    assert.equal(
      taskTemplateItemPriority(template, withOverride),
      withOverride.priority
    );
  }
});

test("every phase of the journey carries at least one checklist", () => {
  // A phase with nothing to import is a heading with nothing under it, and a
  // planter at that stage learning the product has no help for them.
  const groups = taskTemplatesByPhase();
  assert.equal(groups.length, PHASE_NUMBERS.length);

  for (const group of groups) {
    assert.equal(group.phaseName, PHASES[group.phase]);
    assert.ok(
      group.templates.length > 0,
      `${group.phaseName} has no templates`
    );
    for (const template of group.templates) {
      assert.equal(template.phase, group.phase);
    }
  }
});

test("the groups come back in journey order", () => {
  const phases = taskTemplatesByPhase().map((group) => group.phase);
  assert.deepEqual(
    phases,
    [...phases].sort((a, b) => a - b)
  );
});

test("no template creates facility work", () => {
  // Facility tasks left with the cut Facility feature (the FRD's Out of Scope
  // section). The category still exists on the tasks table for historic rows,
  // so nothing but this test stops a template from reintroducing the feature
  // through the side door.
  for (const template of TASK_TEMPLATES) {
    assert.notEqual(
      template.category,
      "facilities",
      `${template.key} is categorised as facility work, which is out of scope`
    );
  }
});
