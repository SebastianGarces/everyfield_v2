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

test("Wiki route roots keep the complete article inset when scrolled into view", () => {
  const contentWrapper = LAYOUT.match(
    /<div className="([^"]*)">\s*\{children\}\s*<\/div>/
  );
  assert.ok(contentWrapper, "the article content wrapper must remain explicit");

  const classes = contentWrapper[1].split(" ");
  for (const [padding, routeMargin] of [
    ["py-8", "[&>*]:scroll-mt-8"],
    ["sm:py-10", "sm:[&>*]:scroll-mt-10"],
  ] as const) {
    assert.equal(classes.includes(padding), true);
    assert.equal(
      classes.includes(routeMargin),
      true,
      `${routeMargin} must match ${padding} so Next scrolls the new route to scrollTop 0`
    );
  }
});

test("both Wiki panes contain vertical and horizontal boundary gestures", () => {
  const navigationPane = LAYOUT.match(/<aside className="([^"]*)">/);
  const articlePane = LAYOUT.match(
    /<WorkspacePanel\s+id=\{DASHBOARD_PAGE_CONTENT_ID\}[\s\S]*?className="([^"]*)"/
  );
  assert.ok(navigationPane, "the Wiki navigation pane must remain explicit");
  assert.ok(articlePane, "the Wiki article pane must remain explicit");

  for (const [label, classes] of [
    ["navigation", navigationPane[1]],
    ["article", articlePane[1]],
  ] as const) {
    assert.match(classes, /(?:^| )overflow-y-auto(?: |$)/);
    assert.match(classes, /(?:^| )overscroll-x-none(?: |$)/);
    assert.match(classes, /(?:^| )overscroll-y-none(?: |$)/);
    assert.doesNotMatch(
      classes,
      /(?:^| )overflow-x-(?:hidden|clip)(?: |$)/,
      `${label} pane must not hide horizontal overflow`
    );
  }
});
