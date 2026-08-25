import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const DASHBOARD = path.join(process.cwd(), "src", "app", "(dashboard)");

function read(routePath: string) {
  return readFileSync(path.join(DASHBOARD, routePath), "utf8");
}

const ATTACHED_WORKSPACES = [
  "communication/history/page.tsx",
  "communication/compose/page.tsx",
  "communication/templates/page.tsx",
  "communication/templates/[id]/edit/page.tsx",
  "communication/[id]/page.tsx",
  "documents/page.tsx",
  "documents/history/page.tsx",
  "tasks/page.tsx",
  "tasks/[id]/page.tsx",
  "tasks/new/page.tsx",
  "tasks/templates/page.tsx",
  "admin/feedback/page.tsx",
] as const;

test("the communication overview is a context-free collection of peer surfaces", () => {
  const source = read("communication/page.tsx");

  assert.match(
    source,
    /<PageCanvas[\s\S]*context="none"[\s\S]*contentFocusTarget/
  );
  assert.doesNotMatch(
    source,
    /<WorkspacePanel/,
    "the overview must not put its cards inside a false page-wide workspace"
  );
  assert.match(source, /data-slot="communication-overview"/);
  assert.match(
    source,
    /data-slot="communication-overview"[\s\S]*className="[^"]*\bh-full\b[^"]*\bmin-h-0\b[^"]*\bflex-col\b[^"]*\boverflow-hidden\b[^"]*"/
  );
  assert.match(
    source,
    /className="[^"]*\bmin-h-0\b[^"]*\bflex-1\b[^"]*\boverflow-auto\b[^"]*"/,
    "the existing overview body remains its single explicit scroll owner"
  );
});

test("ruled work-stream routes render attached breadcrumbs from server-known items", () => {
  for (const routePath of ATTACHED_WORKSPACES) {
    const source = read(routePath);

    assert.match(
      source,
      /<HeaderBreadcrumbs items=\{(?:breadcrumbs|HISTORY_BREADCRUMBS)\} \/>/,
      `${routePath} must publish the same trail to the shell context`
    );
    assert.match(
      source,
      /<PageCanvas[\s\S]*contextAttachment="attached"[\s\S]*contextItems=\{(?:breadcrumbs|HISTORY_BREADCRUMBS)\}/,
      `${routePath} must render its attached trail in the initial server HTML`
    );
    assert.doesNotMatch(
      source,
      /PageHierarchyPrototype|data-auth-page-hierarchy|auth-page-hierarchy-prototype/,
      `${routePath} must not retain prototype state or selectors`
    );
  }
});

test("narrow task workspaces attach their context to the same width boundary", () => {
  const detail = read("tasks/[id]/page.tsx");
  const create = read("tasks/new/page.tsx");
  const templates = read("tasks/templates/page.tsx");

  assert.match(detail, /frameClassName="mx-auto w-full max-w-4xl"/);
  assert.match(create, /frameClassName="mx-auto w-full max-w-2xl"/);
  assert.match(templates, /frameClassName="mx-auto w-full max-w-3xl"/);

  for (const source of [detail, create, templates]) {
    assert.doesNotMatch(
      source,
      /<WorkspacePanel className="[^"]*\bmx-auto\b/,
      "centering belongs to the shared context-plus-workspace frame"
    );
  }
});
