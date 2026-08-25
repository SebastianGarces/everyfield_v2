import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PageCanvas } from "@/components/layout/page-frame";

const LAYOUT = readFileSync(join(__dirname, "layout.tsx"), "utf8");

test("Wiki clips its canvas without making it a route-transition scroll owner", () => {
  assert.match(
    LAYOUT,
    /<PageCanvas(?=[^>]*className="overflow-clip")(?=[^>]*contentClassName="h-full")(?=[^>]*context="none")[^>]*>/,
    "the persistent Wiki canvas must clip while its two panes own scrolling"
  );
  assert.doesNotMatch(
    LAYOUT,
    /<PageCanvas[^>]*className="overflow-hidden"/,
    "overflow-hidden remains programmatically scrollable across nested route transitions"
  );

  const html = renderToStaticMarkup(
    createElement(
      PageCanvas,
      {
        className: "overflow-clip",
        contentClassName: "h-full",
        context: "none",
      },
      "Wiki panes"
    )
  );
  const canvas = html.match(/<div data-slot="page-canvas" class="([^"]*)"/);
  assert.ok(canvas, "PageCanvas must render its canvas slot");

  const classes = canvas[1].split(" ");
  assert.equal(classes.includes("overflow-clip"), true);
  assert.equal(classes.includes("overflow-auto"), false);
  assert.equal(classes.includes("overflow-hidden"), false);
});
