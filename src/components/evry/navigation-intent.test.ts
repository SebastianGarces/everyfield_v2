import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const EVRY_COMPONENT_ROOT = dirname(new URL(import.meta.url).pathname);

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
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

test("every Evry-owned Next Link passes through the navigation boundary", () => {
  const productionSources = sourceFiles(EVRY_COMPONENT_ROOT).filter(
    (path) => !/\.test\.tsx?$|-proof\.tsx?$/.test(path)
  );
  const directImports = productionSources
    .filter((path) =>
      /from ["']next\/link["']/.test(readFileSync(path, "utf8"))
    )
    .map((path) => relative(EVRY_COMPONENT_ROOT, path));
  assert.deepEqual(directImports, ["navigation-intent.tsx"]);

  const productLinks = productionSources
    .filter((path) => /<EvryLink\b/.test(readFileSync(path, "utf8")))
    .map((path) => relative(EVRY_COMPONENT_ROOT, path))
    .toSorted();
  assert.deepEqual(productLinks, [
    "artifacts/artifact-renderer.tsx",
    "conversation-history/history-list.tsx",
  ]);
});
