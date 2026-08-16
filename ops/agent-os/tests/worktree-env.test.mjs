// Tests for scripts/worktree-env.sh — the one mechanism that gives a track's
// worktree a working test env.
//
// The bug being fenced in: `git worktree add` materialises tracked files only, so
// a fresh worktree has no `.env.local`, and `pnpm test`
// (`tsx --env-file-if-exists=.env.local`) then fails every DB-touching suite for a
// reason unrelated to the change under test. Ten suites went red for every
// validating agent until someone improvised an env file.
//
// These run the real script against throwaway git repos — no network, no database,
// nothing touched outside a temp directory. The last block asserts the *wiring*:
// the loop and the validate-* skills must POINT at the script rather than each
// carrying their own copy of the instructions.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
// Imported rather than used as a global: eslint lints ops/ without node globals.
import process from "node:process";

// Resolved from this file, not the cwd — the test must not depend on where it is run from.
const ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/worktree-env.sh");

// Hermetic git: no global/system config, no identity, no prompts.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: GIT_ENV,
  });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function run(...args) {
  const opts = typeof args.at(-1) === "object" ? args.pop() : {};
  return spawnSync(SCRIPT, args, {
    encoding: "utf8",
    env: GIT_ENV,
    cwd: opts.cwd,
  });
}

/** A throwaway repo with a committed .gitignore, plus a worktree helper. */
function makeRepo(
  t,
  { ignoreEnv = true, mainEnv = "DATABASE_URL=main\n" } = {}
) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "wt-env-"))
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const main = path.join(dir, "main");
  fs.mkdirSync(main);
  spawnSync("git", ["init", "-q", "-b", "main", main], { env: GIT_ENV });
  fs.writeFileSync(
    path.join(main, ".gitignore"),
    ignoreEnv ? "node_modules\n.env.local\n" : "node_modules\n"
  );
  fs.writeFileSync(path.join(main, "README.md"), "throwaway\n");
  git(main, "add", ".");
  git(
    main,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-qm",
    "init"
  );
  if (mainEnv !== null)
    fs.writeFileSync(path.join(main, ".env.local"), mainEnv);

  const addWorktree = (name = "wt") => {
    const wt = path.join(dir, name);
    git(main, "worktree", "add", "-q", "-b", `feature/${name}`, wt);
    return wt;
  };
  return { dir, main, addWorktree };
}

test("links the main checkout's .env.local into a fresh worktree", (t) => {
  const { main, addWorktree } = makeRepo(t);
  const wt = addWorktree();

  assert.equal(
    fs.existsSync(path.join(wt, ".env.local")),
    false,
    "precondition"
  );

  const r = run(wt);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /linked \.env\.local/);

  const dst = path.join(wt, ".env.local");
  assert.ok(
    fs.lstatSync(dst).isSymbolicLink(),
    "a link, not a copy of the secrets"
  );
  assert.equal(fs.readFileSync(dst, "utf8"), "DATABASE_URL=main\n");
  assert.equal(fs.realpathSync(dst), path.join(main, ".env.local"));
});

test("the linked env is ignored, so the worktree stays committable-clean", (t) => {
  const { addWorktree } = makeRepo(t);
  const wt = addWorktree();
  assert.equal(run(wt).status, 0);

  assert.equal(
    git(wt, "status", "--porcelain"),
    "",
    "git status must be empty"
  );
  assert.equal(
    git(wt, "status", "--porcelain", "--ignored").includes(".env.local"),
    true,
    "and it must be there as an *ignored* file, i.e. unstageable by accident"
  );
});

test("the env dies with the worktree and leaves the main checkout intact", (t) => {
  const { main, addWorktree } = makeRepo(t);
  const wt = addWorktree();
  assert.equal(run(wt).status, 0);

  // No --force: an ignored file must not stand in the way of a clean removal.
  git(main, "worktree", "remove", wt);

  assert.equal(fs.existsSync(wt), false, "worktree gone, link with it");
  assert.equal(
    fs.readFileSync(path.join(main, ".env.local"), "utf8"),
    "DATABASE_URL=main\n",
    "removing a worktree must never eat the human's env file"
  );
});

test("is idempotent and never clobbers an env the worktree already has", (t) => {
  const { addWorktree } = makeRepo(t);
  const wt = addWorktree();
  fs.writeFileSync(
    path.join(wt, ".env.local"),
    "DATABASE_URL=track-specific\n"
  );

  const r = run(wt);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already present/);
  assert.equal(
    fs.readFileSync(path.join(wt, ".env.local"), "utf8"),
    "DATABASE_URL=track-specific\n"
  );
  assert.equal(
    fs.lstatSync(path.join(wt, ".env.local")).isSymbolicLink(),
    false
  );

  // Running it twice over its own link is also a no-op.
  const fresh = addWorktree("wt2");
  assert.equal(run(fresh).status, 0);
  const second = run(fresh);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already present/);
});

test("works from inside the worktree with no argument", (t) => {
  const { addWorktree } = makeRepo(t);
  const wt = addWorktree();

  const r = run({ cwd: wt });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.lstatSync(path.join(wt, ".env.local")).isSymbolicLink());
});

test("is a no-op in the main checkout", (t) => {
  const { main } = makeRepo(t, { mainEnv: null });

  const r = run(main);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /main checkout/);
  assert.equal(fs.existsSync(path.join(main, ".env.local")), false);
});

test("fails loudly and actionably when the main checkout has no .env.local", (t) => {
  const { addWorktree } = makeRepo(t, { mainEnv: null });
  const wt = addWorktree();

  const r = run(wt);
  assert.equal(r.status, 1, "a missing source env must not pass silently");
  assert.match(r.stderr, /no \.env\.local in the main checkout/);
  assert.match(r.stderr, /DATABASE_URL/);
  assert.match(r.stderr, /\.env\.example/, "says how to create one");
  assert.match(r.stderr, /worktree-env\.sh/, "says how to re-run");
  assert.equal(fs.existsSync(path.join(wt, ".env.local")), false);
});

test("refuses to place the file if it is not gitignored in the worktree", (t) => {
  const { addWorktree } = makeRepo(t, { ignoreEnv: false });
  const wt = addWorktree();

  const r = run(wt);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /NOT gitignored/);
  assert.equal(
    fs.existsSync(path.join(wt, ".env.local")),
    false,
    "never create a file the worktree would offer up for commit"
  );
});

test("--check reports the gap without creating anything, and passes once linked", (t) => {
  const { addWorktree } = makeRepo(t);
  const wt = addWorktree();

  const before = run("--check", wt);
  assert.equal(before.status, 1);
  assert.match(before.stdout, /missing/);
  assert.equal(
    fs.existsSync(path.join(wt, ".env.local")),
    false,
    "check must not write"
  );

  assert.equal(run(wt).status, 0);
  const after = run("--check", wt);
  assert.equal(after.status, 0, after.stderr);
});

test("rejects an unknown flag and a non-directory target", (t) => {
  const { addWorktree } = makeRepo(t);
  const wt = addWorktree();

  assert.equal(run("--nope", wt).status, 2);
  assert.equal(run(path.join(wt, "does-not-exist")).status, 2);
});

// --- Wiring: one mechanism, referenced — not copy-pasted per prompt. ---

const REFERENCES = [".claude/workflows/build-until-done.js"];

test("the script is executable, so prompts can just call it", () => {
  assert.ok(
    fs.statSync(SCRIPT).mode & 0o111,
    "scripts/worktree-env.sh must be +x"
  );
});

test("the loop's worktree-creation step points at the script", () => {
  const loop = fs.readFileSync(
    path.join(ROOT, ".claude/workflows/build-until-done.js"),
    "utf8"
  );
  // From the creation line to the end of that prompt, rather than a fixed
  // character window: the step legitimately grew a second (resume) path, which
  // pushed the env line past 600 chars without weakening anything.
  const creation = loop.slice(
    loop.indexOf("git worktree add -b"),
    loop.indexOf("label: `setup:")
  );
  assert.match(
    creation,
    /scripts\/worktree-env\.sh/,
    "worktree creation must set up the env"
  );
});

test("every prompt and skill that needs the env references the one script", () => {
  for (const rel of REFERENCES) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(
      text,
      /scripts\/worktree-env\.sh/,
      `${rel} must reference the script`
    );
  }
});

test("no prompt or skill re-implements the mechanism", () => {
  const dirs = [
    ".claude/workflows",
    ".claude/skills",
    ".cursor",
    "ops/agent-os",
  ];
  const files = dirs.flatMap((d) =>
    fs
      .readdirSync(path.join(ROOT, d), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && /\.(js|md|mjs)$/.test(e.name))
      .map((e) => path.join(e.parentPath ?? e.path, e.name))
  );

  for (const file of files) {
    if (file.endsWith("worktree-env.test.mjs")) continue;
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    assert.doesNotMatch(
      text,
      /ln -s .*\.env|cp .*\.env\.local|cp \.env\.example/,
      `${rel} hand-rolls the env instead of calling scripts/worktree-env.sh`
    );
  }
});
