import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

type ScrollLayout = "fixed" | "fixed-default" | "flow" | "view-dependent";

interface PageCanvasOwner {
  owner: string;
  routes: readonly string[];
  scrollLayout: ScrollLayout;
  openings?: number;
}

/**
 * Every authenticated PageCanvas owner must choose who owns vertical
 * scrolling. Flow pages grow with their content so PageCanvas's padding is in
 * the scroll range. Fixed workspaces keep a definite-height frame and give
 * scrolling to a list, board, editor, or split pane inside it.
 */
const AUTHENTICATED_PAGE_CANVAS_OWNERS = [
  {
    owner: "src/app/(dashboard)/admin/feedback/page.tsx",
    routes: ["/admin/feedback"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/coaching/[churchId]/page.tsx",
    routes: ["/coaching/[churchId]"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/communication/[id]/page.tsx",
    routes: ["/communication/[id]"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/communication/compose/page.tsx",
    routes: ["/communication/compose"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/communication/history/page.tsx",
    routes: ["/communication/history"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/communication/page.tsx",
    routes: ["/communication"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/communication/templates/[id]/edit/page.tsx",
    routes: ["/communication/templates/[id]/edit"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/communication/templates/page.tsx",
    routes: ["/communication/templates"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/dashboard/no-plant-empty-state.tsx",
    routes: ["/dashboard (no plant)"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/dashboard/onboarding-dashboard.tsx",
    routes: ["/dashboard (onboarding)"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/dashboard/plant-dashboard.tsx",
    routes: ["/dashboard (plant)"],
    scrollLayout: "flow",
    openings: 2,
  },
  {
    owner: "src/app/(dashboard)/documents/history/page.tsx",
    routes: ["/documents/history"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/documents/page.tsx",
    routes: ["/documents"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/launch/page.tsx",
    routes: ["/launch"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/meetings/[id]/layout.tsx",
    routes: [
      "/meetings/[id]",
      "/meetings/[id]/analytics",
      "/meetings/[id]/attendance",
      "/meetings/[id]/evaluation",
      "/meetings/[id]/invitations",
      "/meetings/[id]/logistics",
      "/meetings/[id]/outcomes",
    ],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/meetings/new/page.tsx",
    routes: ["/meetings/new"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/meetings/page.tsx",
    routes: ["/meetings"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/notifications/page.tsx",
    routes: ["/notifications"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/oversight/health/page.tsx",
    routes: ["/oversight/health"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/oversight/invitations/page.tsx",
    routes: ["/oversight/invitations"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/oversight/page.tsx",
    routes: ["/oversight"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/oversight/plants/[id]/page.tsx",
    routes: ["/oversight/plants/[id]"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/oversight/plants/page.tsx",
    routes: ["/oversight/plants"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/oversight/sending-churches/page.tsx",
    routes: ["/oversight/sending-churches"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/people/new/page.tsx",
    routes: ["/people/new"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/people/page.tsx",
    routes: ["/people (list)", "/people (pipeline)"],
    scrollLayout: "view-dependent",
  },
  {
    owner: "src/app/(dashboard)/phase/page.tsx",
    routes: ["/phase"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/tasks/[id]/page.tsx",
    routes: ["/tasks/[id]"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/tasks/new/page.tsx",
    routes: ["/tasks/new"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/tasks/page.tsx",
    routes: ["/tasks"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/tasks/templates/page.tsx",
    routes: ["/tasks/templates"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/teams/[teamId]/layout.tsx",
    routes: [
      "/teams/[teamId]",
      "/teams/[teamId]/meetings",
      "/teams/[teamId]/responsibilities",
      "/teams/[teamId]/training",
    ],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/teams/health/page.tsx",
    routes: ["/teams/health"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/teams/org-chart/page.tsx",
    routes: ["/teams/org-chart"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/teams/page.tsx",
    routes: ["/teams"],
    scrollLayout: "fixed",
  },
  {
    owner: "src/app/(dashboard)/verify-email/confirmed/page.tsx",
    routes: ["/verify-email/confirmed"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/verify-email/page.tsx",
    routes: ["/verify-email"],
    scrollLayout: "flow",
  },
  {
    owner: "src/app/(dashboard)/wiki/layout.tsx",
    routes: ["/wiki", "/wiki/[...slug]", "/wiki/progress"],
    scrollLayout: "fixed-default",
  },
  {
    owner: "src/components/people/assessment-entry-shell.tsx",
    routes: [
      "/people/[id]/assessments/commitment",
      "/people/[id]/assessments/interview",
      "/people/[id]/assessments/new",
    ],
    scrollLayout: "flow",
  },
  {
    owner: "src/components/people/person-profile-shell.tsx",
    routes: [
      "/people/[id]",
      "/people/[id]/activity",
      "/people/[id]/assessments",
      "/people/[id]/communication",
      "/people/[id]/teams",
    ],
    scrollLayout: "flow",
  },
] as const satisfies readonly PageCanvasOwner[];

const DASHBOARD_ROOT = path.join(process.cwd(), "src/app/(dashboard)");
const COMPONENT_OWNERS = [
  "src/components/people/assessment-entry-shell.tsx",
  "src/components/people/person-profile-shell.tsx",
] as const;

interface CanvasOpening {
  scrollLayout: "default" | "fixed" | "flow" | "view-dependent";
}

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectTsxFiles(absolutePath);
    }

    return entry.isFile() && entry.name.endsWith(".tsx") ? [absolutePath] : [];
  });
}

function pageCanvasOpenings(owner: string): CanvasOpening[] {
  const source = readFileSync(path.join(process.cwd(), owner), "utf8");
  const sourceFile = ts.createSourceFile(
    owner,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const openings: CanvasOpening[] = [];

  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === "PageCanvas"
    ) {
      const attribute = node.attributes.properties.find(
        (property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) &&
          property.name.getText(sourceFile) === "scrollLayout"
      );

      if (!attribute?.initializer) {
        openings.push({ scrollLayout: "default" });
      } else if (ts.isStringLiteral(attribute.initializer)) {
        assert.ok(
          attribute.initializer.text === "fixed" ||
            attribute.initializer.text === "flow",
          `${owner} declares an unknown PageCanvas scroll layout`
        );
        openings.push({ scrollLayout: attribute.initializer.text });
      } else {
        assert.ok(
          ts.isJsxExpression(attribute.initializer),
          `${owner} must use a string or conditional scroll layout`
        );
        const expression =
          attribute.initializer.expression?.getText(sourceFile);
        assert.equal(
          expression,
          'isPipelineView ? "fixed" : "flow"',
          `${owner} must keep its view-dependent scroll ownership explicit`
        );
        openings.push({ scrollLayout: "view-dependent" });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return openings;
}

test("every authenticated PageCanvas owner declares its vertical scroll contract", () => {
  const dashboardOwners = collectTsxFiles(DASHBOARD_ROOT)
    .map((absolutePath) => path.relative(process.cwd(), absolutePath))
    .filter((owner) => pageCanvasOpenings(owner).length > 0);
  const discoveredOwners = [...dashboardOwners, ...COMPONENT_OWNERS].sort();
  const inventoriedOwners = AUTHENTICATED_PAGE_CANVAS_OWNERS.map(
    ({ owner }) => owner
  ).sort();

  assert.deepEqual(
    discoveredOwners,
    inventoriedOwners,
    "a PageCanvas owner was added, removed, or moved without classifying its scroll ownership"
  );

  for (const owner of AUTHENTICATED_PAGE_CANVAS_OWNERS) {
    const openings = pageCanvasOpenings(owner.owner);
    const expectedOpenings = "openings" in owner ? owner.openings : 1;
    const expectedLayout =
      owner.scrollLayout === "fixed-default" ? "default" : owner.scrollLayout;

    assert.equal(
      openings.length,
      expectedOpenings,
      `${owner.owner} must keep its inventoried PageCanvas count`
    );
    assert.deepEqual(
      openings.map(({ scrollLayout }) => scrollLayout),
      Array.from({ length: expectedOpenings }, () => expectedLayout),
      `${owner.routes.join(", ")} must keep its ${owner.scrollLayout} scroll ownership`
    );
  }
});
