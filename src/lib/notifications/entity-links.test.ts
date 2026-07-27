import assert from "node:assert/strict";
import { test } from "node:test";

import { notificationEntityTypes } from "@/db/schema";
import { notificationEntityHref } from "./entity-links";

// ----------------------------------------------------------------------------
// Where a feed row points (N-008, Screen 1): "a link to the referenced entity
// WHERE ONE EXISTS, and no dead link where none does".
// ----------------------------------------------------------------------------

const ID = "11111111-2222-3333-4444-555555555555";

test("an entity with a screen resolves to its route", () => {
  const cases: [Parameters<typeof notificationEntityHref>[0], string][] = [
    ["task", `/tasks/${ID}`],
    ["meeting", `/meetings/${ID}`],
    ["person", `/people/${ID}`],
    ["message", `/communication/${ID}`],
    ["ministry_team", `/teams/${ID}`],
  ];

  for (const [entityType, expected] of cases) {
    assert.equal(
      notificationEntityHref(entityType, ID),
      expected,
      `${entityType}`
    );
  }
});

test("an entity whose screen is a single page ignores the id", () => {
  // Plant intelligence is one latest-snapshot screen, not a page per run.
  assert.equal(notificationEntityHref("phase_assessment", ID), "/phase");
});

test("an entity with no screen yields no link at all", () => {
  // `notificationEntityTypes` is deliberately ahead of the product. Building
  // `/facilities/<id>` for a screen that does not exist would ship a row whose
  // link 404s, and a user cannot tell "this went nowhere" from "I clicked the
  // wrong thing" — so the row renders as plain text instead, still carrying its
  // title, body and timestamp.
  for (const entityType of [
    "training",
    "document",
    "facility",
    "financial_entry",
  ] as const) {
    assert.equal(notificationEntityHref(entityType, ID), null, entityType);
  }
});

test("a notification about nothing links to nothing", () => {
  assert.equal(notificationEntityHref(null, null), null);
  // Half a reference is not a link: the enqueue schema refuses to write one,
  // and this refuses to render one if a row ever holds it.
  assert.equal(notificationEntityHref("task", null), null);
  assert.equal(notificationEntityHref(null, ID), null);
});

test("every declared entity type has a decided answer", () => {
  // The lookup is an exhaustive `Record`, so adding an entity type without
  // deciding whether it links is a compile error rather than an `undefined`
  // that renders as `/undefined/<id>`. This asserts the runtime half: no type
  // in the tuple throws or produces a path with a hole in it.
  for (const entityType of notificationEntityTypes) {
    const href = notificationEntityHref(entityType, ID);
    if (href === null) continue;

    assert.ok(href.startsWith("/"), entityType);
    assert.doesNotMatch(href, /undefined|:id|\/\//, entityType);
  }
});
