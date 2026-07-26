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

// Resolved from this file, not the cwd — the test must not depend on where it is run from.
const ROOT = path.resolve(import.meta.dirname, "../../..");
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

// ---------------------------------------------------------------------------
// build-until-done: the claim step's blast radius
//
// On 2026-07-26 this step swept the entire `agent:queued` label, claiming 35
// issues for a 2-unit pass (board-design-2026-07.md §11). The prompt was already
// correctly scoped; there was simply no check that it had been obeyed. These
// tests cover the check, not the prompt — an agent's wording cannot be tested
// here, but "does the guard fire, and does it abort before building" can.
// ---------------------------------------------------------------------------

/** Run build-until-done with stubbed globals. `reply(prompt, opts)` answers each agent. */
async function runBuild(units, reply, over = {}) {
  const source = load("build-until-done.js");
  const calls = [];
  const globals = {
    args: { units, maxAttempts: 1, base: "main", ...over },
    log: (m) => calls.push({ kind: "log", value: m }),
    phase: (p) => calls.push({ kind: "phase", value: p }),
    budget: { total: null, spent: () => 0, remaining: () => Infinity },
    agent: async (prompt, opts = {}) => {
      calls.push({
        kind: "agent",
        label: opts.label,
        phase: opts.phase,
        prompt,
      });
      return reply(prompt, opts);
    },
    // Mirrors the runtime contract: a thunk that throws resolves to null.
    parallel: async (thunks) =>
      Promise.all(
        thunks.map((t) =>
          Promise.resolve()
            .then(t)
            .catch(() => null)
        )
      ),
  };
  const fn = new Function(
    ...Object.keys(globals),
    `return (async () => { ${source} })()`
  );
  return { result: await fn(...Object.values(globals)), calls };
}

const buildUnit = (id, issue) => ({
  id,
  title: id.toUpperCase(),
  lane: "backend",
  risk: "low",
  issue,
  files: [`src/${id}.ts`],
  summary: `summary for ${id}`,
  acceptanceCriteria: [`${id} works`],
});

/** Answers the claim step with `inProgressNow`, and fails any later gate fast. */
const replyWith = (inProgressNow, claimed) => (_prompt, opts) => {
  if (opts.label?.startsWith("start:")) return { claimed, inProgressNow };
  if (opts.label?.startsWith("impl:"))
    return { summary: "did the thing", filesTouched: [], notes: "" };
  if (opts.label?.startsWith("verify:"))
    return { verdict: "FAIL", gates: [], blockingReason: "stubbed fail" };
  if (opts.label?.startsWith("block:")) return { labelled: true };
  return {};
};

test("the claim step names an exact issue list and forbids enumerating the label", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyWith([101], [101])
  );
  const claim = calls.find(
    (c) => c.kind === "agent" && c.label === "start:alpha"
  );
  assert.ok(claim, "a claim step must run");
  assert.match(claim.prompt, /EXACTLY these issues and no others: 101/);
  assert.match(
    claim.prompt,
    /Do NOT run `gh issue list`/,
    "the sweep happened because the agent enumerated the label to decide what to edit"
  );
  assert.match(
    claim.prompt,
    /must be exactly 1/,
    "stating the expected count gives the agent a self-check"
  );
});

test("a claim confined to the pass's own issues proceeds to implement", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101), buildUnit("beta", 202)],
    replyWith([101, 202], [101])
  );
  assert.ok(
    calls.some((c) => c.kind === "agent" && c.label?.startsWith("impl:")),
    "the guard must not false-positive on issues the pass legitimately owns"
  );
});

test("a claim that swept issues the pass does not own aborts before building", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    // The real failure: the claim step returns the whole board, not just #101.
    replyWith([101, 15, 16, 18, 62, 98], [101])
  );
  assert.ok(
    !calls.some((c) => c.kind === "agent" && c.label?.startsWith("impl:")),
    "building against a corrupted board is the thing the guard exists to prevent"
  );
  assert.equal(
    result.shipped.length,
    0,
    "an aborted track must not be reported as shipped"
  );
  assert.ok(
    JSON.stringify(result).includes("alpha"),
    "the aborted track must be surfaced, not silently dropped"
  );
});

// ---------------------------------------------------------------------------
// build-until-done: the auto-merge gate
//
// The DoD proves the code does what the spec SAID. It cannot prove the spec was
// right. So the gate is not severity — it is whether a warning raises a question
// about WHAT was built. A spec-question holds the track for a human; a
// code-quality warning is filed as a follow-up issue and the track merges.
// These tests pin that distinction, plus the two unconditional refusals.
// ---------------------------------------------------------------------------

const warn = (kind, summary) => ({
  kind,
  summary,
  detail: `${summary} detail`,
});

/** Drives a track all the way to the ship step with a given verifier report. */
const replyShip = (verifyReport) => (_prompt, opts) => {
  const l = opts.label || "";
  if (l.startsWith("start:")) return { claimed: [101], inProgressNow: [101] };
  if (l.startsWith("impl:"))
    return {
      committed: true,
      filesChanged: [],
      summary: "ok",
      selfCheckPassed: true,
    };
  if (l.startsWith("verify:")) return verifyReport;
  if (l.startsWith("lens:"))
    return { verdict: "PASS", lens: "x", findings: [], summary: "ok" };
  if (l.startsWith("pr:"))
    return { opened: true, url: "https://gh/pr/1", checkConclusion: "success" };
  if (l.startsWith("merge:"))
    return { merged: true, state: "merged", followUpIssues: [901] };
  if (l.startsWith("hold:")) return { merged: false, state: "refused" };
  return {};
};

const passing = (warnings) => ({
  verdict: warnings?.length ? "PASS_WITH_WARNINGS" : "PASS",
  gates: [],
  acceptanceCriteria: [],
  summary: "ok",
  warnings: warnings || [],
});

test("a clean pass auto-merges when autoMerge is on", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([])),
    { autoMerge: true }
  );
  assert.ok(
    calls.some((c) => c.label === "merge:alpha"),
    "a clean pass is exactly what auto-merge exists for"
  );
  assert.equal(result.shipped[0].merge, "merged");
});

test("code-quality warnings do NOT hold the merge — they become follow-up issues", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([warn("code-quality", "date formatted in UTC")])),
    { autoMerge: true }
  );
  const merge = calls.find((c) => c.label === "merge:alpha");
  assert.ok(
    merge,
    "a known small defect is not a reason to stall a good branch"
  );
  assert.match(
    merge.prompt,
    /BEFORE the merge/,
    "the follow-up issue must exist before the merge, so merging cannot lose it"
  );
  assert.deepEqual(result.shipped[0].followUpIssues, [901]);
});

test("a single spec-question holds the track for a human", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(
      passing([
        warn("code-quality", "duplicated constant"),
        warn("spec-question", "is a church-wide packet the intended read?"),
      ])
    ),
    { autoMerge: true }
  );
  assert.ok(
    !calls.some((c) => c.label === "merge:alpha"),
    "shipping a product decision the human never made is the failure this prevents"
  );
  assert.ok(calls.some((c) => c.label === "hold:alpha"));
  assert.equal(
    result.shipped[0].merge,
    "held-for-review",
    "the report must name WHY it did not merge, not just that it did not"
  );
  assert.deepEqual(result.shipped[0].heldBy, [
    "is a church-wide packet the intended read?",
  ]);
});

test("risk:high never auto-merges, even on a spotless pass", async () => {
  const { calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), risk: "high" }],
    replyShip(passing([])),
    { autoMerge: true }
  );
  assert.ok(
    !calls.some((c) => c.label === "merge:alpha"),
    "schema/auth/tenancy is where a bad merge is unrecoverable"
  );
  const hold = calls.find((c) => c.label === "hold:alpha");
  assert.match(hold.prompt, /risk:high/);
});

test("auto-merge is off by default, so a direct call cannot merge to main", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]))
  );
  assert.ok(
    !calls.some((c) => c.label === "merge:alpha" || c.label === "hold:alpha"),
    "opting in must be explicit — /deliver must not merge by surprise"
  );
  assert.equal(result.shipped[0].merge, "not-attempted");
});
