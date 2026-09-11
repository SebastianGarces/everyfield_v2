import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

// The last reviewed preview, before capability-pack consolidation. This checks
// existing chat markup only; browser validation still proves behavior and styling.
const baseline = process.argv[2] ?? "f1a607f6ad178a00d65e99bc6bc2668c67b37eda";
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" });
const paths = git(
  "ls-tree",
  "-r",
  "--name-only",
  baseline,
  "src/components/evry"
)
  .trim()
  .split("\n")
  .filter((path) => path.endsWith(".tsx"));
const printer = ts.createPrinter({ removeComments: true });

function markup(path: string, text: string) {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const nodes: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      nodes.push(printer.printNode(ts.EmitHint.Unspecified, node, source));
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return nodes;
}

for (const path of paths) {
  assert.deepEqual(
    markup(path, readFileSync(path, "utf8")),
    markup(path, git("show", `${baseline}:${path}`)),
    `${path}: reviewed chat markup changed; inspect before accepting this integration`
  );
}
console.log(
  `Reviewed chat markup preserved in ${paths.length} components against ${baseline}.`
);
