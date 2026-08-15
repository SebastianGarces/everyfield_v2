// The memory/ budget, measured.
//
// memory/ is read before source on almost every agent pass, so its size is a
// recurring token cost on work that has nothing to do with it. The budget was a
// prose rule for a long time and nothing counted the bytes, so it drifted by
// roughly seven times. A byte count is cheaper than any agent pass, and it is the
// only thing that stops the regrowth.
//
// Two numbers, and they are the contract stated in memory/index.md:
//   - memory/invariants.md   <= 64 KB  (every rule still lives in this one file)
//   - the whole memory/ tree <= 178 KB
//
// Ruled 2026-08-14, and re-pinned twice since on the same procedure — COMPRESSION
// PASS FIRST, then re-pin what is left: the rewrite pinned ~135 KB; the same-day
// merge of the #432 race-guard rulings and #434 wiki security rounds re-pinned
// ~172 KB; and on 2026-08-15 the F11 callers (#321) and the deferred-assessment
// status (#376) landed ten rules between them, which compressed to ~175.5 KB.
//
// WHAT THE CAP GOVERNS IS RULE LENGTH, NOT RULE COUNT. Each rule stays 1-3
// sentences and the why that is not derivable from source moves into
// memory/invariants/<domain>.md; a feature that earns a genuine invariant is not
// asked to delete someone else's to fit. So: shorten before you raise, raise only
// after a compression pass has actually run, and say in the raise what it bought.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Resolved from this file, not the cwd — the test must not depend on where it is run from.
const ROOT = path.resolve(import.meta.dirname, "../../..");
const MEMORY_DIR = path.join(ROOT, "memory");

const KB = 1024;
const INVARIANTS_LIMIT = 64 * KB;
const TREE_LIMIT = 178 * KB;

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

test("memory/invariants.md stays under 64 KB", () => {
  const bytes = fs.statSync(path.join(MEMORY_DIR, "invariants.md")).size;
  assert.ok(
    bytes <= INVARIANTS_LIMIT,
    `memory/invariants.md is ${asKb(bytes)}, over the ${asKb(INVARIANTS_LIMIT)} budget. ` +
      `Every rule stays, but each one is 1-3 sentences: move a non-derivable why down into ` +
      `memory/invariants/<domain>.md and delete the history around it.`
  );
});

test("the memory/ tree stays under 178 KB", () => {
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
