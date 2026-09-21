import assert from "node:assert/strict";
import { test } from "node:test";
import { assertMailDelta } from "./discovery-preview-294-mail.mjs";

const expected = ["account", "owner"].map((id) => ({
  to: [`${id}@example.invalid`],
  subject: "Discovery association accepted",
  idempotencyKey: `key-${id}`,
}));
const receipts = expected.map((item, id) => ({
  ...item,
  id: String(id),
  method: "POST",
  path: "/emails",
  accepted: true,
  bodySha256: "a".repeat(64),
}));
test("captured mail matches both exact recipients and occurrence keys", () => {
  assertMailDelta([...receipts].reverse(), expected);
});
test("missing, extra, duplicate, refused or misdirected capture cannot pass", () => {
  for (const bad of [
    receipts.slice(1),
    [...receipts, receipts[0]],
    [receipts[0], { ...receipts[1], id: receipts[0].id }],
    [receipts[0], { ...receipts[1], to: ["foreign@example.invalid"] }],
    [
      receipts[0],
      { ...receipts[1], idempotencyKey: receipts[0].idempotencyKey },
    ],
    [receipts[0], { ...receipts[1], subject: "Wrong event" }],
    [receipts[0], { ...receipts[1], accepted: false }],
    [receipts[0], { ...receipts[1], path: "/batch" }],
  ])
    assert.throws(() => assertMailDelta(bad, expected));
});
