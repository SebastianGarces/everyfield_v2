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
  assert.match(html, /class="[^"]*overscroll-x-none[^"]*test-canvas/);
  assert.match(html, /class="[^"]*overscroll-y-none[^"]*test-canvas/);
  assert.match(html, /data-scroll-layout="fixed"/);
  assert.match(html, /data-slot="split-workspace"/);
  assert.match(html, /class="[^"]*grid[^"]*test-split/);
  assert.match(html, /data-slot="workspace-panel"/);
  assert.match(html, /class="[^"]*rounded-xl[^"]*test-panel/);
  assert.match(html, />Workspace<\/div>/);
});

test("flow layout grows long pages and fills short direct workspaces", () => {
  const html = renderToStaticMarkup(
    createElement(
      PageCanvas,
      { context: "none", scrollLayout: "flow" },
      createElement(WorkspacePanel, { className: "min-h-full" }, "Long page")
    )
  );

  const hierarchyClass = html.match(
    /data-slot="page-hierarchy-frame"[^>]*class="([^"]*)"/
  )?.[1];
  const contentClass = html.match(
    /data-slot="page-content"[^>]*class="([^"]*)"/
  )?.[1];

  assert.equal(
    html.includes('data-scroll-layout="flow"'),
    true,
    "the rendered contract must expose the selected scroll layout"
  );
  assert.ok(hierarchyClass, "the hierarchy frame must render its classes");
  assert.match(hierarchyClass, /(?:^| )min-h-full(?: |$)/);
  assert.doesNotMatch(
    hierarchyClass,
    /(?:^| )h-full(?: |$)/,
    "a flow hierarchy must be allowed to grow beyond the viewport"
  );
  assert.ok(contentClass, "the page content must render its classes");
  assert.match(contentClass, /(?:^| )flex-1(?: |$)/);
  assert.match(contentClass, /(?:^| )flex(?: |$)/);
  assert.match(contentClass, /(?:^| )flex-col(?: |$)/);
  assert.match(
    contentClass,
    /\[&amp;&gt;\[data-slot=workspace-panel\]:only-child\]:flex-1/,
    "a short direct workspace must consume the flow content's remaining height"
  );
  assert.doesNotMatch(
    contentClass,
    /(?:^| )min-h-0(?: |$)/,
    "flow content must contribute its intrinsic height to the hierarchy"
  );
});

test("fixed layout preserves definite height for descendant scroll owners", () => {
  const html = renderToStaticMarkup(
    createElement(PageCanvas, { context: "none" }, "Fixed workspace")
  );

  const hierarchyClass = html.match(
    /data-slot="page-hierarchy-frame"[^>]*class="([^"]*)"/
  )?.[1];
  const contentClass = html.match(
    /data-slot="page-content"[^>]*class="([^"]*)"/
  )?.[1];

  assert.ok(hierarchyClass, "the hierarchy frame must render its classes");
  assert.match(hierarchyClass, /(?:^| )h-full(?: |$)/);
  assert.match(hierarchyClass, /(?:^| )min-h-full(?: |$)/);
  assert.ok(contentClass, "the page content must render its classes");
  assert.match(contentClass, /(?:^| )min-h-0(?: |$)/);
  assert.doesNotMatch(
    contentClass,
    /\[&amp;&gt;\[data-slot=workspace-panel\]:only-child\]:flex-1/,
    "fixed workspaces keep their existing descendant-owned scroll contract"
  );
});

test("flow layout does not stretch one panel among sibling surfaces", () => {
  const html = renderToStaticMarkup(
    createElement(
      PageCanvas,
      { context: "none", scrollLayout: "flow" },
      createElement(WorkspacePanel, null, "Summary"),
      createElement("section", null, "Activity")
    )
  );
  const contentClass = html.match(
    /data-slot="page-content"[^>]*class="([^"]*)"/
  )?.[1];

  assert.ok(contentClass, "the page content must render its classes");
  assert.match(
    contentClass,
    /\[&amp;&gt;\[data-slot=workspace-panel\]:only-child\]:flex-1/,
    "fill must require the workspace to be the content's only rendered child"
  );
  assert.doesNotMatch(
    contentClass,
    /\[&amp;&gt;\[data-slot=workspace-panel\]\]:flex-1(?: |$)/,
    "a multi-surface flow must not give one panel all remaining height"
  );
  assert.match(html, />Summary<\/div><section>Activity<\/section>/);
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
