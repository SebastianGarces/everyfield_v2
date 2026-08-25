import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

interface SpecializedRouteFamily {
  routes: readonly string[];
  owner: string;
  markers: readonly RegExp[];
}

/**
 * The Stage 4 inventory. Route pages keep their existing reads and actions;
 * each family delegates presentation to the named owner so a future nested
 * route cannot silently fall back to the unframed canvas.
 */
const SPECIALIZED_ROUTE_FAMILIES: readonly SpecializedRouteFamily[] = [
  {
    routes: [
      "/people/[id]",
      "/people/[id]/activity",
      "/people/[id]/assessments",
      "/people/[id]/communication",
      "/people/[id]/teams",
    ],
    owner: "src/components/people/person-profile-shell.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/, /min-h-full/],
  },
  {
    routes: [
      "/people/[id]/assessments/new",
      "/people/[id]/assessments/interview",
      "/people/[id]/assessments/commitment",
    ],
    owner: "src/components/people/assessment-entry-shell.tsx",
    markers: [/PageCanvas/, /Card className="mx-auto max-w-4xl shadow-sm"/],
  },
  {
    routes: [
      "/meetings/[id]",
      "/meetings/[id]/attendance",
      "/meetings/[id]/logistics",
      "/meetings/[id]/analytics",
      "/meetings/[id]/invitations",
      "/meetings/[id]/outcomes",
      "/meetings/[id]/evaluation",
    ],
    owner: "src/app/(dashboard)/meetings/[id]/layout.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/, /min-h-full/],
  },
  {
    routes: [
      "/teams/[teamId]",
      "/teams/[teamId]/responsibilities",
      "/teams/[teamId]/training",
      "/teams/[teamId]/meetings",
    ],
    owner: "src/app/(dashboard)/teams/[teamId]/layout.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/, /min-h-full/],
  },
  {
    routes: ["/wiki", "/wiki/[...slug]", "/wiki/progress"],
    owner: "src/app/(dashboard)/wiki/layout.tsx",
    markers: [/PageCanvas/, /SplitWorkspace/, /WorkspacePanel/],
  },
  {
    routes: ["/dashboard (onboarding)"],
    owner: "src/app/(dashboard)/dashboard/onboarding-dashboard.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/communication/compose"],
    owner: "src/app/(dashboard)/communication/compose/page.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/communication/templates"],
    owner: "src/app/(dashboard)/communication/templates/page.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/communication/templates/[id]/edit"],
    owner: "src/app/(dashboard)/communication/templates/[id]/edit/page.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/communication/history"],
    owner: "src/app/(dashboard)/communication/history/page.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/communication/[id]"],
    owner: "src/app/(dashboard)/communication/[id]/page.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/documents/history"],
    owner: "src/app/(dashboard)/documents/history/page.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/oversight/plants/[id]"],
    owner: "src/app/(dashboard)/oversight/plants/[id]/page.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/coaching/[churchId]"],
    owner: "src/app/(dashboard)/coaching/[churchId]/page.tsx",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
];

test("all 31 specialized routes delegate to a rounded workspace owner", () => {
  const routes = SPECIALIZED_ROUTE_FAMILIES.flatMap((family) => family.routes);

  assert.equal(routes.length, 31);
  assert.equal(
    new Set(routes).size,
    routes.length,
    "route inventory is unique"
  );

  for (const family of SPECIALIZED_ROUTE_FAMILIES) {
    const source = readFileSync(path.join(process.cwd(), family.owner), "utf8");
    for (const marker of family.markers) {
      assert.match(
        source,
        marker,
        `${family.routes.join(", ")} must keep ${String(marker)} in ${family.owner}`
      );
    }
  }
});

test("communication editors use their workspace height instead of viewport arithmetic", () => {
  for (const file of [
    "src/app/(dashboard)/communication/compose/compose-form.tsx",
    "src/app/(dashboard)/communication/templates/[id]/edit/template-editor.tsx",
  ]) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(source, /h-full min-h-0/);
    assert.doesNotMatch(source, /100vh/);
  }
});

test("detail workspaces keep the canvas as their single vertical scroll owner", () => {
  for (const file of [
    "src/components/people/person-profile-shell.tsx",
    "src/app/(dashboard)/meetings/[id]/layout.tsx",
    "src/app/(dashboard)/teams/[teamId]/layout.tsx",
    "src/app/(dashboard)/communication/[id]/page.tsx",
  ]) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(source, /<PageCanvas>/);
    assert.match(source, /<WorkspacePanel className="min-h-full">/);
    assert.doesNotMatch(source, /min-h-0 flex-1 overflow-auto/);
    assert.doesNotMatch(
      source,
      /<WorkspacePanel[^>]*(?<!min-)h-full|<WorkspacePanel[^>]*overflow-hidden/
    );
  }
});

test("the wiki table of contents is capped by its workspace, not the viewport", () => {
  const layout = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/wiki/layout.tsx"),
    "utf8"
  );
  const tableOfContents = readFileSync(
    path.join(process.cwd(), "src/components/wiki/table-of-contents.tsx"),
    "utf8"
  );

  assert.match(layout, /\[container:wiki-content\/size\]/);
  assert.match(tableOfContents, /100cqh/);
  assert.doesNotMatch(tableOfContents, /100vh/);
});
