import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

import {
  assertPageCanvasContext,
  pageCanvasOpenings,
} from "@/lib/testing/page-canvas-source";
import { assertInOrder } from "@/lib/testing/source-span";

interface SpecializedRouteFamily {
  routes: readonly string[];
  owner: string;
  composition:
    | "attached-delegated"
    | "attached-workspace"
    | "context-free-split"
    | "context-free-workspace";
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
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/, /min-h-full/],
  },
  {
    routes: [
      "/people/[id]/assessments/new",
      "/people/[id]/assessments/interview",
      "/people/[id]/assessments/commitment",
    ],
    owner: "src/components/people/assessment-entry-shell.tsx",
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/, /shadow-sm/],
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
    composition: "attached-workspace",
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
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/, /min-h-full/],
  },
  {
    routes: ["/wiki", "/wiki/[...slug]", "/wiki/progress"],
    owner: "src/app/(dashboard)/wiki/layout.tsx",
    composition: "context-free-split",
    markers: [
      /HeaderBreadcrumbs items=\{WIKI_BREADCRUMBS\}/,
      /PageCanvas/,
      /SplitWorkspace/,
      /WorkspacePanel/,
    ],
  },
  {
    routes: ["/dashboard (onboarding)"],
    owner: "src/app/(dashboard)/dashboard/onboarding-dashboard.tsx",
    composition: "context-free-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/communication/compose"],
    owner: "src/app/(dashboard)/communication/compose/page.tsx",
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/communication/templates"],
    owner: "src/app/(dashboard)/communication/templates/page.tsx",
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/communication/templates/[id]/edit"],
    owner: "src/app/(dashboard)/communication/templates/[id]/edit/page.tsx",
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/communication/history"],
    owner: "src/app/(dashboard)/communication/history/page.tsx",
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/communication/[id]"],
    owner: "src/app/(dashboard)/communication/[id]/page.tsx",
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/documents/history"],
    owner: "src/app/(dashboard)/documents/history/page.tsx",
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/oversight/plants/[id]"],
    owner: "src/app/(dashboard)/oversight/plants/[id]/page.tsx",
    composition: "attached-delegated",
    markers: [/PageCanvas/, /PlantDetail/, /attachedContext/],
  },
  {
    routes: ["/coaching/[churchId]"],
    owner: "src/app/(dashboard)/coaching/[churchId]/page.tsx",
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/],
  },
  {
    routes: ["/tasks/[id]"],
    owner: "src/app/(dashboard)/tasks/[id]/page.tsx",
    composition: "attached-workspace",
    markers: [/PageCanvas/, /WorkspacePanel/, /min-h-full/],
  },
];

/**
 * Presentation roots implemented on Stage 3. Keeping this assignment explicit
 * lets the filesystem audit below cover the complete authenticated route tree
 * without making this branch edit files owned by the parallel stage.
 */
const STAGE_3_PRIMARY_ROUTES = [
  "/admin/feedback",
  "/communication",
  "/dashboard",
  "/documents",
  "/launch",
  "/meetings",
  "/meetings/new",
  "/notifications",
  "/oversight",
  "/oversight/health",
  "/oversight/invitations",
  "/oversight/plants",
  "/oversight/sending-churches",
  "/people",
  "/people/new",
  "/phase",
  "/tasks",
  "/tasks/new",
  "/tasks/templates",
  "/teams",
  "/teams/health",
  "/teams/org-chart",
  "/verify-email",
  "/verify-email/confirmed",
] as const;

interface NonPresentationRouteExclusion {
  route: string;
  source: string;
}

/** These retired URLs render no interface; both permanently redirect. */
const NON_PRESENTATION_ROUTE_EXCLUSIONS = [
  {
    route: "/settings",
    source: "src/app/(dashboard)/settings/page.tsx",
  },
  {
    route: "/settings/[section]",
    source: "src/app/(dashboard)/settings/[section]/page.tsx",
  },
] as const satisfies readonly NonPresentationRouteExclusion[];

const DASHBOARD_APP_ROOT = path.join(process.cwd(), "src/app/(dashboard)");
const PAGE_FRAME_SOURCE = readFileSync(
  path.join(process.cwd(), "src/components/layout/page-frame.tsx"),
  "utf8"
);

function collectPageRoutes(
  directory: string,
  routeSegments: readonly string[] = []
): string[] {
  const routes: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      routes.push(
        ...collectPageRoutes(path.join(directory, entry.name), [
          ...routeSegments,
          entry.name,
        ])
      );
    } else if (entry.isFile() && entry.name === "page.tsx") {
      routes.push(`/${routeSegments.join("/")}`);
    }
  }

  return routes.sort();
}

test("all 32 specialized surfaces declare their ruled composition and owner", () => {
  const routes = SPECIALIZED_ROUTE_FAMILIES.flatMap((family) => family.routes);

  assert.equal(routes.length, 32);
  assert.equal(
    new Set(routes).size,
    routes.length,
    "route inventory is unique"
  );

  for (const family of SPECIALIZED_ROUTE_FAMILIES) {
    const source = readFileSync(path.join(process.cwd(), family.owner), "utf8");
    const canvases = pageCanvasOpenings(source, family.owner);
    assert.equal(
      canvases.length,
      1,
      `${family.owner} must own exactly one PageCanvas`
    );
    const [canvas] = canvases;

    for (const marker of family.markers) {
      assert.match(
        source,
        marker,
        `${family.routes.join(", ")} must keep ${String(marker)} in ${family.owner}`
      );
    }

    switch (family.composition) {
      case "attached-workspace":
        assertPageCanvasContext(canvas, "attached", family.owner);
        assert.match(source, /<WorkspacePanel(?:\s|>)/);
        break;
      case "attached-delegated":
        assertPageCanvasContext(canvas, "attached", family.owner);
        assert.match(source, /attachedContext/);
        assert.doesNotMatch(
          source,
          /<WorkspacePanel(?:\s|>)/,
          `${family.owner} delegates the attached seam to its first owned surface`
        );
        break;
      case "context-free-split":
        assertPageCanvasContext(canvas, "context-free", family.owner);
        assert.match(source, /SplitWorkspace/);
        assert.doesNotMatch(source, /PageContext|contextAttachment/);
        break;
      case "context-free-workspace":
        assertPageCanvasContext(canvas, "context-free", family.owner);
        assert.equal(
          canvas.hasContentFocusTarget,
          true,
          `${family.owner} must keep its settings focus target on the same PageCanvas`
        );
        assert.match(source, /<WorkspacePanel(?:\s|>)/);
        assert.doesNotMatch(source, /PageContext|contextAttachment/);
        break;
    }
  }
});

test("every authenticated page is assigned to a presentation stage or a non-rendering redirect", () => {
  const specializedRoutes = SPECIALIZED_ROUTE_FAMILIES.flatMap(
    (family) => family.routes
  ).filter((route) => route !== "/dashboard (onboarding)");
  const assignedRoutes = [
    ...specializedRoutes,
    ...STAGE_3_PRIMARY_ROUTES,
    ...NON_PRESENTATION_ROUTE_EXCLUSIONS.map((exclusion) => exclusion.route),
  ];

  assert.equal(
    new Set(assignedRoutes).size,
    assignedRoutes.length,
    "authenticated route assignments must not overlap"
  );
  assert.deepEqual(
    collectPageRoutes(DASHBOARD_APP_ROOT),
    [...assignedRoutes].sort(),
    "every authenticated page.tsx needs an explicit presentation owner"
  );
});

test("non-presentation route exclusions remain permanentRedirect-only pages", () => {
  for (const exclusion of NON_PRESENTATION_ROUTE_EXCLUSIONS) {
    const source = readFileSync(
      path.join(process.cwd(), exclusion.source),
      "utf8"
    );
    const sourceFile = ts.createSourceFile(
      exclusion.source,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const importsPermanentRedirect = sourceFile.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "next/navigation" &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (element) => element.name.text === "permanentRedirect"
        )
    );
    const page = sourceFile.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) &&
        statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword
        ) === true
    );

    assert.equal(
      importsPermanentRedirect,
      true,
      `${exclusion.route} must import permanentRedirect from next/navigation`
    );
    assert.ok(page?.body, `${exclusion.route} must export a page function`);
    const statements = [...page.body.statements];
    const statement = statements.at(-1);
    assert.ok(
      statement &&
        ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) &&
        ts.isIdentifier(statement.expression.expression) &&
        statement.expression.expression.text === "permanentRedirect",
      `${exclusion.route} must finish by calling permanentRedirect`
    );
    assert.equal(
      statements.slice(0, -1).every(ts.isVariableStatement),
      true,
      `${exclusion.route} may only prepare redirect arguments before redirecting`
    );

    let redirectCalls = 0;
    let rendersOrReturns = false;
    const inspectPageBody = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "permanentRedirect"
      ) {
        redirectCalls += 1;
      }
      if (
        ts.isReturnStatement(node) ||
        ts.isJsxElement(node) ||
        ts.isJsxSelfClosingElement(node) ||
        ts.isJsxFragment(node)
      ) {
        rendersOrReturns = true;
      }
      ts.forEachChild(node, inspectPageBody);
    };
    inspectPageBody(page.body);

    assert.equal(redirectCalls, 1, `${exclusion.route} redirects exactly once`);
    assert.equal(
      rendersOrReturns,
      false,
      `${exclusion.route} must remain non-rendering`
    );
  }
});

test("task detail header stacks and preserves long titles and action access", () => {
  const page = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/tasks/[id]/page.tsx"),
    "utf8"
  );
  const actions = readFileSync(
    path.join(
      process.cwd(),
      "src/app/(dashboard)/tasks/[id]/task-detail-actions.tsx"
    ),
    "utf8"
  );

  assert.match(page, /flex flex-col[^"]*md:flex-row/);
  assert.match(page, /min-w-0 space-y-1/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(actions, /flex max-w-full flex-wrap/);
});

test("task detail keeps a canvas-sized bottom inset after tall content", () => {
  const page = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/tasks/[id]/page.tsx"),
    "utf8"
  );
  const sourceFile = ts.createSourceFile(
    "tasks/[id]/page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const canvases: ts.JsxElement[] = [];
  const collectCanvases = (node: ts.Node) => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(sourceFile) === "PageCanvas"
    ) {
      canvases.push(node);
    }
    ts.forEachChild(node, collectCanvases);
  };
  collectCanvases(sourceFile);

  assert.equal(canvases.length, 1, "task detail must keep one PageCanvas");
  const scrollLayout = canvases[0].openingElement.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      property.name.getText(sourceFile) === "scrollLayout"
  );

  assert.ok(
    scrollLayout?.initializer && ts.isStringLiteral(scrollLayout.initializer),
    "task detail must explicitly choose the shared flow layout"
  );
  assert.equal(scrollLayout.initializer.text, "flow");

  const directElements = canvases[0].children.filter(
    (child): child is ts.JsxElement | ts.JsxSelfClosingElement =>
      ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)
  );

  assert.equal(
    directElements.length,
    1,
    "the shared canvas contract must replace the route-specific spacer"
  );
  const [workspace] = directElements;
  assert.ok(
    ts.isJsxElement(workspace),
    "the task card must remain a JSX element"
  );
  assert.equal(
    workspace.openingElement.tagName.getText(sourceFile),
    "WorkspacePanel",
    "the task card remains the first canvas-content box"
  );
  const workspaceSource = workspace.getText(sourceFile);

  assert.match(
    PAGE_FRAME_SOURCE,
    /"flex min-h-full min-w-0 flex-col gap-3"[\s\S]*scrollLayout === "fixed" && "h-full"/,
    "flow hierarchies must be allowed to grow beyond the canvas viewport"
  );
  assert.match(
    PAGE_FRAME_SOURCE,
    /"min-w-0 flex-1 outline-none"[\s\S]*scrollLayout === "fixed" && "min-h-0"/,
    "flow content must contribute its intrinsic height to the hierarchy"
  );
  assert.doesNotMatch(
    workspaceSource,
    /\bmb-3\b|\bsm:mb-4\b/,
    "the fix must not restore the ineffective collapsing workspace margin"
  );
  assert.doesNotMatch(
    page,
    /task-detail-end-inset|(?:overflow-auto|overflow-y-auto)/,
    "the fix must not add another vertical scroll owner"
  );
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
    "src/app/(dashboard)/tasks/[id]/page.tsx",
  ]) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(source, /<PageCanvas(?:\s|>)/);
    assert.match(source, /contextAttachment="attached"/);
    assert.match(source, /contextItems=\{/);
    assert.match(
      source,
      /<WorkspacePanel className="[^"]*\bmin-h-full\b[^"]*"/
    );
    assert.doesNotMatch(
      source,
      /<WorkspacePanel[^>]*(?<!min-)h-full|<WorkspacePanel[^>]*overflow-hidden/
    );
    assert.doesNotMatch(
      source,
      /(?:overflow-auto|overflow-y-auto)/,
      `${file} must not introduce a nested vertical scroll owner`
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

test("Wiki preserves declared state without rendering a redundant context row", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/wiki/layout.tsx"),
    "utf8"
  );
  assertInOrder(
    source,
    "wiki/layout.tsx",
    [
      "<HeaderBreadcrumbs items={WIKI_BREADCRUMBS} />",
      "<SplitWorkspace",
      "id={DASHBOARD_PAGE_CONTENT_ID}",
      "tabIndex={-1}",
    ],
    "Wiki keeps the route declaration and places the settings focus target on its visible article workspace"
  );
  assert.doesNotMatch(source, /PageContext/);
});

test("Wiki keeps both panes in one full-height row at every width", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/wiki/layout.tsx"),
    "utf8"
  );

  assert.match(
    source,
    /<SplitWorkspace className="grid-rows-\[minmax\(0,1fr\)\]">/,
    "the context-free workspace has one explicit flexible row"
  );
  assert.match(
    source,
    /<WorkspacePanel className="hidden h-full overflow-hidden lg:col-start-1 lg:row-start-1 lg:block">/,
    "the desktop navigation occupies the first column of the only row"
  );
  assert.match(
    source,
    /className="row-start-1 h-full overflow-y-auto overscroll-x-none overscroll-y-none outline-none \[container:wiki-content\/size\] lg:col-start-2"/,
    "the article occupies that same row on mobile and desktop"
  );
  assert.match(
    source,
    /<aside className="h-full overflow-y-auto overscroll-x-none overscroll-y-none p-4">/,
    "the navigation pane must not hand a boundary gesture to the shell"
  );
});

test("Wiki gives its size-contained mobile article a definite block size", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/wiki/layout.tsx"),
    "utf8"
  );

  assert.match(
    source,
    /<PageCanvas[\s\S]*contentClassName="h-full"[\s\S]*context="none"/,
    "without an explicit full-height content wrapper, the only visible size-contained grid item cannot contribute intrinsic block size on mobile"
  );
  assert.match(source, /\[container:wiki-content\/size\]/);
  assert.match(
    PAGE_FRAME_SOURCE,
    /data-slot="page-content"[\s\S]*contentClassName/,
    "PageCanvas must apply the definite-height class to the flex child that directly contains SplitWorkspace"
  );
  assert.match(
    PAGE_FRAME_SOURCE,
    /data-slot="split-workspace"[\s\S]*"grid h-full min-h-0/,
    "the grid must carry that definite height through to its rows"
  );
});

test("attached context shares the full or centered workspace width", () => {
  const history = readFileSync(
    path.join(
      process.cwd(),
      "src/app/(dashboard)/communication/history/page.tsx"
    ),
    "utf8"
  );
  assert.match(
    history,
    /<PageCanvas[\s\S]*contextAttachment="attached"[\s\S]*contextItems=\{HISTORY_BREADCRUMBS\}/,
    "the full-width history workspace explicitly opts into the integrated seam"
  );

  for (const [relativePath, width] of [
    ["meetings/new/page.tsx", "max-w-2xl"],
    ["people/new/page.tsx", "max-w-2xl"],
    ["tasks/[id]/page.tsx", "max-w-4xl"],
    ["coaching/[churchId]/page.tsx", "max-w-6xl"],
  ] as const) {
    const source = readFileSync(
      path.join(DASHBOARD_APP_ROOT, relativePath),
      "utf8"
    );
    assert.match(
      source,
      /contextAttachment="attached"/,
      `${relativePath} must opt into the integrated context seam`
    );
    assert.match(
      source,
      new RegExp(`frameClassName="[^"]*${width}[^"]*"`),
      `${relativePath} must center the context and workspace on one ${width} frame`
    );
  }
});
