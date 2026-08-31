import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const COMPONENT_ROOT = dirname(new URL(import.meta.url).pathname);
const DASHBOARD_LAYOUT = join(COMPONENT_ROOT, "../app/(dashboard)/layout.tsx");

const PERSISTENT_SHELL_SOURCES = [
  "app-sidebar.tsx",
  "header/global-app-bar.tsx",
  "nav-main.tsx",
  "nav-user.tsx",
  "notifications/notification-bell.tsx",
  "wiki-guide/index.tsx",
  "wiki-guide/wiki-guide-panel.tsx",
] as const;

const PERSISTENT_LINK_CONSUMERS = [
  "app-sidebar.tsx",
  "evry/artifacts/artifact-renderer.tsx",
  "evry/conversation-history/history-list.tsx",
  "header/global-app-bar.tsx",
  "nav-main.tsx",
  "notifications/notification-bell.tsx",
  "wiki-guide/wiki-guide-panel.tsx",
] as const;

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function source(relativePath: string): string {
  return readFileSync(join(COMPONENT_ROOT, relativePath), "utf8");
}

test("pinned Next Link dispatches outside contextual router methods", () => {
  const installedLink = readFileSync(
    require.resolve("next/dist/client/app-dir/link"),
    "utf8"
  );
  const onNavigate = installedLink.indexOf("if (onNavigate)");
  const directDispatch = installedLink.indexOf("dispatchNavigateAction(href");
  assert.ok(onNavigate >= 0, "installed Link must expose onNavigate");
  assert.ok(
    directDispatch > onNavigate,
    "installed Link accepts onNavigate before its module-level direct dispatch"
  );
  assert.doesNotMatch(
    installedLink.slice(onNavigate, directDispatch + 80),
    /router\.(?:push|replace)\(/,
    "Link navigation must not be modeled as a contextual router method"
  );
});

test("authenticated navigation inventory covers the persistent dashboard shell", () => {
  const layout = readFileSync(DASHBOARD_LAYOUT, "utf8");
  for (const component of [
    "EvryShell",
    "GlobalAppBar",
    "NotificationBell",
    "AppSidebar",
    "WikiGuide",
  ]) {
    assert.match(
      layout,
      new RegExp(`<${component}\\b`),
      `${component} must remain represented in the persistent-shell graph`
    );
  }
  assert.match(source("header/global-app-bar.tsx"), /<NavUser\b/);
  assert.match(source("app-sidebar.tsx"), /<NavMain\b/);
  assert.match(source("wiki-guide/index.tsx"), /<WikiGuidePanel\b/);

  const evrySources = sourceFiles(join(COMPONENT_ROOT, "evry"))
    .filter((path) => !/\.test\.tsx?$|-proof\.tsx?$/.test(path))
    .map((path) => relative(COMPONENT_ROOT, path));
  const reachableSources = [
    ...PERSISTENT_SHELL_SOURCES,
    ...evrySources,
  ].toSorted();
  assert.equal(
    new Set(reachableSources).size,
    reachableSources.length,
    "the explicit chrome graph and Evry subtree must not overlap"
  );

  const directImports = reachableSources.filter((path) =>
    /from ["']next\/link["']/.test(source(path))
  );
  assert.deepEqual(
    directImports,
    [],
    "no component mounted with /evry may bypass the shared Link boundary"
  );

  const productLinks = reachableSources
    .filter((path) => /<AuthenticatedLink\b/.test(source(path)))
    .toSorted();
  assert.deepEqual(productLinks, [...PERSISTENT_LINK_CONSUMERS].toSorted());
  assert.match(source("nav-user.tsx"), /useAuthenticatedNavigationIntent\(\)/);
  assert.match(source("nav-user.tsx"), /recordNavigationIntent\("\/login"\)/);
});

test("only the shared authenticated boundary imports Next Link", () => {
  const boundary = source("authenticated-navigation.tsx");
  assert.match(boundary, /from ["']next\/link["']/);
  assert.match(boundary, /onNavigate=/);
  assert.match(boundary, /recordNavigationIntent\(href\)/);
});
