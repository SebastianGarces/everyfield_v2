// Tests for the deterministic halves of the FRD build workflows.
//
// `frd-plan.js` and `frd-implement.js` are Workflow scripts: the runtime evaluates
// them inside an async function with `agent`, `phase`, `log`, `pipeline` and `args`
// injected as globals, which is why they use a top-level `return`. That shape means
// they cannot be imported — so these tests reconstruct the same wrapper and inject
// stubbed globals, exercising the grouping, ordering and cycle logic without
// spending a single agent call.
//
// What is covered is exactly what a stubbed run can prove: the deterministic
// scheduling. Prompt wording and agent behaviour are not, and cannot be, tested here.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const load = (name) =>
  fs
    .readFileSync(path.join(ROOT, ".claude/workflows", name), "utf8")
    .replace(/^export const meta/m, "const meta");

/** Run a workflow script with stubbed globals. `agentImpl(prompt, opts)` decides each reply. */
async function runWorkflow(source, { args: argv, agentImpl, pipelineImpl }) {
  const calls = [];
  const globals = {
    args: argv,
    log: (m) => calls.push({ kind: "log", value: m }),
    phase: (p) => calls.push({ kind: "phase", value: p }),
    agent: async (prompt, opts = {}) => {
      calls.push({
        kind: "agent",
        phase: opts.phase,
        label: opts.label,
        prompt,
      });
      return agentImpl(prompt, opts);
    },
    pipeline:
      pipelineImpl ||
      (async (items, ...stages) => {
        const out = [];
        for (const item of items) {
          let v = item;
          for (const s of stages) v = await s(v, item, items.indexOf(item));
          out.push(v);
        }
        return out;
      }),
  };
  const fn = new Function(
    ...Object.keys(globals),
    `return (async () => { ${source} })()`
  );
  return { result: await fn(...Object.values(globals)), calls };
}

const unit = (id, over = {}) => ({
  id,
  title: id.toUpperCase(),
  lane: "backend",
  risk: "low",
  files: [`src/${id}.ts`],
  summary: `summary for ${id}`,
  acceptanceCriteria: [`${id} works`],
  dependsOn: [],
  ...over,
});

const planWith = (units, deferred = []) => ({ units, deferred, notes: "" });

const runPlan = (decomposition, argv, publishReply) =>
  runWorkflow(load("frd-plan.js"), {
    args: argv,
    agentImpl: (_p, opts) =>
      opts.phase === "Decompose" ? decomposition : publishReply,
  });

// ---------------------------------------------------------------------------
// frd-plan: the two constraints must stay separate
// ---------------------------------------------------------------------------

test("units sharing a file collapse into one track", async () => {
  const { result } = await runPlan(
    planWith([
      unit("a", { files: ["src/shared.ts"] }),
      unit("b", { files: ["src/shared.ts"] }),
      unit("c"),
    ]),
    { frd: "f.md", publish: false }
  );
  assert.equal(result.dag.length, 2, "a+b share a file, so they are one track");
  const merged = result.dag.find((t) => t.units.length === 2);
  assert.deepEqual(
    merged.units.map((u) => u.id).sort(),
    ["a", "b"],
    "the merged track holds both file-sharing units"
  );
});

test("a dependsOn edge does NOT merge tracks — it becomes a blocking edge", async () => {
  const { result } = await runPlan(
    planWith([unit("base"), unit("dependent", { dependsOn: ["base"] })]),
    { frd: "f.md", publish: false }
  );
  assert.equal(
    result.dag.length,
    2,
    "a dependency keeps them on separate branches"
  );
  const dependent = result.dag.find((t) => t.trackId === "dependent");
  assert.deepEqual(dependent.blockedBy, ["base"]);
});

test("high-risk units are auto-gated, and dependencies on them survive as edges", async () => {
  // The old wave model dropped gated dependencies ("wave 0/human") and conveyed
  // "schema lands first" only in prose. Here it has to be durable state.
  const { result } = await runPlan(
    planWith([
      unit("schema", { risk: "high", files: ["src/db/schema.ts"] }),
      unit("service", { dependsOn: ["schema"] }),
    ]),
    { frd: "f.md", publish: false }
  );
  assert.ok(
    result.prerequisites.some((p) => p.id === "schema"),
    "the high-risk unit is pulled out as a prerequisite"
  );
  assert.deepEqual(
    result.dag.find((t) => t.trackId === "service").blockedByPrerequisite,
    ["schema"],
    "the dependency on the gated unit is kept, not dropped"
  );
});

// ---------------------------------------------------------------------------
// frd-plan: ordering and safety
// ---------------------------------------------------------------------------

test("tracks are published blockers-first so edges can reference real numbers", async () => {
  const { result } = await runPlan(
    planWith([
      unit("third", { dependsOn: ["second"] }),
      unit("first"),
      unit("second", { dependsOn: ["first"] }),
    ]),
    { frd: "f.md", publish: false }
  );
  const order = result.dag.map((t) => t.trackId);
  assert.ok(
    order.indexOf("first") < order.indexOf("second") &&
      order.indexOf("second") < order.indexOf("third"),
    `expected topological order, got ${order.join(" -> ")}`
  );
});

test("a dependency cycle throws instead of publishing a permanently stuck board", async () => {
  // Every member of a cycle has an open blocker forever, so none can ever reach
  // the frontier. Better to fail loudly at plan time than to publish a deadlock.
  await assert.rejects(
    runPlan(
      planWith([
        unit("p", { dependsOn: ["q"] }),
        unit("q", { dependsOn: ["p"] }),
      ]),
      { frd: "f.md", publish: false }
    ),
    /cycle/i
  );
});

test("publish:false plans without writing to the board", async () => {
  const { result, calls } = await runPlan(planWith([unit("solo")]), {
    frd: "f.md",
    publish: false,
  });
  assert.equal(result.published, false);
  assert.ok(
    !calls.some((c) => c.kind === "agent" && c.phase === "Publish"),
    "the Publish agent must not run on a dry run"
  );
});

test("publishing maps the returned issue numbers back onto the DAG", async () => {
  const { result, calls } = await runPlan(
    planWith([unit("first"), unit("second", { dependsOn: ["first"] })]),
    { frd: "f.md" },
    {
      parentIssue: 72,
      published: [
        { trackId: "first", issue: 201, created: true },
        { trackId: "second", issue: 202, created: true },
      ],
      edges: ["202<-201"],
      notes: "",
    }
  );
  assert.equal(result.parentIssue, 72);
  assert.equal(result.dag.find((t) => t.trackId === "second").issue, 202);

  const prompt = calls.find(
    (c) => c.kind === "agent" && c.phase === "Publish"
  ).prompt;
  assert.ok(
    prompt.indexOf('"first"') < prompt.indexOf('"second"'),
    "the publish prompt lists blockers before what they block"
  );
});

// ---------------------------------------------------------------------------
// frd-implement: the frontier drives the run
// ---------------------------------------------------------------------------

const frontierUnit = (id, over = {}) => ({
  issue: 100 + id.length,
  id,
  title: id.toUpperCase(),
  lane: "backend",
  files: [`src/${id}.ts`],
  summary: `do ${id}`,
  acceptanceCriteria: [`${id} works`],
  risk: "low",
  ...over,
});

const runImplement = (board, argv = {}) =>
  runWorkflow(load("frd-implement.js"), {
    args: argv,
    agentImpl: (_p, opts) => {
      if (opts.phase === "Frontier") return board;
      if (opts.phase === "Implement")
        return {
          branch: `feature/${opts.label.replace("impl:", "")}`,
          unitsCompleted: [],
          filesChanged: [],
          summary: "",
          selfCheckPassed: true,
        };
      if (opts.phase === "Review")
        return { verdict: "PASS", critical: [], warnings: [], summary: "" };
      return { updated: [], notes: "" };
    },
  });

test("an empty frontier returns early without implementing anything", async () => {
  const { result, calls } = await runImplement({
    frontier: [],
    blocked: [{ issue: 94, title: "T-018", waitingOn: [29] }],
    notes: "everything waits on #29",
  });
  assert.match(result.summary, /empty/i);
  assert.equal(result.blocked.length, 1);
  assert.ok(
    !calls.some((c) => c.kind === "agent" && c.phase === "Implement"),
    "nothing may be built when nothing is takeable"
  );
});

test("frontier issues that share a file are built on one branch, in order", async () => {
  // The frontier guarantees no issue here waits on another. It says nothing about
  // files, so two unblocked issues can still both own a barrel — and parallel
  // worktrees would collide.
  const { result } = await runImplement({
    frontier: [
      frontierUnit("alpha", { files: ["src/db/index.ts"] }),
      frontierUnit("beta", { files: ["src/db/index.ts"] }),
      frontierUnit("gamma"),
    ],
    blocked: [],
    notes: "",
  });
  assert.equal(result.branches.length, 2, "alpha+beta merge into one track");
  const combined = result.branches.find((b) => b.issues.length === 2);
  assert.ok(combined, "the file-sharing issues land on a single branch");
});

test("every frontier issue's number is carried through to the result", async () => {
  const { result } = await runImplement({
    frontier: [frontierUnit("solo")],
    blocked: [],
    notes: "",
  });
  assert.deepEqual(result.branches[0].issues, [104]);
});

test("the frontier prompt claims issues before returning them", async () => {
  const { calls } = await runImplement({
    frontier: [frontierUnit("solo")],
    blocked: [],
    notes: "",
  });
  const prompt = calls.find(
    (c) => c.kind === "agent" && c.phase === "Frontier"
  ).prompt;
  assert.match(
    prompt,
    /--add-assignee @me/,
    "claiming prevents two runs taking the same issue"
  );
  assert.match(
    prompt,
    /blocked_by/,
    "the frontier is defined by open blockers"
  );
});

test("a candidate list is passed through to the frontier query", async () => {
  const { calls } = await runImplement(
    { frontier: [frontierUnit("solo")], blocked: [], notes: "" },
    { issues: [11, 22] }
  );
  const prompt = calls.find(
    (c) => c.kind === "agent" && c.phase === "Frontier"
  ).prompt;
  assert.match(prompt, /11, 22/);
});

test("the run settles the board rather than leaving issues in-progress", async () => {
  const { calls } = await runImplement({
    frontier: [frontierUnit("solo")],
    blocked: [],
    notes: "",
  });
  const settle = calls.find((c) => c.kind === "agent" && c.phase === "Settle");
  assert.ok(
    settle,
    "a Settle phase must run so claimed issues do not go stale"
  );
  assert.match(
    settle.prompt,
    /must not be promoted to `agent:in-review`/,
    "this workflow runs no DoD and opens no PR, so it cannot claim review-readiness"
  );
});
