import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "../artifacts/core";

test("read artifacts derive consistent counts from rows and exclusions", () => {
  const taskLink = trustedEvryApplicationSourceLink({
    label: "Call Alex",
    href: "/tasks/task-1",
  });
  const artifact = buildEvryReadArtifact({
    title: "Overdue tasks",
    filters: [{ label: "Due", value: "Before today" }],
    exclusions: [{ reason: "Completed", count: 2 }],
    items: [
      {
        id: "task-1",
        label: "Call Alex",
        facts: [{ label: "Due", value: "Aug 27, 2026" }],
        sourceLink: taskLink,
      },
    ],
    sourceLinks: [taskLink],
  });

  assert.deepEqual(artifact.counts, {
    matched: 3,
    returned: 1,
    excluded: 2,
  });
});

test("trusted source links refuse external and protocol-relative targets", () => {
  for (const href of ["https://example.com/tasks/1", "//example.com/tasks/1"]) {
    assert.throws(
      () => trustedEvryApplicationSourceLink({ label: "Task", href }),
      /application paths/
    );
  }
});

test("read artifacts refuse invalid exclusion counts", () => {
  assert.throws(
    () =>
      buildEvryReadArtifact({
        title: "Tasks",
        filters: [],
        exclusions: [{ reason: "Unknown", count: -1 }],
        items: [],
        sourceLinks: [],
      }),
    /non-negative integers/
  );
});

test("read artifacts snapshot mutable caller aliases before deriving counts", () => {
  const link = trustedEvryApplicationSourceLink({
    label: "Task",
    href: "/tasks/task-1",
  });
  const filters = [{ label: "Status", value: "Open" }];
  const exclusions = [{ reason: "Completed", count: 1 }];
  const facts = [{ label: "Due", value: "Aug 27, 2026" }];
  const items = [{ id: "task-1", label: "Task", facts, sourceLink: link }];
  const sourceLinks = [link];
  const artifact = buildEvryReadArtifact({
    title: "Tasks",
    filters,
    exclusions,
    items,
    sourceLinks,
  });

  filters[0].value = "Changed";
  filters.push({ label: "Owner", value: "Nobody" });
  exclusions[0].count = 99;
  facts[0].value = "Changed";
  items[0].label = "Changed";
  sourceLinks.length = 0;

  assert.deepEqual(artifact.counts, {
    matched: 2,
    returned: 1,
    excluded: 1,
  });
  assert.deepEqual(artifact.filters, [{ label: "Status", value: "Open" }]);
  assert.deepEqual(artifact.exclusions, [{ reason: "Completed", count: 1 }]);
  assert.equal(artifact.items[0].label, "Task");
  assert.equal(artifact.items[0].facts[0].value, "Aug 27, 2026");
  assert.deepEqual(artifact.sourceLinks, [link]);
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(Object.isFrozen(artifact.items[0].facts), true);
});
