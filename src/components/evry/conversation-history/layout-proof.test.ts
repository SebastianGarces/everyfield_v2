import assert from "node:assert/strict";
import { test } from "node:test";

import { proveEvryHistoryNewControlLayout } from "./layout-proof";

function rect(left: number, top: number, right: number, bottom: number) {
  return { bottom, left, right, top } as DOMRect;
}

function proofDocument(input: {
  control: DOMRect;
  pane: DOMRect;
  covered?: boolean;
}): Document {
  const control = {
    contains: (candidate: unknown) => candidate === control,
    getBoundingClientRect: () => input.control,
  };
  const pane = { getBoundingClientRect: () => input.pane };
  return {
    elementFromPoint: () => (input.covered ? pane : control),
    querySelector: (selector: string) =>
      selector.includes("pane-content") ? pane : control,
  } as unknown as Document;
}

test("the browser layout proof accepts a fully exposed New target", () => {
  const evidence = proveEvryHistoryNewControlLayout(
    proofDocument({
      control: rect(240, 20, 320, 52),
      pane: rect(0, 0, 336, 720),
    })
  );
  assert.equal(evidence.hitPointCount, 5);
  assert.equal(evidence.control.right, 320);
});

test("the browser layout proof rejects overflow and sibling paint overlap", () => {
  assert.throws(
    () =>
      proveEvryHistoryNewControlLayout(
        proofDocument({
          control: rect(300, 20, 380, 52),
          pane: rect(0, 0, 336, 720),
        })
      ),
    /extends outside/
  );
  assert.throws(
    () =>
      proveEvryHistoryNewControlLayout(
        proofDocument({
          control: rect(240, 20, 320, 52),
          covered: true,
          pane: rect(0, 0, 336, 720),
        })
      ),
    /covered by another hit target/
  );
});
