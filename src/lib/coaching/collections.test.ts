import assert from "node:assert/strict";
import test from "node:test";
import { parseCoachedCollection, parseCoachedPage } from "./collections";

test("only the four assigned-coach record collections are routable", () => {
  for (const name of ["people", "tasks", "meetings", "teams"])
    assert.equal(parseCoachedCollection(name), name);
  for (const name of [
    "check-ins",
    "users",
    "constructor",
    "__proto__",
    "",
    "PEOPLE",
  ])
    assert.equal(parseCoachedCollection(name), null);
});
test("pagination accepts whole pages and refuses ambiguous or overflowing input", () => {
  assert.equal(parseCoachedPage(undefined), 1);
  assert.equal(parseCoachedPage("3"), 3);
  for (const value of [
    "0",
    "-1",
    "01",
    "1.5",
    "1e2",
    " 2",
    "Infinity",
    "9999999999999999999",
    ["1", "2"],
  ])
    assert.equal(parseCoachedPage(value), null);
});
