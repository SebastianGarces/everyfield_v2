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
const PRIMARY_PRESENTATION_ROOTS = [
  "dashboard/no-plant-empty-state.tsx",
  "dashboard/plant-dashboard.tsx",
  "phase/page.tsx",
  "launch/page.tsx",
  "tasks/page.tsx",
  "tasks/new/page.tsx",
  "tasks/templates/page.tsx",
  "people/page.tsx",
  "people/new/page.tsx",
  "meetings/page.tsx",
  "meetings/new/page.tsx",
  "teams/page.tsx",
  "teams/health/page.tsx",
  "teams/org-chart/page.tsx",
  "documents/page.tsx",
  "communication/page.tsx",
  "notifications/page.tsx",
  "oversight/page.tsx",
  "oversight/plants/page.tsx",
  "oversight/health/page.tsx",
  "oversight/invitations/page.tsx",
  "oversight/sending-churches/page.tsx",
  "admin/feedback/page.tsx",
  "verify-email/page.tsx",
  "verify-email/confirmed/page.tsx",
] as const;

const DASHBOARD_ROOT = join(process.cwd(), "src/app/(dashboard)");

const FIXED_WORKSPACE_ROOTS = [
  "meetings/page.tsx",
  "teams/page.tsx",
  "teams/health/page.tsx",
  "teams/org-chart/page.tsx",
  "documents/page.tsx",
  "communication/page.tsx",
] as const;

const CANVAS_SCROLL_ROOTS = ["tasks/page.tsx"] as const;
const ROUTE_PRESENTATION_ROOTS = PRIMARY_PRESENTATION_ROOTS.filter(
  (relativePath) => !relativePath.startsWith("dashboard/")
);
const SIBLING_SURFACE_ROOTS = ["phase/page.tsx"] as const;
const SINGLE_WORKSPACE_ROOTS = PRIMARY_PRESENTATION_ROOTS.filter(
  (relativePath) =>
    !SIBLING_SURFACE_ROOTS.includes(
      relativePath as (typeof SIBLING_SURFACE_ROOTS)[number]
    )
);

test("every Stage 3 presentation root declares its canvas composition", () => {
  for (const relativePath of PRIMARY_PRESENTATION_ROOTS) {
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
  }

  for (const relativePath of SINGLE_WORKSPACE_ROOTS) {
    const source = readFileSync(join(DASHBOARD_ROOT, relativePath), "utf8");
    assert.match(
      source,
      /<WorkspacePanel(?:\s|>)/,
      `${relativePath} is classified as one primary workspace`
    );
  }

  const phase = readFileSync(join(DASHBOARD_ROOT, "phase/page.tsx"), "utf8");
  assert.doesNotMatch(
    phase,
    /WorkspacePanel/,
    "Plant Intelligence is classified as sibling feature surfaces, not one false outer card"
  );
  assert.match(phase, /data-slot="plant-intelligence-content"/);
});

test("list workspaces have one intentional scrolling content region", () => {
  for (const relativePath of FIXED_WORKSPACE_ROOTS) {
    const source = readFileSync(join(DASHBOARD_ROOT, relativePath), "utf8");

    assert.match(
      source,
      /<PageCanvas className="overflow-hidden">/,
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
      /<PageCanvas>/,
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
    /<PageCanvas className=\{isPipelineView \? "overflow-hidden" : undefined\}>/,
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
      "suppressSingleCrumb",
      "id={DASHBOARD_PAGE_CONTENT_ID}",
      "tabIndex={-1}",
    ],
    "the settings focus target must follow Phase's manually placed context"
  );
});
