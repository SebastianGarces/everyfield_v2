import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PageCanvas, SplitWorkspace, WorkspacePanel } from "./page-frame";

test("page-frame primitives contain presentation only and preserve caller props", () => {
  const html = renderToStaticMarkup(
    createElement(
      PageCanvas,
      { "aria-label": "Dashboard canvas", className: "test-canvas" },
      createElement(
        SplitWorkspace,
        { className: "test-split" },
        createElement(WorkspacePanel, { className: "test-panel" }, "Workspace")
      )
    )
  );

  assert.match(html, /data-slot="page-canvas"/);
  assert.match(html, /aria-label="Dashboard canvas"/);
  assert.match(html, /class="[^"]*h-full[^"]*overflow-auto[^"]*test-canvas/);
  assert.match(html, /data-slot="split-workspace"/);
  assert.match(html, /class="[^"]*grid[^"]*test-split/);
  assert.match(html, /data-slot="workspace-panel"/);
  assert.match(html, /class="[^"]*rounded-xl[^"]*test-panel/);
  assert.match(html, />Workspace<\/div>/);
});

test("caller classes override presentation defaults through the shared merger", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspacePanel, { className: "rounded-none shadow-none" })
  );

  assert.match(html, /rounded-none/);
  assert.match(html, /shadow-none/);
  assert.doesNotMatch(html, /rounded-xl/);
  assert.doesNotMatch(html, /shadow-sm/);
});
