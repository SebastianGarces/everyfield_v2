// Codex must load the same workflow and mechanical guardrails as Claude Code.
// This test pins the adapters so a future Claude-only workflow change cannot
// silently leave Codex running a different process.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SYNC = path.join(ROOT, "ops/sync-codex-setup.mjs");
const FORMAT = path.join(ROOT, "ops/format-agent-edit.sh");
const SESSION = path.join(ROOT, "ops/codex-session-context.sh");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("generated Codex skills and custom agents are in sync", () => {
  const result = spawnSync("node", [SYNC, "--check"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /12 workflow skills and 4 custom agents/);
});

test("Codex hooks load principles, guard pnpm, and format edited files", () => {
  const config = JSON.parse(read(".codex/hooks.json"));
  const hooks = config.hooks;

  assert.match(
    hooks.SessionStart[0].hooks[0].command,
    /codex-session-context\.sh/
  );
  assert.ok(
    hooks.SessionStart[0].hooks[0].additionalContextLimit >= 8000,
    "the full engineering principles must fit in SessionStart context"
  );
  assert.match(
    hooks.PreToolUse[0].hooks[0].command,
    /guard-worktree-pnpm-hook\.sh/
  );
  assert.equal(hooks.PreToolUse[0].matcher, "Bash");
  assert.match(hooks.PostToolUse[0].hooks[0].command, /format-agent-edit\.sh/);
  assert.match(hooks.PostToolUse[0].matcher, /Edit\|Write/);
  assert.doesNotMatch(JSON.stringify(config), /impeccable/);
});

test("the formatter extracts every Codex apply_patch output path", () => {
  const event = {
    cwd: ROOT,
    tool_input: {
      command: [
        "*** Begin Patch",
        "*** Update File: AGENTS.md",
        "*** Add File: ops/new-file.js",
        "*** Delete File: ops/old-file.js",
        "*** Update File: old-name.js",
        "*** Move to: new-name.js",
        "*** End Patch",
      ].join("\n"),
    },
  };
  const result = spawnSync("bash", [FORMAT, "--list"], {
    cwd: ROOT,
    input: JSON.stringify(event),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "AGENTS.md",
    "ops/new-file.js",
    "old-name.js",
    "new-name.js",
  ]);
});

test("Claude and Cursor use the same formatter adapter as Codex", () => {
  const claude = JSON.parse(read(".claude/settings.json"));
  const claudeCommand = claude.hooks.PostToolUse.flatMap((group) =>
    group.hooks.map((hook) => hook.command)
  ).join("\n");
  assert.match(claudeCommand, /format-agent-edit\.sh/);
  assert.match(read(".cursor/hooks/format.sh"), /format-agent-edit\.sh/);
});

test("Codex-managed worktrees receive the ignored local env file", () => {
  const included = read(".worktreeinclude")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  assert.deepEqual(included, [".env.local"]);
  assert.match(read(".gitignore"), /^\.env\.local$/m);
});

test("stale Codex-only skill copies are gone", () => {
  assert.equal(
    fs.existsSync(path.join(ROOT, ".codex/skills/work-in-progress/SKILL.md")),
    false
  );
  assert.equal(
    fs.existsSync(path.join(ROOT, ".codex/skills/requirements-docs/SKILL.md")),
    false
  );
});

test("the Codex SessionStart adapter emits the real principles", () => {
  const result = spawnSync("bash", [SESSION], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Engineering principles/m);
  assert.match(result.stdout, /^# Prove It Works$/m);
  assert.match(result.stdout, /^# Build the Lever$/m);
});

test("mirrored overnight work uses the current host's native handoff", () => {
  const skill = read(".agents/skills/work-overnight/SKILL.md");
  assert.doesNotMatch(skill, /Then update the session handoff memory\./);
  assert.match(skill, /Claude updates its session handoff memory/);
  assert.match(skill, /Codex relies on the task history and native handoff/);
});
