// Read-only inventory. Textual references are evidence to inspect, not proof of use.
// Run from any directory: node /path/to/repo/ops/script-inventory.mjs
import { execFileSync } from "node:child_process";
import { log } from "node:console";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter((file) => file && existsSync(resolve(root, file)));
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
  ".py",
]);
const textExtensions = new Set([
  ...sourceExtensions,
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
]);
const texts = files
  .filter((file) => textExtensions.has(extname(file)))
  .map((file) => [file, readFileSync(resolve(root, file), "utf8")]);
const scripts = files.filter(
  (file) =>
    /^(scripts\/|ops\/|\.cursor\/hooks\/)/.test(file) &&
    sourceExtensions.has(extname(file))
);
const inventory = scripts.map((script) => {
  const references = texts.flatMap(([file, text]) => {
    if (file === script) return [];
    let specifier = relative(dirname(file), script);
    if (!specifier.startsWith(".")) specifier = `./${specifier}`;
    const extensionless = specifier.slice(0, -extname(script).length);
    const mentioned = text.includes(script) || text.includes(basename(script));
    const imported = ['"', "'", "`"].some((quote) =>
      text.includes(`${quote}${extensionless}${quote}`)
    );
    return mentioned || imported ? [file] : [];
  });
  return { path: script, test: /\.test\./.test(script), references };
});
const { scripts: packageCommands } = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8")
);
log(JSON.stringify({ packageCommands, files: inventory }, null, 2));
