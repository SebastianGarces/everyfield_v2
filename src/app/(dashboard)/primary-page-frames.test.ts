import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { assertInOrder } from "@/lib/testing/source-span";

/**
 * Stage 3's complete presentation-root inventory.
 *
 * Detail routes, tabs, editors, wiki, onboarding internals, communication
 * compose/history/templates, and document history belong to the specialized
 * Stage 4 sweep and are deliberately absent. `/coaching` has no index route;
 * its only route is the plant detail workspace owned by Stage 4.
 */
type PrimaryComposition =
  | "attached-workspace"
  | "context-free-workspace"
  | "context-free-siblings"
  | "dashboard-hybrid"
  | "manual-standalone";

/**
 * The canonical route-to-composition inventory for authenticated primary
 * surfaces. Each entry names one ruled hierarchy rather than accepting any
 * PageCanvas/WorkspacePanel combination that happens to compile.
 */
const PRIMARY_PRESENTATION_ROOTS = [
  ["dashboard/no-plant-empty-state.tsx", "context-free-workspace"],
  ["dashboard/plant-dashboard.tsx", "dashboard-hybrid"],
  ["phase/page.tsx", "manual-standalone"],
  ["launch/page.tsx", "context-free-siblings"],
  ["tasks/page.tsx", "attached-workspace"],
  ["tasks/new/page.tsx", "attached-workspace"],
  ["tasks/templates/page.tsx", "attached-workspace"],
  ["people/page.tsx", "context-free-workspace"],
  ["people/new/page.tsx", "attached-workspace"],
  ["meetings/page.tsx", "context-free-workspace"],
  ["meetings/new/page.tsx", "attached-workspace"],
  ["teams/page.tsx", "context-free-workspace"],
  ["teams/health/page.tsx", "attached-workspace"],
  ["teams/org-chart/page.tsx", "attached-workspace"],
  ["documents/page.tsx", "attached-workspace"],
  ["communication/page.tsx", "context-free-siblings"],
  ["notifications/page.tsx", "context-free-workspace"],
  ["oversight/page.tsx", "context-free-siblings"],
  ["oversight/plants/page.tsx", "context-free-siblings"],
  ["oversight/health/page.tsx", "context-free-siblings"],
  ["oversight/invitations/page.tsx", "context-free-siblings"],
  ["oversight/sending-churches/page.tsx", "context-free-siblings"],
  ["admin/feedback/page.tsx", "attached-workspace"],
  ["verify-email/page.tsx", "context-free-workspace"],
  ["verify-email/confirmed/page.tsx", "context-free-workspace"],
] as const satisfies readonly (readonly [string, PrimaryComposition])[];

const DASHBOARD_ROOT = join(process.cwd(), "src/app/(dashboard)");

const FIXED_WORKSPACE_ROOTS = [
  "meetings/page.tsx",
  "teams/page.tsx",
  "teams/health/page.tsx",
  "teams/org-chart/page.tsx",
  "documents/page.tsx",
] as const;

const CANVAS_SCROLL_ROOTS = ["tasks/page.tsx"] as const;
const ROUTE_PRESENTATION_ROOTS = PRIMARY_PRESENTATION_ROOTS.map(
  ([relativePath]) => relativePath
).filter((relativePath) => !relativePath.startsWith("dashboard/"));

function assertComposition(
  relativePath: string,
  composition: PrimaryComposition,
  source: string
) {
  switch (composition) {
    case "attached-workspace":
      assert.match(source, /contextAttachment="attached"/);
      assert.match(source, /contextItems=\{/);
      assert.match(source, /<WorkspacePanel(?:\s|>)/);
      break;
    case "context-free-workspace":
      assert.match(
        source,
        /<PageCanvas[\s\S]*?context="none"[\s\S]*?contentFocusTarget[\s\S]*?>/
      );
      assert.match(source, /<WorkspacePanel(?:\s|>)/);
      assert.doesNotMatch(source, /PageContext/);
      break;
    case "context-free-siblings":
      assert.match(
        source,
        /<PageCanvas[\s\S]*?context="none"[\s\S]*?contentFocusTarget[\s\S]*?>/
      );
      assert.doesNotMatch(
        source,
        /<WorkspacePanel(?:\s|>)/,
        `${relativePath} must not wrap sibling surfaces in a false outer workspace`
      );
      assert.doesNotMatch(source, /PageContext/);
      break;
    case "manual-standalone":
      assert.match(source, /<PageCanvas[\s\S]*?context="none"/);
      assert.match(source, /<PageContext(?:\s|>)/);
      assert.doesNotMatch(source, /WorkspacePanel/);
      assert.doesNotMatch(source, /contextAttachment|attachment="attached"/);
      break;
    case "dashboard-hybrid":
      // The leadership re-entry branch is one focused workspace; the completed
      // dashboard is an unboxed identity followed by sibling cards.
      assert.match(source, /<PageCanvas context="none" contentFocusTarget>/);
      assert.match(source, /data-slot="completed-dashboard-content"/);
      break;
  }
}

test("every Stage 3 presentation root declares its ruled canvas composition", () => {
  for (const [relativePath, composition] of PRIMARY_PRESENTATION_ROOTS) {
    const source = readFileSync(join(DASHBOARD_ROOT, relativePath), "utf8");

    assert.match(
      source,
      /<PageCanvas(?:\s|>)/,
      `${relativePath} needs a canvas`
    );
    assert.doesNotMatch(
      source,
      /SplitWorkspace/,
      `${relativePath} is a primary route, not a specialized split workspace`
    );
    assertComposition(relativePath, composition, source);
  }
});

test("list workspaces have one intentional scrolling content region", () => {
  for (const relativePath of FIXED_WORKSPACE_ROOTS) {
    const source = readFileSync(join(DASHBOARD_ROOT, relativePath), "utf8");

    assert.match(
      source,
      /<PageCanvas[\s\S]*?className="overflow-hidden"[\s\S]*?>/,
      `${relativePath} must keep the canvas fixed around its list`
    );
    assert.match(
      source,
      /<WorkspacePanel className="flex h-full flex-col overflow-hidden">/,
      `${relativePath} must constrain its list to the workspace panel`
    );
    assert.match(
      source,
      /className="min-h-0 flex-1[^"]*overflow-auto[^"]*"/,
      `${relativePath} must make the list body the scroll owner`
    );
    assert.doesNotMatch(
      source,
      /className="bg-card[^"]*shadow-sm"/,
      `${relativePath} must not recreate a second outer page surface`
    );
  }
});

test("tall action and filter headers scroll with their content", () => {
  for (const relativePath of CANVAS_SCROLL_ROOTS) {
    const source = readFileSync(join(DASHBOARD_ROOT, relativePath), "utf8");

    assert.match(
      source,
      /<PageCanvas[\s\S]*?contextAttachment="attached"[\s\S]*?contextItems=\{breadcrumbs\}[\s\S]*?>/,
      `${relativePath} must leave vertical scrolling with the canvas`
    );
    assert.match(
      source,
      /<WorkspacePanel className="flex min-h-full flex-col overflow-hidden">/,
      `${relativePath} must grow beyond a short viewport rather than clip`
    );
    assert.doesNotMatch(
      source,
      /className="[^"]*flex-1[^"]*overflow-auto[^"]*"/,
      `${relativePath} must not isolate the list below an unreachable header`
    );
  }
});

test("people keeps list headers in canvas flow and bounds pipeline column scrolling", () => {
  const page = readFileSync(join(DASHBOARD_ROOT, "people/page.tsx"), "utf8");
  const pipeline = readFileSync(
    join(process.cwd(), "src/components/people/pipeline-view.tsx"),
    "utf8"
  );
  const column = readFileSync(
    join(process.cwd(), "src/components/people/pipeline-column.tsx"),
    "utf8"
  );

  assert.match(
    page,
    /<PageCanvas[\s\S]*?className=\{isPipelineView \? "overflow-hidden" : undefined\}[\s\S]*?context="none"[\s\S]*?contentFocusTarget[\s\S]*?>/,
    "only the pipeline view fixes the canvas around the board"
  );
  assert.match(
    page,
    /isPipelineView\s*\? "flex h-full flex-col overflow-hidden"\s*: "flex min-h-full flex-col overflow-hidden"/,
    "the pipeline needs a definite-height panel while the list may grow with its header"
  );
  assert.match(
    page,
    /isPipelineView\s*\? "min-h-0 min-w-0 flex-1 overflow-hidden p-4 sm:p-6"\s*: "min-w-0 p-4 sm:p-6"/,
    "the pipeline body must be the bounded min-height track below the reachable header"
  );
  assert.match(
    page,
    /className="shrink-0 space-y-6 border-b p-4 sm:p-6 sm:pb-4"/,
    "the pipeline header must keep its full content height above the bounded board"
  );
  assert.match(pipeline, /className="flex h-full gap-4 overflow-x-auto/);
  assert.match(column, /flex h-full[^"\n]*flex-col/);
  assert.match(column, /flex flex-1 flex-col[^"\n]*overflow-y-auto/);
});

test("every primary route declares page context and phase names Plant Intelligence", () => {
  for (const relativePath of ROUTE_PRESENTATION_ROOTS) {
    const source = readFileSync(join(DASHBOARD_ROOT, relativePath), "utf8");

    assert.match(
      source,
      /<HeaderBreadcrumbs(?:\s|>)/,
      `${relativePath} must replace the shell's Dashboard fallback`
    );
  }

  const phase = readFileSync(join(DASHBOARD_ROOT, "phase/page.tsx"), "utf8");
  assertInOrder(
    phase,
    "phase/page.tsx",
    [
      "<HeaderBreadcrumbs items={PHASE_BREADCRUMBS} />",
      "<PageCanvas",
      "<PageContext",
    ],
    "phase context must be declared before its canvas"
  );
  assertInOrder(
    phase,
    "phase/page.tsx",
    [
      "items={PHASE_BREADCRUMBS}",
      "id={DASHBOARD_PAGE_CONTENT_ID}",
      "tabIndex={-1}",
    ],
    "the settings focus target must follow Phase's manually placed context"
  );
  assert.match(
    phase,
    /<header>\s*<PageContext className="mb-2" items=\{PHASE_BREADCRUMBS\} \/>/,
    "Plant Intelligence keeps the ruled compact, unboxed context above its title"
  );
  assert.doesNotMatch(phase, /contextAttachment|attachment="attached"/);
});

test("Dashboard suppresses its redundant context without losing the settings focus target", () => {
  for (const relativePath of [
    "dashboard/no-plant-empty-state.tsx",
    "dashboard/onboarding-dashboard.tsx",
    "dashboard/plant-dashboard.tsx",
  ]) {
    const source = readFileSync(join(DASHBOARD_ROOT, relativePath), "utf8");
    const canvases = source.match(/<PageCanvas(?:\s|>)/g) ?? [];
    const suppressed =
      source.match(/<PageCanvas context="none" contentFocusTarget>/g) ?? [];

    assert.ok(canvases.length > 0, `${relativePath} must render a canvas`);
    assert.equal(
      suppressed.length,
      canvases.length,
      `${relativePath} must suppress every redundant Dashboard context row while preserving the post-Settings focus target`
    );
    assert.doesNotMatch(source, /PageContext/);
  }
});
