import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

type ScrollLayout = "fixed" | "fixed-default" | "flow" | "view-dependent";
type CanvasComposition =
  | "fixed-internal-scroll"
  | "lone-workspace"
  | "sibling-surfaces"
  | "view-dependent-workspace";

interface PageCanvasOwner {
  owner: string;
  routes: readonly string[];
  scrollLayout: ScrollLayout;
  compositions: readonly CanvasComposition[];
  portaledSibling?: "PersonEditDialog";
  siblingWorkspaceException?: "coaching-peer-cards";
}

/**
 * Every authenticated PageCanvas owner must choose who owns vertical
 * scrolling. Flow pages grow with their content so PageCanvas's padding is in
 * the scroll range. Fixed workspaces keep a definite-height frame and give
 * scrolling to a list, board, editor, or split pane inside it. The composition
 * inventory also decides whether the flow fill contract may stretch a lone
 * workspace or must preserve a group of peer surfaces.
 */
const AUTHENTICATED_PAGE_CANVAS_OWNERS = [
  {
    owner: "src/app/(dashboard)/admin/feedback/page.tsx",
    routes: ["/admin/feedback"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/coaching/[churchId]/page.tsx",
    routes: ["/coaching/[churchId]"],
    scrollLayout: "flow",
    compositions: ["sibling-surfaces"],
    siblingWorkspaceException: "coaching-peer-cards",
  },
  {
    owner: "src/app/(dashboard)/communication/[id]/page.tsx",
    routes: ["/communication/[id]"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/communication/compose/page.tsx",
    routes: ["/communication/compose"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/communication/history/page.tsx",
    routes: ["/communication/history"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/communication/page.tsx",
    routes: ["/communication"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/communication/templates/[id]/edit/page.tsx",
    routes: ["/communication/templates/[id]/edit"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/communication/templates/page.tsx",
    routes: ["/communication/templates"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/dashboard/no-plant-empty-state.tsx",
    routes: ["/dashboard (no plant)"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/dashboard/onboarding-dashboard.tsx",
    routes: ["/dashboard (onboarding)"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/dashboard/plant-dashboard.tsx",
    routes: ["/dashboard (plant)"],
    scrollLayout: "flow",
    compositions: ["lone-workspace", "sibling-surfaces"],
  },
  {
    owner: "src/app/(dashboard)/documents/history/page.tsx",
    routes: ["/documents/history"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/documents/page.tsx",
    routes: ["/documents"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/launch/page.tsx",
    routes: ["/launch"],
    scrollLayout: "flow",
    compositions: ["sibling-surfaces"],
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
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/meetings/new/page.tsx",
    routes: ["/meetings/new"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/meetings/page.tsx",
    routes: ["/meetings"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/notifications/page.tsx",
    routes: ["/notifications"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/oversight/health/page.tsx",
    routes: ["/oversight/health"],
    scrollLayout: "flow",
    compositions: ["sibling-surfaces"],
  },
  {
    owner: "src/app/(dashboard)/oversight/invitations/page.tsx",
    routes: ["/oversight/invitations"],
    scrollLayout: "flow",
    compositions: ["sibling-surfaces"],
  },
  {
    owner: "src/app/(dashboard)/oversight/page.tsx",
    routes: ["/oversight"],
    scrollLayout: "flow",
    compositions: ["sibling-surfaces"],
  },
  {
    owner: "src/app/(dashboard)/oversight/plants/[id]/page.tsx",
    routes: ["/oversight/plants/[id]"],
    scrollLayout: "flow",
    compositions: ["sibling-surfaces"],
  },
  {
    owner: "src/app/(dashboard)/oversight/plants/page.tsx",
    routes: ["/oversight/plants"],
    scrollLayout: "flow",
    compositions: ["sibling-surfaces"],
  },
  {
    owner: "src/app/(dashboard)/oversight/sending-churches/page.tsx",
    routes: ["/oversight/sending-churches"],
    scrollLayout: "flow",
    compositions: ["sibling-surfaces"],
  },
  {
    owner: "src/app/(dashboard)/people/new/page.tsx",
    routes: ["/people/new"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/people/page.tsx",
    routes: ["/people (list)", "/people (pipeline)"],
    scrollLayout: "view-dependent",
    compositions: ["view-dependent-workspace"],
  },
  {
    owner: "src/app/(dashboard)/phase/page.tsx",
    routes: ["/phase"],
    scrollLayout: "flow",
    compositions: ["sibling-surfaces"],
  },
  {
    owner: "src/app/(dashboard)/tasks/[id]/page.tsx",
    routes: ["/tasks/[id]"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/tasks/new/page.tsx",
    routes: ["/tasks/new"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/tasks/page.tsx",
    routes: ["/tasks"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/tasks/templates/page.tsx",
    routes: ["/tasks/templates"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
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
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/teams/health/page.tsx",
    routes: ["/teams/health"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/teams/org-chart/page.tsx",
    routes: ["/teams/org-chart"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/teams/page.tsx",
    routes: ["/teams"],
    scrollLayout: "fixed",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/app/(dashboard)/verify-email/confirmed/page.tsx",
    routes: ["/verify-email/confirmed"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/verify-email/page.tsx",
    routes: ["/verify-email"],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
  },
  {
    owner: "src/app/(dashboard)/wiki/layout.tsx",
    routes: ["/wiki", "/wiki/[...slug]", "/wiki/progress"],
    scrollLayout: "fixed-default",
    compositions: ["fixed-internal-scroll"],
  },
  {
    owner: "src/components/people/assessment-entry-shell.tsx",
    routes: [
      "/people/[id]/assessments/commitment",
      "/people/[id]/assessments/interview",
      "/people/[id]/assessments/new",
    ],
    scrollLayout: "flow",
    compositions: ["lone-workspace"],
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
    compositions: ["lone-workspace"],
    portaledSibling: "PersonEditDialog",
  },
] as const satisfies readonly PageCanvasOwner[];

const DASHBOARD_ROOT = path.join(process.cwd(), "src/app/(dashboard)");
const COMPONENT_OWNERS = [
  "src/components/people/assessment-entry-shell.tsx",
  "src/components/people/person-profile-shell.tsx",
] as const;

interface CanvasOpening {
  scrollLayout: "default" | "fixed" | "flow" | "view-dependent";
  directElements: readonly string[];
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

function jsxRoots(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  if (ts.isJsxElement(node)) {
    return [node.openingElement.tagName.getText(sourceFile)];
  }
  if (ts.isJsxSelfClosingElement(node)) {
    return [node.tagName.getText(sourceFile)];
  }

  const roots: string[] = [];
  node.forEachChild((child) => roots.push(...jsxRoots(child, sourceFile)));
  return roots;
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
    const openingElement = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;

    if (openingElement?.tagName.getText(sourceFile) === "PageCanvas") {
      const attribute = openingElement.attributes.properties.find(
        (property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) &&
          property.name.getText(sourceFile) === "scrollLayout"
      );
      const directElements = ts.isJsxElement(node)
        ? node.children.flatMap((child) => jsxRoots(child, sourceFile))
        : [];

      if (!attribute?.initializer) {
        openings.push({ directElements, scrollLayout: "default" });
      } else if (ts.isStringLiteral(attribute.initializer)) {
        assert.ok(
          attribute.initializer.text === "fixed" ||
            attribute.initializer.text === "flow",
          `${owner} declares an unknown PageCanvas scroll layout`
        );
        openings.push({
          directElements,
          scrollLayout: attribute.initializer.text,
        });
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
        openings.push({ directElements, scrollLayout: "view-dependent" });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return openings;
}

function assertPortaledPersonDialog(owner: PageCanvasOwner) {
  assert.equal(owner.portaledSibling, "PersonEditDialog");
  assert.equal(
    owner.owner,
    "src/components/people/person-profile-shell.tsx",
    "only the person profile has the inventoried portal sibling"
  );

  const dialog = readFileSync(
    path.join(process.cwd(), "src/components/people/person-edit-dialog.tsx"),
    "utf8"
  );
  const primitive = readFileSync(
    path.join(process.cwd(), "src/components/ui/dialog.tsx"),
    "utf8"
  );

  assert.match(
    dialog,
    /<Dialog[\s\S]*?<DialogContent/,
    "PersonEditDialog must remain a Radix dialog rather than a canvas sibling"
  );
  assert.match(
    primitive,
    /function DialogContent[\s\S]*?<DialogPortal[\s\S]*?<DialogPrimitive\.Content/,
    "DialogContent must remain portaled outside PageCanvas so WorkspacePanel is the only rendered child"
  );
}

function assertComposition(
  owner: PageCanvasOwner,
  opening: CanvasOpening,
  composition: CanvasComposition,
  index: number
) {
  const label = `${owner.routes.join(", ")} canvas ${index + 1}`;

  switch (composition) {
    case "fixed-internal-scroll":
      assert.ok(
        opening.scrollLayout === "fixed" || opening.scrollLayout === "default",
        `${label} must keep a fixed canvas around its internal scroll owner`
      );
      break;
    case "view-dependent-workspace":
      assert.equal(
        opening.scrollLayout,
        "view-dependent",
        `${label} must keep its flow list / fixed pipeline split`
      );
      assert.deepEqual(
        opening.directElements,
        ["WorkspacePanel"],
        `${label} must keep one workspace whose scroll contract changes with the view`
      );
      break;
    case "lone-workspace":
      assert.equal(
        opening.scrollLayout,
        "flow",
        `${label} must leave vertical scrolling with PageCanvas`
      );
      if (owner.portaledSibling) {
        assert.deepEqual(
          opening.directElements,
          ["WorkspacePanel", owner.portaledSibling],
          `${label} may pair its lone rendered workspace only with the inventoried portal sibling`
        );
        assertPortaledPersonDialog(owner);
      } else {
        assert.deepEqual(
          opening.directElements,
          ["WorkspacePanel"],
          `${label} must keep WorkspacePanel as its only direct surface`
        );
      }
      break;
    case "sibling-surfaces":
      assert.equal(
        opening.scrollLayout,
        "flow",
        `${label} must let its peer surfaces grow in canvas flow`
      );
      if (owner.siblingWorkspaceException === "coaching-peer-cards") {
        assert.equal(
          owner.owner,
          "src/app/(dashboard)/coaching/[churchId]/page.tsx",
          "only coaching may mix a WorkspacePanel with peer cards"
        );
        assert.deepEqual(
          opening.directElements,
          ["WorkspacePanel", "Card", "Card"],
          `${label} must preserve the coaching summary and its two peer cards`
        );
      } else {
        assert.equal(
          opening.directElements.includes("WorkspacePanel"),
          false,
          `${label} must not disguise peer surfaces as one fillable workspace`
        );
      }
      break;
  }
}

test("every authenticated PageCanvas owner declares its scroll and composition contracts", () => {
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
    const expectedOpenings = owner.compositions.length;
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

    for (const [index, composition] of owner.compositions.entries()) {
      assertComposition(owner, openings[index], composition, index);
    }
  }
});
