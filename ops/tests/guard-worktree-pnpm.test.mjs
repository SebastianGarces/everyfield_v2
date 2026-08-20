// Tests for ops/guard-worktree-pnpm.sh — the block against the
// worktree/node_modules entanglement.
//
// The bug being fenced in: a worktree's node_modules symlinked to the parent
// checkout's, then `pnpm install` run through it. pnpm realpaths the modules
// dir to the parent but computes the virtual store through the worktree path,
// rewiring the parent's top-level links to
// `../.claude/worktrees/<name>/node_modules/.pnpm/...` — dead the moment the
// worktree is deleted (40 broken links on 2026-08-19). pnpm runs root
// lifecycle scripts only AFTER linking (proven 2026-08-20), so the guard must
// fire before pnpm does: PreToolUse for Claude, beforeShellExecution for
// Cursor, both pointing at this one script.
//
// These run the real script against throwaway directories — no pnpm, no
// network. The last block asserts the *wiring*: both hook configs and the
// package.json tripwire must point at the mechanism, or the guard is prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Resolved from this file, not the cwd — the test must not depend on where it is run from.
const ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPT = path.join(ROOT, "ops/guard-worktree-pnpm.sh");

function guard(cwd, command) {
  const r = spawnSync("bash", [SCRIPT, cwd, command], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "").trim() };
}

// A parent project with a real node_modules, and a worktree whose
// node_modules is a symlink back to the parent's — the poisoned state.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-wt-"));
  const parent = path.join(dir, "repo");
  const wt = path.join(parent, ".claude", "worktrees", "bud-test");
  fs.mkdirSync(path.join(parent, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(parent, "package.json"), "{}");
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, "package.json"), "{}");
  fs.symlinkSync(
    path.join("..", "..", "..", "node_modules"),
    path.join(wt, "node_modules")
  );
  return { dir, parent, wt };
}

test("allows pnpm install where node_modules is a real directory", () => {
  const { parent } = fixture();
  assert.equal(guard(parent, "pnpm install").code, 0);
  assert.equal(guard(parent, "CI=true pnpm install --prefer-offline").code, 0);
});

test("allows commands that are neither pnpm nor a node_modules symlink", () => {
  const { wt } = fixture();
  // Even in the poisoned worktree: reading is fine, only (re)linking is not.
  assert.equal(guard(wt, "git status").code, 0);
  assert.equal(guard(wt, "pnpm test").code, 0);
  assert.equal(guard(wt, "pnpm exec prettier --check .").code, 0);
});

test("blocks pnpm install when the project's node_modules is a symlink", () => {
  const { wt } = fixture();
  for (const cmd of [
    "pnpm install",
    "pnpm i",
    "pnpm add clsx",
    "pnpm remove clsx",
    "pnpm update",
    "pnpm dlx shadcn@latest add button",
  ]) {
    const r = guard(wt, cmd);
    assert.equal(r.code, 1, `expected block for: ${cmd}`);
    assert.match(r.out, /symlink/);
  }
});

test("blocks the cd-into-worktree pattern from an outside cwd", () => {
  const { parent, wt } = fixture();
  const r = guard(parent, `cd ${wt} && pnpm install`);
  assert.equal(r.code, 1);
  assert.match(r.out, /symlink/);
  // Relative cd too — the common agent spelling.
  const rel = guard(parent, "cd .claude/worktrees/bud-test && pnpm install");
  assert.equal(rel.code, 1);
});

test("blocks creating the symlink in the first place", () => {
  const { parent } = fixture();
  for (const cmd of [
    "ln -s ../../../node_modules node_modules",
    "ln -sf /Users/x/repo/node_modules node_modules",
    `cd ${parent} && ln -s ../repo/node_modules node_modules`,
  ]) {
    const r = guard(parent, cmd);
    assert.equal(r.code, 1, `expected block for: ${cmd}`);
    assert.match(r.out, /never symlink node_modules/);
  }
});

test("nearest package.json wins — a healthy nested project is not blamed for an ancestor", () => {
  const { dir } = fixture();
  // ancestor with symlinked node_modules, nested project healthy
  const anc = path.join(dir, "anc");
  const nested = path.join(anc, "packages", "app");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(anc, "package.json"), "{}");
  fs.symlinkSync("/nonexistent", path.join(anc, "node_modules"));
  fs.writeFileSync(path.join(nested, "package.json"), "{}");
  fs.mkdirSync(path.join(nested, "node_modules"));
  assert.equal(guard(nested, "pnpm install").code, 0);
  // and the ancestor itself is still blocked
  assert.equal(guard(anc, "pnpm install").code, 1);
});

test("empty command and cwd without any package.json are allowed", () => {
  const { dir } = fixture();
  assert.equal(guard(dir, "").code, 0);
  assert.equal(guard("/", "pnpm install").code, 0);
});

// ---- wiring: the mechanism must actually be attached, in all three places ----

test("Claude PreToolUse Bash hook points at the guard script", () => {
  const settings = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".claude/settings.json"), "utf8")
  );
  const pre = settings.hooks?.PreToolUse ?? [];
  const bash = pre.find((h) => h.matcher === "Bash");
  assert.ok(bash, "no PreToolUse matcher for Bash in .claude/settings.json");
  const cmd = bash.hooks.map((h) => h.command).join("\n");
  assert.match(cmd, /guard-worktree-pnpm\.sh/);
  assert.match(cmd, /exit 2/, "a PreToolUse hook blocks by exiting 2");
});

test("Cursor beforeShellExecution hook points at the adapter, and the adapter at the script", () => {
  const hooks = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".cursor/hooks.json"), "utf8")
  );
  const before = hooks.hooks?.beforeShellExecution ?? [];
  assert.ok(
    before.some((h) => h.command.includes("guard-worktree-pnpm.sh")),
    "no beforeShellExecution entry for the guard in .cursor/hooks.json"
  );
  const adapter = fs.readFileSync(
    path.join(ROOT, ".cursor/hooks/guard-worktree-pnpm.sh"),
    "utf8"
  );
  assert.match(adapter, /ops\/guard-worktree-pnpm\.sh/);
  assert.match(adapter, /"deny"/);
});

test("package.json carries the preinstall tripwire", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  );
  assert.ok(pkg.scripts.preinstall, "no preinstall script");
  assert.match(pkg.scripts.preinstall, /isSymbolicLink/);
  // The tripwire fires AFTER pnpm has already rewired links (proven) — its
  // message must say the damage is done and name the repair, not imply safety.
  assert.match(pkg.scripts.preinstall, /ALREADY/);
});
