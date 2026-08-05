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

/** The issues a label step was told to settle, read out of its own prompt. */
const issuesInLabelPrompt = (prompt) =>
  (prompt.match(/The issues are ([\d, ]+?) and the target/)?.[1] || "")
    .split(",")
    .map((n) => Number(n.trim()))
    .filter(Boolean);

/** Pulls the target label out of a label step's agent label (`label:in-review:x#1`). */
const targetOf = (opts) => `agent:${(opts.label || "").split(":")[1]}`;

/**
 * A label step that honestly reports the target landing on every issue it was
 * asked about — the happy path the guard is measured against.
 */
const labelledOk = (prompt, opts) => ({
  observed: issuesInLabelPrompt(prompt).map((issue) => ({
    issue,
    labels: [targetOf(opts)],
  })),
  prLabels: [targetOf(opts)],
});

/**
 * The track's worktree/branch prep. It runs before any workstream, so every
 * build-path stub needs it: answering `{}` blocks the track before it starts.
 */
const prepped = (prompt) => ({
  ready: true,
  branch: prompt.match(/-b (\S+)/)?.[1] || "feature/x",
});

/** Answers the claim step with `inProgressNow`, and fails any later gate fast. */
const replyWith = (inProgressNow, claimed) => (prompt, opts) => {
  if (opts.label?.startsWith("start:")) return { claimed, inProgressNow };
  if (opts.label?.startsWith("prep:")) return prepped(prompt);
  if (opts.label?.startsWith("impl:"))
    return { summary: "did the thing", filesTouched: [], notes: "" };
  if (opts.label?.startsWith("verify:"))
    return { verdict: "FAIL", gates: [], blockingReason: "stubbed fail" };
  if (opts.label?.startsWith("block:")) return { commented: true };
  if (opts.label?.startsWith("label:")) return labelledOk(prompt, opts);
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

/**
 * Drives a track all the way to the ship step with a given verifier report.
 * `labelImpl` overrides how the label step answers — the whole point of the
 * label tests is that the loop must not believe it. `prImpl` overrides the
 * delivery step, for the case where the DoD passes and the push does not.
 */
const replyShip =
  (verifyReport, labelImpl, prImpl, foldImpl) => (prompt, opts) => {
    const l = opts.label || "";
    if (l.startsWith("label:"))
      return (labelImpl || labelledOk)(prompt, opts, verifyReport);
    if (prImpl && l.startsWith("pr:")) return prImpl(prompt, opts);
    if (l.startsWith("start:")) return { claimed: [101], inProgressNow: [101] };
    if (l.startsWith("prep:")) return prepped(prompt);
    if (l.startsWith("impl:") || l.startsWith("repair:"))
      return {
        committed: true,
        filesChanged: [],
        summary: "ok",
        selfCheckPassed: true,
      };
    if (l.startsWith("integrate:"))
      return { merged: branchesInIntegratePrompt(prompt), conflicts: [] };
    if (l.startsWith("follow-ups:"))
      return (foldImpl || foldedOk)(prompt, opts);
    if (l.startsWith("verify:")) return verifyReport;
    if (l.startsWith("lens:"))
      return { verdict: "PASS", lens: "x", findings: [], summary: "ok" };
    if (l.startsWith("pr:"))
      return {
        opened: true,
        url: "https://gh/pr/1",
        checkConclusion: "success",
      };
    if (l.startsWith("merge:")) return { merged: true, state: "merged" };
    if (l.startsWith("hold:")) return { merged: false, state: "refused" };
    return {};
  };

/** The workstream branches an integrate step was told to merge. */
const branchesInIntegratePrompt = (prompt) =>
  [...prompt.matchAll(/^ {2}- (feature\/\S+)$/gm)].map((m) => m[1]);

/** The `- [ ]` lines a fold step was told to append. */
const linesInFoldPrompt = (prompt) =>
  [...prompt.matchAll(/^ {3}(- \[ \] .+)$/gm)].map((m) => m[1]);

/** A fold step that honestly confirms every line it was asked to append. */
const foldedOk = (prompt) => ({
  followUps: linesInFoldPrompt(prompt).map((anchor) => ({
    issue: 901,
    kind: "appended",
    anchor,
    confirmed: true,
  })),
  rollupLabels: ["follow-ups"],
});

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

  const fold = calls.find((c) => c.label?.startsWith("follow-ups:"));
  assert.ok(fold, "the warning must be recorded somewhere before the merge");
  assert.match(
    fold.prompt,
    /BEFORE the merge/,
    "the finding must be recorded before the merge, so merging cannot lose it"
  );
  assert.ok(
    calls.indexOf(fold) < calls.indexOf(merge),
    "recorded BEFORE means before — ordering is the guarantee, not the wording"
  );
  assert.match(
    fold.prompt,
    /Follow-ups — <parent title>/,
    "findings fold into one rollup per parent, not one issue per warning"
  );
  assert.deepEqual(
    result.shipped[0].followUps.map((f) => f.issue),
    [901]
  );
  assert.match(
    merge.prompt,
    /Do NOT file them again as issues/,
    "the merge step must not re-file what the fold already recorded"
  );
});

// The fold replaced `gh issue create` with an append to an existing body, and an
// append is exactly the operation that failed silently on 2026-07-26. So an
// unconfirmed fold must stop the merge: merging on top of one discards the
// findings permanently, which is strictly worse than the issue-per-warning it
// replaced.
test("a fold that cannot be confirmed stops the merge instead of losing findings", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(
      passing([warn("code-quality", "contrast ratio 4.38:1")]),
      undefined,
      undefined,
      // The silent no-op: the agent reports the write but confirms nothing.
      () => ({ followUps: [], rollupLabels: [] })
    ),
    { autoMerge: true }
  );
  assert.ok(
    !calls.some((c) => c.label === "merge:alpha"),
    "an unconfirmed fold must not be merged on top of"
  );
  assert.equal(result.shipped.length, 0);
  assert.equal(result.errored.length, 1);
  assert.match(result.errored[0].reason, /could not be confirmed/);
});

test("a fold retried until it lands still merges", async () => {
  let n = 0;
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(
      passing([warn("code-quality", "duplicated constant")]),
      undefined,
      undefined,
      (prompt) => (++n === 1 ? { followUps: [] } : foldedOk(prompt))
    ),
    { autoMerge: true }
  );
  assert.equal(n, 2, "a fold that did not stick is retried, not abandoned");
  assert.ok(calls.some((c) => c.label === "merge:alpha"));
  assert.equal(result.shipped.length, 1);
});

// ---------------------------------------------------------------------------
// build-until-done: staged tracks
//
// A track used to be one agent, because the file-overlap DSU unioned across the
// whole thing and `dependsOn` never survived planning. It is now a prerequisite
// stage followed by parallel workstreams, and these tests pin the parts of that
// a stubbed run can actually prove: the shape of the schedule, the branch point
// each workstream is cut from, whose attempt a failure spends, and that a dead
// workstream cannot be mistaken for an absent one.
// ---------------------------------------------------------------------------

const wsLabels = (calls, prefix) =>
  calls
    .filter((c) => c.kind === "agent" && c.label?.startsWith(prefix))
    .map((c) => c.label);

test("dependsOn splits one track into a prerequisite stage and a parallel fan-out", async () => {
  const { calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
      { ...buildUnit("api", 103), dependsOn: ["schema"] },
    ],
    replyShip(passing([])),
    { autoMerge: false }
  );

  // One track: the dependsOn edges connect all three.
  assert.equal(
    wsLabels(calls, "prep:").length,
    1,
    "units joined by dependsOn belong to one track, one branch, one PR"
  );
  const impls = wsLabels(calls, "impl:");
  assert.equal(impls.length, 3, "each unit is its own workstream");
  assert.ok(
    impls[0].includes("s0w1"),
    "the prerequisite is stage 0 and runs first"
  );
  assert.ok(
    impls[1].includes("s1") && impls[2].includes("s1"),
    "its dependents are stage 1"
  );

  const stage1 = calls.filter(
    (c) => c.label?.startsWith("impl:") && c.label.includes("s1")
  );
  for (const c of stage1)
    assert.match(
      c.prompt,
      /git worktree add -b \S+ \S+ feature\/schema\b/,
      "a fan-out workstream branches from the TRACK branch, so it carries the prerequisite's commits"
    );
  assert.ok(
    calls.some((c) => c.label?.startsWith("integrate:")),
    "parallel branches must be merged back before the track ships"
  );
});

test("a stage's file-sharing units collapse into one agent; disjoint ones do not", async () => {
  const shared = "src/db/schema/index.ts";
  const { calls } = await runBuild(
    [
      { ...buildUnit("a", 101), files: [shared] },
      { ...buildUnit("b", 102), files: [shared] },
      { ...buildUnit("c", 103), files: ["src/c.ts"] },
    ],
    replyShip(passing([])),
    { autoMerge: false }
  );
  // a+b share a file so they are one workstream; c is disjoint but in the same
  // track only because... it is not. Disjoint units with no dependsOn are
  // separate tracks entirely, each with its own prep.
  assert.equal(wsLabels(calls, "prep:").length, 2, "c is its own track");
  const impls = wsLabels(calls, "impl:");
  assert.equal(
    impls.length,
    2,
    "two agents: one for the shared-file pair, one for c — never two agents on one file"
  );
});

test("a workstream that dies fails its track instead of vanishing from it", async () => {
  // parallel() resolves a thrown thunk to null. One level up, that hole was the
  // fan-in gap the run-level guard exists for; inside a stage it would let a
  // track ship with a piece of itself missing and nothing said about it.
  const { result, calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
      { ...buildUnit("api", 103), dependsOn: ["schema"] },
    ],
    (prompt, opts) => {
      if (opts.label?.startsWith("impl:") && opts.label.includes("s1w2"))
        throw new Error("this agent died");
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: false }
  );
  assert.equal(result.shipped.length, 0, "a track with a hole has not shipped");
  assert.equal(result.blocked.length, 1);
  assert.ok(
    !calls.some((c) => c.label?.startsWith("pr:")),
    "a PR must never be opened for a track whose stage did not complete"
  );
});

test("an integration failure blamed on one workstream re-runs only that one", async () => {
  let integrationSeen = 0;
  const { calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
    ],
    (prompt, opts) => {
      const l = opts.label || "";
      // The integration verifier is the one addressed to the track id.
      if (l.startsWith("verify:") && !l.includes("s0w") && !l.includes("s1w")) {
        integrationSeen++;
        if (integrationSeen === 1)
          return {
            verdict: "FAIL",
            gates: [],
            acceptanceCriteria: [],
            summary: "ui broke the build",
            failingGate: "G1",
            failingWorkstream: "schema-s1w1",
            fixInstructions: "fix the import",
          };
      }
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: false, maxAttempts: 2 }
  );

  const uiImpls = calls.filter(
    (c) => c.label?.startsWith("impl:") && c.label.includes("s1w1")
  );
  const schemaImpls = calls.filter(
    (c) => c.label?.startsWith("impl:") && c.label.includes("s0w1")
  );
  assert.equal(uiImpls.length, 2, "the named workstream is rebuilt");
  assert.equal(
    schemaImpls.length,
    1,
    "the healthy workstream is NOT rebuilt — that is the whole point of scoping the attempt"
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("repair:")),
    "an attributable failure goes to its owner, not to a whole-track repair"
  );
});

test("an unattributable integration failure repairs the assembly, not a workstream", async () => {
  let seen = 0;
  const { calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
    ],
    (prompt, opts) => {
      const l = opts.label || "";
      if (l.startsWith("verify:") && !l.includes("w")) {
        if (++seen === 1)
          return {
            verdict: "FAIL",
            gates: [],
            acceptanceCriteria: [],
            summary: "the two halves contradict each other",
            failingGate: "G2",
            failingWorkstream: "",
            fixInstructions: "reconcile them",
          };
      }
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: false, maxAttempts: 2 }
  );
  const repair = calls.find((c) => c.label?.startsWith("repair:"));
  assert.ok(
    repair,
    "a contradiction between workstreams cannot be fixed by an agent that sees only one"
  );
  assert.match(repair.prompt, /could not be attributed to a single workstream/);
});

test("a dependsOn cycle inside a track is refused at plan time", async () => {
  await assert.rejects(
    () =>
      runBuild(
        [
          { ...buildUnit("a", 101), dependsOn: ["b"] },
          { ...buildUnit("b", 102), dependsOn: ["a"] },
        ],
        replyShip(passing([]))
      ),
    /cycle/i,
    "a cycle can never reach a stage — failing loudly beats hanging"
  );
});

test("a single-unit track still runs as one agent in the track worktree", async () => {
  // The common case must not grow a worktree and a merge it does not need.
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([])),
    { autoMerge: false }
  );
  assert.equal(wsLabels(calls, "impl:").length, 1);
  assert.ok(
    !calls.some((c) => c.label?.startsWith("integrate:")),
    "nothing to integrate when the stage is one workstream"
  );
  const impl = calls.find((c) => c.label?.startsWith("impl:"));
  assert.match(
    impl.prompt,
    /Work in the existing worktree/,
    "a solo workstream works in the track worktree rather than cutting its own"
  );
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

// ---------------------------------------------------------------------------
// build-until-done: the outcome LABEL, not just the outcome narrative
//
// On 2026-07-26 the loop wrote its narrative and its label as two steps, and on
// 2 of 8 tracks the second one silently did not happen (#144): #110 shipped a
// full evidence bundle and #74 was blocked, and both issues stayed on
// `agent:in-progress` with no error raised anywhere. labels.md makes the label
// canonical, so that is the system of record telling a lie a human cannot
// distinguish from the truth — a reviewer promoted a blocked PR on the strength
// of it.
//
// These tests pin the guard, in the same shape as the #139 claim-step guard:
// the write is retried, the final state is READ BACK and asserted, and a label
// that cannot be confirmed errors the track instead of shipping it.
// ---------------------------------------------------------------------------

const labelCalls = (calls, target) =>
  calls.filter(
    (c) => c.kind === "agent" && c.label?.startsWith(`label:${target}:`)
  );

/** A label step that reports whatever `labels` you give it, for every issue. */
const labelsReadingBack = (labels) => (prompt) => ({
  observed: issuesInLabelPrompt(prompt).map((issue) => ({ issue, labels })),
  prLabels: labels,
});

test("a shipped track ends with its issue and its PR on agent:in-review", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]))
  );
  const settle = labelCalls(calls, "in-review");
  assert.equal(settle.length, 1, "the review-queue label must be written once");
  assert.match(
    settle[0].prompt,
    /gh issue edit n --add-label agent:in-review/,
    "the issue moves into the review queue"
  );
  assert.match(
    settle[0].prompt,
    /gh pr edit https:\/\/gh\/pr\/1 --add-label agent:in-review/,
    "#110 opened a PR that never got its label either — the PR is in scope too"
  );
  assert.equal(result.shipped.length, 1);
  assert.equal(
    result.shipped[0].labelsConfirmed,
    true,
    "shipped is a claim about the board, so the board state travels with it"
  );
});

test("the label step reads the final state back instead of trusting the edit", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]))
  );
  const prompt = labelCalls(calls, "in-review")[0].prompt;
  assert.match(
    prompt,
    /gh issue view n --json labels/,
    "`gh issue edit` exiting 0 is not evidence; the read-back is"
  );
  assert.match(
    prompt,
    /READ IT BACK/,
    "the failure mode was an agent reporting an edit it had not made"
  );
});

test("a track that exhausts its attempts ends with its issue on agent:blocked", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyWith([101], [101])
  );
  const settle = labelCalls(calls, "blocked");
  assert.equal(settle.length, 1, "#74 was blocked and never labelled blocked");
  assert.match(settle[0].prompt, /target status label is `agent:blocked`/);
  assert.equal(result.blocked[0].track, "alpha");
  assert.equal(
    result.blocked[0].labelSettled,
    true,
    "the block path must confirm its label like the ship path does"
  );
});

test("a label write that fails is retried, and final failure errors the track", async () => {
  // The agent dies outright — the loop sees null, which is exactly what it saw
  // when the write silently did nothing.
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]), () => null)
  );
  assert.equal(
    labelCalls(calls, "in-review").length,
    3,
    "a label write is idempotent, so not retrying it is a pure loss"
  );
  assert.equal(
    result.shipped.length,
    0,
    "an unconfirmed label must not be reported as a shipped track"
  );
  assert.equal(result.errored.length, 1);
  assert.deepEqual(result.errored[0].unlabelledIssues, [101]);
  assert.match(
    result.errored[0].reason,
    /agent:in-review/,
    "the report must name what could not be confirmed"
  );
});

test("a silent no-op label write does not let the track report success", async () => {
  // The 2026-07-26 shape: every command "succeeds", the label never moves.
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]), labelsReadingBack(["agent:in-progress"]))
  );
  assert.equal(labelCalls(calls, "in-review").length, 3);
  assert.equal(result.shipped.length, 0);
  assert.equal(result.errored[0].track, "alpha");
  assert.match(
    result.nextStep,
    /lying/,
    "the run must tell the human the board cannot be trusted about this track"
  );
});

test("no track reports shipped while its issue still reads agent:in-progress", async () => {
  // The label landed — but the old one survived alongside it. The status labels
  // are mutually exclusive, and `agent:in-progress` is precisely the value that
  // made a finished track indistinguishable from a running one.
  const { result } = await runBuild(
    [buildUnit("alpha", 101), buildUnit("beta", 202)],
    replyShip(
      passing([]),
      labelsReadingBack(["agent:in-review", "agent:in-progress"])
    )
  );
  assert.equal(result.shipped.length, 0);
  assert.equal(result.errored.length, 2, "both tracks must be surfaced");
  const stillInProgress = result.errored.flatMap((e) =>
    e.observedLabels.filter((o) => o.labels.includes("agent:in-progress"))
  );
  assert.ok(
    stillInProgress.length,
    "the observed board state is carried into the report, not summarised away"
  );
  assert.match(result.summary, /errored/);
});

test("a PR left without the label errors the track even when the issue is right", async () => {
  const { result } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]), (prompt) => ({
      observed: issuesInLabelPrompt(prompt).map((issue) => ({
        issue,
        labels: ["agent:in-review"],
      })),
      prLabels: [],
    }))
  );
  assert.equal(
    result.shipped.length,
    0,
    "#110's PR never got its label — an unlabelled PR is invisible in the queue"
  );
  assert.equal(result.errored.length, 1);
});

test("a label that lands on the retry ships normally", async () => {
  let seen = 0;
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]), (prompt, opts) =>
      ++seen === 1 ? null : labelledOk(prompt, opts)
    )
  );
  assert.equal(labelCalls(calls, "in-review").length, 2, "retry, then stop");
  assert.equal(result.shipped.length, 1, "a transient failure is not a block");
  assert.equal(result.errored.length, 0);
});

test("an unconfirmed label stops the auto-merge before it happens", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]), labelsReadingBack(["agent:in-progress"])),
    { autoMerge: true }
  );
  assert.ok(
    !calls.some((c) => c.label === "merge:alpha"),
    "merging on a board state nobody verified is how a blocked PR got promoted"
  );
  assert.equal(result.errored.length, 1);
});

// ---------------------------------------------------------------------------
// build-until-done: a DoD that passed and a delivery that did not
//
// Ruling (2026-07-27, PR #182): this outcome gets its OWN label rather than
// `agent:blocked`, because the human action differs. Blocked means the code did
// not reach the Definition of Done — go read a failing gate. Delivery-failed
// means every gate passed and the commit is on its branch; only the push/PR
// call failed. The fix is to retry the delivery, and sending a human to review
// a build that already passed spends the one resource this system cannot make
// more of. These tests pin the label, the explanation, and the report fold.
// ---------------------------------------------------------------------------

const PUSH_REJECTED = "push rejected: remote denied write access";

/** A delivery step that fails the way the ruling is about: no PR, a reason. */
const deliveryFails = () => ({
  opened: false,
  url: "",
  checkConclusion: "none",
  reason: PUSH_REJECTED,
});

test("a DoD pass whose delivery fails lands on agent:delivery-failed, not agent:blocked", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]), undefined, deliveryFails)
  );
  const settle = labelCalls(calls, "delivery-failed");
  assert.equal(settle.length, 1, "the outcome label must be written once");
  assert.match(
    settle[0].prompt,
    /target status label is `agent:delivery-failed`/
  );
  assert.equal(
    labelCalls(calls, "blocked").length,
    0,
    "agent:blocked would send a human to debug a build that passed every gate"
  );
  assert.equal(
    labelCalls(calls, "in-review").length,
    0,
    "there is no PR, so nothing belongs in the review queue"
  );
});

test("the delivery-failed comment says the DoD passed and names the delivery error", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]), undefined, deliveryFails)
  );
  const comment = calls.find(
    (c) => c.kind === "agent" && c.label === "delivery-failed:alpha"
  );
  assert.ok(comment, "a track that fails to deliver must say so on its issue");
  assert.match(comment.prompt, /gh issue comment/);
  assert.match(
    comment.prompt,
    /PASSED the Definition of Done/,
    "the reader must not go hunting for a failing gate that does not exist"
  );
  assert.ok(
    comment.prompt.includes(PUSH_REJECTED),
    "the delivery error is the whole diagnosis — it cannot be summarised away"
  );
  assert.match(
    comment.prompt,
    /retry the delivery/,
    "the human action that distinguishes this label from agent:blocked"
  );
  assert.match(
    comment.prompt,
    /do NOT edit labels/,
    "the loop owns the label so it can verify it, as with every other outcome"
  );
});

test("a delivery failure is reported in its own bucket, not folded into blocked", async () => {
  const { result } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]), undefined, deliveryFails)
  );
  assert.equal(result.shipped.length, 0);
  assert.equal(
    result.blocked.length,
    0,
    "pr-failed rows used to land here with failingGate: undefined"
  );
  assert.equal(result.deliveryFailed.length, 1);
  const row = result.deliveryFailed[0];
  assert.equal(row.track, "alpha");
  assert.deepEqual(row.issues, [101]);
  assert.equal(row.failingGate, "delivery", "the step that failed, named");
  assert.equal(
    row.dodVerdict,
    "PASS",
    "the gates that passed, carried through"
  );
  assert.equal(row.branch, "feature/alpha", "a retry needs the branch by name");
  assert.equal(row.labelSettled, true);
  assert.match(
    result.nextStep,
    /do NOT review or rebuild the code/,
    "the report must spend the reader's attention on the retry, not the diff"
  );
});

test("a delivery-failed label that will not settle is still surfaced", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(
      passing([]),
      labelsReadingBack(["agent:in-progress"]),
      deliveryFails
    )
  );
  assert.equal(
    labelCalls(calls, "delivery-failed").length,
    3,
    "the read-back guard applies to this label like any other"
  );
  assert.equal(result.deliveryFailed.length, 1);
  assert.equal(
    result.deliveryFailed[0].labelSettled,
    false,
    "an unsettled label means the board is lying, whatever the outcome was"
  );
});
