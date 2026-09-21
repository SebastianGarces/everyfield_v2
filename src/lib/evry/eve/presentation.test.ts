import assert from "node:assert/strict";
import { test } from "node:test";
import { eveResultMarker, splitEveResponse } from "./presentation";

test("every split of a result marker waits without exposing its reference", () => {
  const marker = eveResultMarker("call:people/1");
  const before = "Here are the people.\n\n";
  for (let length = 1; length < marker.length; length++) {
    assert.deepEqual(
      splitEveResponse(before + marker.slice(0, length), false),
      [{ kind: "text", text: before, offset: 0 }],
      `split ${length}`
    );
  }
  assert.deepEqual(
    splitEveResponse(
      before + marker + "\n\nTheir interviews are pending.",
      true
    ).map((part) => part.kind),
    ["text", "result", "text"]
  );
  assert.equal(splitEveResponse(marker, true)[0]?.kind, "result");
});

test("malformed and unfinished completed references fail without printing internal syntax", () => {
  for (const marker of [
    "[[evry-result:%no]]",
    "[[evry-result:]]",
    "[[evry-result:unfinished",
  ]) {
    assert.deepEqual(splitEveResponse(marker, true), [
      { kind: "unavailable", offset: 0 },
    ]);
  }
  assert.deepEqual(
    splitEveResponse("A normal [link](https://example.test).", true),
    [
      {
        kind: "text",
        text: "A normal [link](https://example.test).",
        offset: 0,
      },
    ]
  );
});
