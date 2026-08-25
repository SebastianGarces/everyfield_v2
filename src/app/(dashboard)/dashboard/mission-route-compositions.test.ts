import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { assertInOrder } from "@/lib/testing/source-span";

const DASHBOARD_ROOT = join(process.cwd(), "src/app/(dashboard)");

function routeSource(relativePath: string) {
  return readFileSync(join(DASHBOARD_ROOT, relativePath), "utf8");
}

test("top-level mission and oversight routes suppress redundant shell context", () => {
  for (const relativePath of [
    "launch/page.tsx",
    "oversight/page.tsx",
    "oversight/health/page.tsx",
    "oversight/plants/page.tsx",
    "oversight/invitations/page.tsx",
    "oversight/sending-churches/page.tsx",
  ]) {
    const source = routeSource(relativePath);

    assert.match(
      source,
      /<PageCanvas(?: className="p-0")? context="none" contentFocusTarget>/,
      `${relativePath} keeps its page identity in its own content header`
    );
    assert.doesNotMatch(
      source,
      /<WorkspacePanel(?:\s|>)/,
      `${relativePath} must not wrap sibling surfaces in a false outer panel`
    );
  }
});

test("completed dashboard uses an unboxed identity and sibling cards", () => {
  const source = routeSource("dashboard/plant-dashboard.tsx");

  assert.match(source, /data-slot="completed-dashboard-content"/);
  assert.doesNotMatch(
    source,
    /<WorkspacePanel className="mx-auto min-h-full max-w-6xl/,
    "the completed dashboard must not restore its former giant outer panel"
  );
  assert.match(
    source,
    /<WorkspacePanel className="mx-auto min-h-full max-w-3xl/,
    "leadership re-entry remains a focused workspace"
  );
  assertInOrder(
    source,
    "dashboard/plant-dashboard.tsx",
    [
      'data-slot="completed-dashboard-content"',
      '{church?.name ?? "Dashboard"}',
      "<MetricCard",
      "<ActivityFeed",
      "<LaunchStatusCard",
      "<QuickActions",
    ],
    "completed dashboard reading order remains identity, metrics, and work surfaces"
  );
});

test("Plant Intelligence keeps approved standalone context and sibling surfaces", () => {
  const source = routeSource("phase/page.tsx");

  assert.match(source, /<PageCanvas[\s\S]*?context="none"/);
  assert.match(
    source,
    /<PageContext className="mb-2" items=\{PHASE_BREADCRUMBS\}/
  );
  assert.match(source, /data-slot="plant-intelligence-content"/);
  assert.doesNotMatch(source, /WorkspacePanel/);
  assert.doesNotMatch(source, /contextAttachment|attachment="attached"/);
});

test("detail routes attach server-known trails to their first surface", () => {
  const plant = routeSource("oversight/plants/[id]/page.tsx");
  const coaching = routeSource("coaching/[churchId]/page.tsx");
  const plantDetail = readFileSync(
    join(process.cwd(), "src/components/oversight/plant-detail.tsx"),
    "utf8"
  );

  for (const [relativePath, source] of [
    ["oversight/plants/[id]/page.tsx", plant],
    ["coaching/[churchId]/page.tsx", coaching],
  ] as const) {
    assert.match(source, /contextAttachment="attached"/);
    assert.match(source, /contextItems=\{breadcrumbs\}/);
    assertInOrder(
      source,
      relativePath,
      [
        "const breadcrumbs =",
        "<HeaderBreadcrumbs items={breadcrumbs}",
        'contextAttachment="attached"',
        "contextItems={breadcrumbs}",
      ],
      "attached detail geometry must be correct in the server HTML"
    );
  }

  assert.doesNotMatch(plant, /<WorkspacePanel(?:\s|>)/);
  assert.match(plant, /<PlantDetail[\s\S]*attachedContext/);
  assert.match(
    plantDetail,
    /attachedContext && "rounded-t-none border-t-0"/,
    "the plant identity card must join the attached trail without nested top corners"
  );

  assertInOrder(
    coaching,
    "coaching/[churchId]/page.tsx",
    [
      "<WorkspacePanel",
      "<CardTitle>People</CardTitle>",
      "<CardTitle>Tasks</CardTitle>",
    ],
    "the attached coaching header, People, and Tasks remain sibling surfaces"
  );
});

test("Wiki keeps no shell context and its proven independent-pane height contract", () => {
  const source = routeSource("wiki/layout.tsx");

  assert.match(source, /context="none"/);
  assert.match(source, /contentClassName="h-full"/);
  assert.match(
    source,
    /<SplitWorkspace className="grid-rows-\[minmax\(0,1fr\)\]">/
  );
  assert.match(source, /hidden h-full overflow-hidden lg:col-start-1/);
  assert.match(
    source,
    /row-start-1 h-full overflow-y-auto overscroll-y-none outline-none/
  );
  assert.doesNotMatch(source, /PageContext/);
});

test("sending-church roster keeps exactly one table surface boundary", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/oversight/sending-churches-roster.tsx"),
    "utf8"
  );

  assert.equal((source.match(/<Table(?:\s|>)/g) ?? []).length, 1);
  assert.equal(
    (source.match(/bg-card max-w-4xl overflow-hidden rounded-xl border/g) ?? [])
      .length,
    1
  );
});
