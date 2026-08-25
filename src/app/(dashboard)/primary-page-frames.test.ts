import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

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

const CANVAS_SCROLL_ROOTS = ["tasks/page.tsx", "people/page.tsx"] as const;

test("every Stage 3 presentation root composes the shared canvas and workspace panel", () => {
  for (const relativePath of PRIMARY_PRESENTATION_ROOTS) {
    const source = readFileSync(join(DASHBOARD_ROOT, relativePath), "utf8");

    assert.match(
      source,
      /import \{ PageCanvas, WorkspacePanel \} from "@\/components\/layout\/page-frame";/,
      `${relativePath} must use the shared page-frame primitives`
    );
    assert.match(
      source,
      /<PageCanvas(?:\s|>)/,
      `${relativePath} needs a canvas`
    );
    assert.match(
      source,
      /<WorkspacePanel(?:\s|>)/,
      `${relativePath} needs one primary workspace panel`
    );
    assert.doesNotMatch(
      source,
      /SplitWorkspace/,
      `${relativePath} is a primary route, not a specialized split workspace`
    );
  }
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
