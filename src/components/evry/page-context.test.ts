import assert from "node:assert/strict";
import { test } from "node:test";

import { visibleEvryPageContextFor } from "./page-context";

test("record pages produce a visible label and a strict minimal wire hint", () => {
  assert.deepEqual(
    visibleEvryPageContextFor("/people/person-1", [
      { label: "People & CRM", href: "/people" },
      { label: "Alex Rivera" },
    ]),
    {
      key: "person:person-1",
      label: "Alex Rivera",
      wire: { kind: "person", recordId: "person-1" },
    }
  );
  assert.equal(
    JSON.stringify(
      visibleEvryPageContextFor("/people/person-1", [
        { label: "Browser-owned label" },
      ])?.wire
    ).includes("Browser-owned label"),
    false,
    "display labels must never cross the request boundary"
  );

  for (const [pathname, kind] of [
    ["/meetings/meeting-1", "meeting"],
    ["/teams/team-1", "team"],
    ["/tasks/task-1", "task"],
  ] as const) {
    const context = visibleEvryPageContextFor(pathname, []);
    assert.equal(context?.wire.kind, kind);
    assert.equal(context?.wire.recordId, pathname.split("/").at(-1));
    assert.deepEqual(Object.keys(context?.wire ?? {}).sort(), [
      "kind",
      "recordId",
    ]);
  }
});

test("singleton records use server-resolved current hints and list/create routes carry none", () => {
  assert.deepEqual(visibleEvryPageContextFor("/launch", []), {
    key: "launch:current",
    label: "Launch",
    wire: { kind: "launch", recordId: "current" },
  });
  assert.deepEqual(visibleEvryPageContextFor("/phase", []), {
    key: "plant_intelligence:current",
    label: "Plant Intelligence",
    wire: { kind: "plant_intelligence", recordId: "current" },
  });

  for (const pathname of [
    "/people",
    "/people/new",
    "/meetings",
    "/meetings/new",
    "/tasks/templates",
    "/teams/org-chart",
    "/evry",
  ]) {
    assert.equal(visibleEvryPageContextFor(pathname, []), null, pathname);
  }
});
