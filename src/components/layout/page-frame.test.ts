import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeaderProvider } from "@/components/header";

import { PageCanvas, SplitWorkspace, WorkspacePanel } from "./page-frame";

test("page-frame primitives contain presentation only and preserve caller props", () => {
  const html = renderToStaticMarkup(
    createElement(
      HeaderProvider,
      null,
      createElement(
        PageCanvas,
        { "aria-label": "Dashboard canvas", className: "test-canvas" },
        createElement(
          SplitWorkspace,
          { className: "test-split" },
          createElement(
            WorkspacePanel,
            { className: "test-panel" },
            "Workspace"
          )
        )
      )
    )
  );

  assert.match(html, /data-slot="page-canvas"/);
  assert.match(html, /data-slot="page-hierarchy-frame"/);
  assert.match(html, /data-slot="page-content"/);
  assert.match(html, /id="dashboard-page-content"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /data-attachment="standalone"/);
  assert.doesNotMatch(html, /rounded-t-none/);
  assert.match(html, /aria-label="Dashboard canvas"/);
  assert.match(html, /class="[^"]*h-full[^"]*overflow-auto[^"]*test-canvas/);
  assert.match(html, /class="[^"]*overscroll-y-none[^"]*test-canvas/);
  assert.match(html, /data-slot="split-workspace"/);
  assert.match(html, /class="[^"]*grid[^"]*test-split/);
  assert.match(html, /data-slot="workspace-panel"/);
  assert.match(html, /class="[^"]*rounded-xl[^"]*test-panel/);
  assert.match(html, />Workspace<\/div>/);
});

test("only an explicitly attached context removes the workspace's top seam", () => {
  const html = renderToStaticMarkup(
    createElement(
      HeaderProvider,
      null,
      createElement(
        PageCanvas,
        { contextAttachment: "attached" },
        createElement(WorkspacePanel, null, "Attached workspace")
      )
    )
  );

  assert.match(html, /data-attachment="attached"/);
  assert.match(html, /rounded-t-none/);
  assert.match(html, /border-t-0/);
  assert.match(html, /bg-card/);
  assert.match(html, /min-h-14/);
});

test("attached context renders its server-known breadcrumb geometry in SSR", () => {
  const multiCrumbHtml = renderToStaticMarkup(
    createElement(
      HeaderProvider,
      null,
      createElement(PageCanvas, {
        contextAttachment: "attached",
        contextItems: [
          { label: "Communication", href: "/communication" },
          { label: "Message History" },
        ],
      })
    )
  );
  const oneCrumbHtml = renderToStaticMarkup(
    createElement(
      HeaderProvider,
      null,
      createElement(PageCanvas, {
        contextAttachment: "attached",
        contextItems: [{ label: "Wiki" }],
      })
    )
  );

  assert.match(multiCrumbHtml, /data-breadcrumb-depth="2"/);
  assert.match(multiCrumbHtml, />Communication<\/a>/);
  assert.match(multiCrumbHtml, />Message History<\/span>/);
  assert.match(oneCrumbHtml, /data-breadcrumb-depth="1"/);
  assert.match(oneCrumbHtml, />Wiki<\/span>/);
  assert.doesNotMatch(oneCrumbHtml, />Dashboard<\/span>/);
});

test("the canvas can delegate context placement to a specialized split workspace", () => {
  const html = renderToStaticMarkup(
    createElement(
      PageCanvas,
      { contentClassName: "h-full", context: "none" },
      createElement(SplitWorkspace, null, "Specialized workspace")
    )
  );

  assert.doesNotMatch(html, /data-slot="page-context"/);
  assert.doesNotMatch(
    html,
    /id="dashboard-page-content"/,
    "a specialized composition must place the focus target after its own context"
  );
  assert.match(
    html,
    /data-slot="page-content" class="[^"]*h-full[^"]*"/,
    "a size-contained specialized grid can receive a definite block size from its PageCanvas wrapper"
  );
  assert.match(html, /data-slot="split-workspace"/);
  assert.match(html, />Specialized workspace<\/div>/);
});

test("a context-free Dashboard canvas can retain the shared focus target", () => {
  const html = renderToStaticMarkup(
    createElement(
      PageCanvas,
      { contentFocusTarget: true, context: "none" },
      "Dashboard workspace"
    )
  );

  assert.doesNotMatch(html, /data-slot="page-context"/);
  assert.match(html, /id="dashboard-page-content"/);
  assert.match(html, /tabindex="-1"/);
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
