import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EvryContextChip } from "./conversation-surface";

test("the visible page context chip names its source and offers removal", () => {
  const html = renderToStaticMarkup(
    createElement(EvryContextChip, {
      context: {
        key: "person:person-1",
        label: "Alex Rivera",
        wire: { kind: "person", recordId: "person-1" },
      },
      onRemove() {},
    })
  );

  assert.match(html, /aria-label="Page context"/);
  assert.match(html, />Alex Rivera</);
  assert.match(html, /aria-label="Remove Alex Rivera context"/);
  assert.match(html, /<button[^>]*type="button"/);
});
