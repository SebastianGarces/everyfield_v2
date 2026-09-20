import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import console from "node:console";
import process from "node:process";

// Read-only inventory. Deleting a legacy entrypoint is gated by migrating its
// importers and preserving live assertions, not by this report alone.
const roots = [
  "src/app/api/evry/conversations",
  "src/app/api/evry/requests",
  "src/app/api/evry/runs",
  "src/lib/evry/runs",
  "src/lib/evry/models",
  "src/lib/evry/policy/classify",
  "src/lib/evry/policy/prompt",
  "src/lib/evry/conversations/service",
  "src/lib/evry/conversations/reuse",
  "src/lib/evry/capabilities/model-turn",
  "src/lib/evry/capabilities/model-response",
  "src/lib/evry/capabilities/model-conversation",
  "src/lib/evry/capabilities/production",
  "src/lib/evry/artifacts/production-lifecycle",
];
const files = execFileSync("rg", ["--files", "src", "scripts", "ops"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((file) => /\.(?:[cm]?ts|tsx|mjs)$/.test(file));
const matchesRoot = (value) =>
  roots.find(
    (root) =>
      value === root ||
      value.startsWith(`${root}/`) ||
      value.startsWith(`${root}.`)
  );
const callers = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(
    /(?:from\s*|import\s*\(|require\s*\()(["'])([^"']+)\1/g
  )) {
    const specifier = match[2];
    const resolved = specifier.startsWith("@/")
      ? `src/${specifier.slice(2)}`
      : specifier.startsWith(".")
        ? path.posix.normalize(
            path.posix.join(path.posix.dirname(file), specifier)
          )
        : specifier;
    const legacy = matchesRoot(resolved);
    if (!legacy) continue;
    callers.push({
      file,
      line: source.slice(0, match.index).split("\n").length,
      legacy,
      kind: /(?:live|proof)/.test(file)
        ? "live-or-protocol-proof"
        : /\.test\./.test(file)
          ? "unit-test"
          : "production-or-script",
    });
  }
}
const report = {
  roots,
  liveOrProtocolCallers: callers.filter(
    ({ kind }) => kind === "live-or-protocol-proof"
  ),
  callers,
};
console.log(
  JSON.stringify(
    process.argv.includes("--summary")
      ? {
          legacyFiles: files.filter((file) => matchesRoot(file)).length,
          importerCount: new Set(callers.map(({ file }) => file)).size,
          liveOrProtocolCallers: report.liveOrProtocolCallers,
        }
      : report,
    null,
    2
  )
);
