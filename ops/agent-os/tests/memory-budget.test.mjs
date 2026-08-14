// The memory/ budget, measured.
//
// memory/ is read before source on almost every agent pass, so its size is a
// recurring token cost on work that has nothing to do with it. The budget was a
// prose rule for a long time and nothing counted the bytes, so it drifted by
// roughly seven times. A byte count is cheaper than any agent pass, and it is the
// only thing that stops the regrowth.
//
// Two numbers, and they are the contract stated in memory/index.md:
//   - memory/invariants.md   <= 50 KB  (every rule still lives in this one file)
//   - the whole memory/ tree <= 140 KB (ruled 2026-08-14: pins the rewritten tree at ~135 KB; do not raise without a ruling)
//
// If a rule genuinely needs more room, shorten another rule or move the why into
// memory/invariants/<domain>.md — do not raise the number without a ruling.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Resolved from this file, not the cwd — the test must not depend on where it is run from.
const ROOT = path.resolve(import.meta.dirname, "../../..");
const MEMORY_DIR = path.join(ROOT, "memory");

const KB = 1024;
const INVARIANTS_LIMIT = 50 * KB;
const TREE_LIMIT = 140 * KB;

/** Every file under memory/, with its size in bytes. */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!entry.isFile()) return [];
    return [{ path: path.relative(ROOT, full), bytes: fs.statSync(full).size }];
  });
}

const asKb = (bytes) => `${(bytes / KB).toFixed(1)} KB`;

test("memory/invariants.md stays under 50 KB", () => {
  const bytes = fs.statSync(path.join(MEMORY_DIR, "invariants.md")).size;
  assert.ok(
    bytes <= INVARIANTS_LIMIT,
    `memory/invariants.md is ${asKb(bytes)}, over the ${asKb(INVARIANTS_LIMIT)} budget. ` +
      `Every rule stays, but each one is 1-3 sentences: move a non-derivable why down into ` +
      `memory/invariants/<domain>.md and delete the history around it.`
  );
});

test("the memory/ tree stays under 140 KB", () => {
  const files = walk(MEMORY_DIR);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const biggest = [...files]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5)
    .map((file) => `  ${file.path} — ${asKb(file.bytes)}`)
    .join("\n");
  assert.ok(
    total <= TREE_LIMIT,
    `memory/ is ${asKb(total)} across ${files.length} files, over the ${asKb(TREE_LIMIT)} ` +
      `budget. Largest files:\n${biggest}`
  );
});
