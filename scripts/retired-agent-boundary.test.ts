import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const retired = [
  "src/app/(dashboard)/evry",
  "src/app/api/evry",
  "src/components/evry",
  "src/lib/evry",
  "ops/evry",
];

function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

test("alpha ships no retired agent routes, UI, runtime, or eval commands", () => {
  for (const directory of retired) {
    assert.deepEqual(files(path.join(root, directory)), [], directory);
  }
  const source = files(path.join(root, "src")).filter(
    (file) => /\.tsx?$/.test(file) && !file.includes("/db/schema/")
  );
  for (const file of source) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /(?:from\s*|import\s*\(|require\s*\()["'][^"']*(?:\/evry(?:[/-]|["'])|\/jev(?:[/-]|["']))/,
      path.relative(root, file)
    );
  }
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(
    Object.keys(pkg.scripts).filter((key) => /evry|jev/i.test(key)),
    []
  );
  assert.deepEqual(
    Object.keys(pkg.dependencies).filter((key) =>
      /typesafe|eve-sdk|eve-ai/i.test(key)
    ),
    []
  );
});

test("native alpha keeps its task guards and Plant Intelligence tracing", () => {
  for (const file of [
    "src/db/migrations/0071_task_recurrence_series_guard.sql",
    "src/db/migrations/0072_task_structure_serialization.sql",
    "src/lib/ministry-teams/leadership-lock.ts",
    "src/lib/phase-engine/observability.ts",
  ])
    assert.ok(existsSync(path.join(root, file)), file);
  const tracing = readFileSync(
    path.join(root, "src/lib/observability/langfuse.ts"),
    "utf8"
  );
  assert.match(tracing, /startsWith\("phase-engine\."\)/);
  assert.doesNotMatch(tracing, /startsWith\("evry\."\)/);
});
