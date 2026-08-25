import assert from "node:assert/strict";
import { test } from "node:test";

import { sidebarDefaultOpen } from "./sidebar-preference";

test("the sidebar begins expanded before a preference exists", () => {
  assert.equal(sidebarDefaultOpen(undefined), true);
});

test("both persisted sidebar choices remain authoritative", () => {
  assert.equal(sidebarDefaultOpen("true"), true);
  assert.equal(sidebarDefaultOpen("false"), false);
});

test("a malformed preference does not invent an expanded choice", () => {
  assert.equal(sidebarDefaultOpen("unexpected"), false);
});
