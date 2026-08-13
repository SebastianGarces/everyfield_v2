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

// The frontier query reads the whole board in one call, and each of these three
// assertions guards a failure that actually happened rather than a style rule.
//
// `gh issue list` pages at 30. On 2026-08-05 that answered "what is queued?" with
// 30 rows on an 86-issue board, so every pass selected from a window over the
// newest third of it — silently, for weeks, with no error anywhere. The REST list
// endpoint carries issue_dependencies_summary, assignees, labels AND body, so the
// N+1 fan-out (1 + 2N calls, then a `gh issue view` per issue) is unnecessary as
// well as slow. And that endpoint returns PULL REQUESTS alongside issues, which
// `gh issue list` filters and `gh api` does not.
test("the frontier query reads the whole board in one unpaged-safe call", async () => {
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
    /--paginate/,
    "an unpaginated list silently truncates at 30 and hides most of the board"
  );
  assert.doesNotMatch(
    prompt,
    /gh issue list[^\n]*--label agent:queued/,
    "the frontier must come from the REST list endpoint, not a pageable gh issue list"
  );
  assert.match(
    prompt,
    /select\(\.pull_request == null\)/,
    "the REST issues endpoint returns PRs too; dispatching one as work is a bad day"
  );
  assert.match(
    prompt,
    /Do NOT run `gh issue view <n>` per issue/,
    "the body is already in the payload — re-fetching per issue is the N+1 this replaced"
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

/**
 * Run build-until-done with stubbed globals. `reply(prompt, opts)` answers each
 * agent — in the parent AND in any child workflow it launches, because the
 * `workflow` stub evaluates the real child script with these same globals.
 * `over.workflowImpl` overrides that, for tests about a child that died.
 */
async function runBuild(units, reply, over = {}) {
  const { workflowImpl, budgetImpl, ...argOver } = over;
  const source = load("build-until-done.js");
  const calls = [];
  const globals = {
    args: { units, maxAttempts: 1, base: "main", ...argOver },
    log: (m) => calls.push({ kind: "log", value: m }),
    phase: (p) => calls.push({ kind: "phase", value: p }),
    budget: budgetImpl || {
      total: null,
      spent: () => 0,
      remaining: () => Infinity,
    },
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
  // workflow() runs a child script with the same injected globals. Nesting is
  // ONE level, so the child's own `workflow` throws — the same guarantee the
  // runtime gives, pinned here so a recipe or verify-and-ship that tries to
  // nest fails the test suite loudly.
  globals.workflow = async (spec, wfArgs) => {
    calls.push({ kind: "workflow", scriptPath: spec.scriptPath, args: wfArgs });
    if (workflowImpl) return workflowImpl(spec, wfArgs);
    const childSource = load(spec.scriptPath.replace(".claude/workflows/", ""));
    const childGlobals = {
      ...globals,
      args: wfArgs,
      workflow: () => {
        throw new Error(
          "workflow() nesting is one level deep — a child must never call workflow()"
        );
      },
    };
    const childFn = new Function(
      ...Object.keys(childGlobals),
      `return (async () => { ${childSource} })()`
    );
    return childFn(...Object.values(childGlobals));
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
 *
 * The two shas are equal because a freshly cut branch IS its base commit. The
 * loop asserts that, which is what "cut from the remote tip" is anchored on.
 */
const BASE_SHA = "700c33300000000000000000000000000000cafe";
const prepped = (prompt) => ({
  ready: true,
  branch: prompt.match(/-b (\S+)/)?.[1] || "feature/x",
  headSha: BASE_SHA,
  baseSha: BASE_SHA,
});

/** The parent's workstream-tree prep: cut from the track tip, shas agree. */
const treeReady = (prompt) => ({
  ready: true,
  branch: prompt.match(/-b (\S+)/)?.[1] || "feature/x",
  headSha: "feedd0600000000000000000000000000000d06e",
  trackSha: "feedd0600000000000000000000000000000d06e",
});

/** The recipe side-effect detector: no origin refs exist, before or after. */
const noRefs = () => ({ refs: [] });

/** The publish step before integration G3: worktree and remote agree. */
const pushedOk = () => ({
  pushed: true,
  headSha: "f604b2b00000000000000000000000000000beef",
  remoteSha: "f604b2b00000000000000000000000000000beef",
});

/** Answers the claim step with `inProgressNow`, and fails any later gate fast. */
const replyWith = (inProgressNow, claimed) => (prompt, opts) => {
  if (opts.label?.startsWith("start:")) return { claimed, inProgressNow };
  if (opts.label?.startsWith("prep:")) return prepped(prompt);
  if (opts.label?.startsWith("tree:")) return treeReady(prompt);
  if (opts.label?.startsWith("refs:")) return noRefs();
  if (opts.label?.startsWith("push:")) return pushedOk();
  if (opts.label?.startsWith("impl:"))
    return {
      summary: "did the thing",
      filesTouched: [],
      notes: "",
      commits: ["c0ffee00000000000000000000000000000000aa"],
      rootCauseAddressed: "answered",
    };
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
// build-until-done → verify-and-ship: the auto-merge gate
//
// The DoD proves the code does what the spec SAID. It cannot prove the spec was
// right. So the gate is not severity — it is whether a warning raises a question
// about WHAT was built. A spec-question holds the track for a human. Everything
// decidable from the codebase alone is a review FINDING and is fixed in the
// same pass by the quality rounds (#399) — the follow-ups rollup is gone.
// These tests pin that split, plus the two unconditional refusals.
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
const replyShip = (verifyReport, labelImpl, prImpl) => (prompt, opts) => {
  const l = opts.label || "";
  if (l.startsWith("label:"))
    return (labelImpl || labelledOk)(prompt, opts, verifyReport);
  if (prImpl && l.startsWith("pr:")) return prImpl(prompt, opts);
  if (l.startsWith("start:")) return { claimed: [101], inProgressNow: [101] };
  if (l.startsWith("prep:")) return prepped(prompt);
  if (l.startsWith("tree:")) return treeReady(prompt);
  if (l.startsWith("refs:")) return noRefs();
  if (l.startsWith("push:")) return pushedOk();
  if (l.startsWith("cleanup:")) return { removed: ["everything"] };
  if (l.startsWith("impl:") || l.startsWith("repair:"))
    return {
      committed: true,
      filesChanged: [],
      summary: "ok",
      selfCheckPassed: true,
      commits: ["c0ffee00000000000000000000000000000000aa"],
      // A retry must answer the named cause; a first attempt has none to
      // answer. Filling both is what an honest implementer returns.
      rootCause: "the named ReferenceError",
      rootCauseAddressed: "moved the import; `pnpm test` is green",
    };
  if (l.startsWith("integrate:"))
    return { merged: branchesInIntegratePrompt(prompt), conflicts: [] };
  if (l.startsWith("fix:"))
    return {
      committed: true,
      filesChanged: [],
      summary: "fixed the findings",
      perFinding: [{ finding: "the finding", addressed: "fixed and proven" }],
    };
  if (l.startsWith("re-review:")) return passing([]);
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

// ---------------------------------------------------------------------------
// build-until-done: the verify-and-ship child seam (#399)
//
// The guarantee tail runs as ONE child workflow per integration attempt. The
// parent keeps only what must survive there: attempt accounting, attribution
// re-entry with priorReport, and the assembly repair agent. These tests pin
// the args contract and the fail-closed handling of a dead child.
// ---------------------------------------------------------------------------

test("the integration tail runs as the verify-and-ship child with the contract args", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]))
  );
  const call = calls.find(
    (c) => c.kind === "workflow" && c.scriptPath.endsWith("verify-and-ship.js")
  );
  assert.ok(call, "the guarantee tail must run as the child workflow");
  assert.deepEqual(
    Object.keys(call.args).sort(),
    [
      "attempt",
      "autoMerge",
      "base",
      "branch",
      "carriedFindings",
      "conventions",
      "criteria",
      "labelAttempts",
      "survivingTrees",
      "track",
      "wsIds",
      "wsSummaries",
      "wt",
    ],
    "the parent→child args shape is a contract — widening or narrowing it is a factory change"
  );
  assert.deepEqual(Object.keys(call.args.track).sort(), [
    "hold",
    "id",
    "issues",
    "lane",
    "risk",
  ]);
  assert.equal(call.args.base, "origin/main");
  assert.equal(call.args.branch, "feature/alpha");
});

test("a verify-and-ship child that died is a failed attempt, never a silent skip", async () => {
  const { result } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([])),
    {
      // Only the verify-and-ship child dies; the recipe child still builds.
      workflowImpl: async (spec) =>
        spec.scriptPath.endsWith("verify-and-ship.js")
          ? null
          : {
              summary: "built",
              commits: ["c0ffee00000000000000000000000000000000ad"],
              warnings: [],
            },
    }
  );
  assert.equal(result.shipped.length, 0);
  assert.equal(
    result.blocked.length,
    1,
    "a dead child spends the attempt and the exhausted track blocks loudly"
  );
  assert.match(result.blocked[0].reason, /did not reach the integration DoD/);
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

  const stage1Trees = calls.filter(
    (c) => c.label?.startsWith("tree:") && c.label.includes("s1")
  );
  assert.equal(
    stage1Trees.length,
    2,
    "the PARENT cuts each fan-out worktree — a recipe never creates its own tree"
  );
  for (const c of stage1Trees)
    assert.match(
      c.prompt,
      /git worktree add -b \S+ \S+ feature\/schema\b/,
      "a fan-out workstream branches from the TRACK branch, so it carries the prerequisite's commits"
    );
  const stage1Impls = calls.filter(
    (c) => c.label?.startsWith("impl:") && c.label.includes("s1")
  );
  for (const c of stage1Impls)
    assert.match(
      c.prompt,
      /Work in the existing worktree/,
      "the implementer receives the tree as an input, ready to use"
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

// ---------------------------------------------------------------------------
// build-until-done: the recipe seam (#399)
//
// A recipe is a child workflow that implements ONE workstream attempt in a
// parent-provided worktree. These tests pin the parse-time id gate, the args
// contract, and the two enforcement paths: the origin-ref side-effect detector
// and the empty-commits refusal — both of which fail the attempt BEFORE a
// verifier is spent on it.
// ---------------------------------------------------------------------------

test("an unknown recipe id throws at parse time, naming the unit and the id", async () => {
  await assert.rejects(
    runBuild(
      [{ ...buildUnit("alpha", 101), recipe: "tournament" }],
      replyShip(passing([]))
    ),
    /unit "alpha" names unknown recipe "tournament"/,
    "failing at parse means nothing was claimed and no worktree was cut — never mid-build"
  );
});

test("units sharing a workstream with different recipes throw at plan time", async () => {
  await assert.rejects(
    runBuild(
      [
        {
          ...buildUnit("a", 101),
          files: ["src/shared.ts"],
          recipe: "implement-straight",
        },
        {
          ...buildUnit("b", 102),
          files: ["src/shared.ts"],
          recipe: "generate-and-filter",
        },
      ],
      replyShip(passing([]))
    ),
    /different recipes/,
    "one workstream runs one recipe — a mixed set is a plan defect"
  );
});

test("the recipe runs as a child workflow with the contract args", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]))
  );
  const recipeCalls = calls.filter(
    (c) =>
      c.kind === "workflow" &&
      c.scriptPath.includes("recipes/implement-straight.js")
  );
  assert.equal(recipeCalls.length, 1, "one recipe call = one attempt");
  assert.deepEqual(
    Object.keys(recipeCalls[0].args).sort(),
    [
      "attempt",
      "base",
      "branch",
      "conventions",
      "implAgentType",
      "priorReport",
      "retryBlock",
      "stageIndex",
      "track",
      "unitBlocksRendered",
      "workstream",
      "worktree",
    ],
    "recipeArgs is a contract (ops/agent-os/recipes.md) — widening it is a factory change, and each datum crosses in exactly one form (files = workstream.files)"
  );
  assert.equal(recipeCalls[0].args.priorReport, null);
  assert.equal(recipeCalls[0].args.retryBlock, null);
  assert.equal(
    recipeCalls[0].args.base,
    "origin/main",
    "the merge base crosses as a REF: a recipe that needs the attempt's diff anchors on it instead of on a self-reported commit count"
  );
});

test("a retry hands the recipe the STRUCTURED report and the parent-rendered retryBlock", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    failsOnceWithEvidence(),
    { maxAttempts: 2 }
  );
  const retryCall = calls.filter(
    (c) =>
      c.kind === "workflow" &&
      c.scriptPath.includes("recipes/implement-straight.js")
  )[1];
  assert.ok(retryCall, "the second attempt goes through the recipe too");
  assert.equal(
    retryCall.args.priorReport?.failingGate,
    "G2-subset",
    "mod 1: the report travels as an object — flattening it is the #307 context-loss shape"
  );
  assert.ok(
    retryCall.args.retryBlock.includes(CRASH),
    "mod 2: the parent renders the root-cause preamble with the evidence verbatim"
  );
  assert.match(retryCall.args.retryBlock, /rootCauseAddressed/);
});

test("a recipe that moved an origin ref fails the attempt as a contract violation", async () => {
  let snaps = 0;
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) => {
      if (opts.label?.startsWith("refs:"))
        return {
          refs:
            ++snaps % 2 === 0
              ? [{ ref: "refs/heads/feature/alpha", sha: "deadbeef" }]
              : [],
        };
      return replyShip(passing([]))(prompt, opts);
    }
  );
  assert.equal(result.blocked.length, 1);
  assert.equal(
    result.blocked[0].failingGate,
    "recipe-contract",
    "an origin ref a recipe touched is a violation, not a push that happened early"
  );
  assert.ok(
    !calls.some((c) => /^verify:\S+-s\d+w\d+#/.test(c.label || "")),
    "the violation is refused before a verifier is spent on it"
  );
});

test("a recipe that returns no commits fails the attempt", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) =>
      opts.label?.startsWith("impl:")
        ? {
            committed: true,
            filesChanged: [],
            summary: "ok",
            selfCheckPassed: true,
            commits: [],
          }
        : replyShip(passing([]))(prompt, opts)
  );
  assert.equal(result.blocked.length, 1);
  assert.equal(
    result.blocked[0].failingGate,
    "recipe",
    "an attempt that committed nothing built nothing"
  );
  assert.ok(
    !calls.some((c) => /^verify:\S+-s\d+w\d+#/.test(c.label || "")),
    "no verifier runs on an empty attempt"
  );
});

// ---------------------------------------------------------------------------
// build-until-done: the `hold` flag
//
// The standing policy is that a change to the factory itself keeps a human. The
// loop had no way to express that, so the pass that changed it had to run with
// `autoMerge: false` globally — which also refused the merge to every clean
// track beside it. `hold` is per unit, so a mixed wave keeps auto-merge on and
// only the declared track is held.
// ---------------------------------------------------------------------------

test("a unit's hold flag holds its whole track", async () => {
  const { result, calls } = await runBuild(
    [
      { ...buildUnit("factory", 101), hold: true },
      // Same track: the shared file unions them, so one unit's hold must reach
      // the PR the other one is also riding on.
      { ...buildUnit("beside", 102), files: ["src/factory.ts"] },
    ],
    replyShip(passing([])),
    { autoMerge: true }
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("merge:")),
    "one held unit holds the branch its track-mates share"
  );
  const hold = calls.find((c) => c.label?.startsWith("hold:"));
  assert.match(hold.prompt, /declared never-auto-merge/);
  assert.equal(result.shipped[0].merge, "held-for-review");
});

test("a held track never auto-merges, even low-risk and warning-free", async () => {
  const { calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), risk: "low", hold: true }],
    replyShip(passing([])),
    { autoMerge: true }
  );
  assert.ok(
    !calls.some((c) => c.label === "merge:alpha"),
    "a spotless factory change is exactly the case the flag exists for"
  );
  const hold = calls.find((c) => c.label === "hold:alpha");
  assert.ok(hold, "the reviewer must be told why it is sitting there");
  assert.match(hold.prompt, /factory policy or issue directive/);
});

test("an un-held low-risk track still auto-merges beside a held one", async () => {
  const { result, calls } = await runBuild(
    [{ ...buildUnit("factory", 101), hold: true }, buildUnit("clean", 102)],
    replyShip(passing([])),
    { autoMerge: true }
  );
  assert.ok(
    calls.some((c) => c.label === "merge:clean"),
    "holding one track must not cost the pass every other track's merge"
  );
  assert.ok(!calls.some((c) => c.label === "merge:factory"));
  const clean = result.shipped.find((s) => s.track === "clean");
  assert.equal(clean.merge, "merged");
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

// ---------------------------------------------------------------------------
// build-until-done: the track base is the REMOTE tip
//
// The maiden staged-tracks run (wf_74fd1c21) cut its track branch from the local
// `main` at 14c5d33 while `origin/main` was at 700c333. Its verifiers then read a
// two-commit-old `ops/agent-os/dod.md` out of their worktrees and graded against
// it, and PR #333 landed on `mergeStateStatus: BEHIND` — the ruleset requires
// up-to-date branches — so auto-merge could not fire without a manual
// `gh pr update-branch`. A local ref is whatever the checkout last fetched.
// ---------------------------------------------------------------------------

const prepPrompt = (calls) =>
  calls.find((c) => c.kind === "agent" && c.label?.startsWith("prep:"))?.prompt;

test("the track branch is fetched and cut from origin/main, not the local ref", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]))
  );
  const prompt = prepPrompt(calls);
  assert.match(
    prompt,
    /git fetch origin/,
    "an unfetched remote-tracking ref is just a stale local ref with a longer name"
  );
  assert.match(
    prompt,
    /git worktree add -b \S+ \S+ origin\/main\b/,
    "the branch is cut from the remote tip"
  );
  assert.doesNotMatch(
    prompt,
    /git worktree add -b \S+ \S+ main\b/,
    "cutting from the local `main` is the maiden run's defect verbatim"
  );
});

test("a bare base is normalised onto the remote; an explicit sha is not", async () => {
  const bare = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([])),
    {
      base: "main",
    }
  );
  assert.match(prepPrompt(bare.calls), /origin\/main/);

  const sha = "14c5d33abc0000000000000000000000000000ff";
  const pinned = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([])),
    { base: sha }
  );
  assert.match(
    prepPrompt(pinned.calls),
    new RegExp(`git worktree add -b \\S+ \\S+ ${sha}`),
    "a deliberate pin must survive normalisation"
  );
});

test("a track cut from a stale base is blocked before a workstream runs", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) =>
      opts.label?.startsWith("prep:")
        ? {
            ready: true,
            branch: prompt.match(/-b (\S+)/)?.[1],
            // What the maiden run actually did: cut from two commits back.
            headSha: "14c5d33abc0000000000000000000000000000ff",
            baseSha: BASE_SHA,
          }
        : replyShip(passing([]))(prompt, opts)
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("impl:")),
    "building on a stale base is caught before any code is written on it"
  );
  assert.equal(result.blocked.length, 1);
  assert.match(
    result.blocked[0].reason,
    /origin\/main is at/,
    "the report must name both shas, not just say something was wrong"
  );
});

// ---------------------------------------------------------------------------
// build-until-done: resuming a preserved branch
//
// The fresh-cut assertion above and the held/blocked worktree hand-over pull in
// opposite directions: a preserved branch carries prior commits, so its HEAD can
// never equal `origin/main` once main moves, and re-running it would be refused
// forever — the guard rejecting the exact artifact the hand-over preserves. So
// an existing branch is UPDATED rather than re-cut, and the assertion becomes
// ancestry, which is the same "never build on a stale base" invariant stated for
// a branch that has commits of its own.
// ---------------------------------------------------------------------------

/** A prep reply for a branch that already existed and was brought up to date. */
const resumed = (prompt, over = {}) => ({
  ready: true,
  branch: prompt.match(/refs\/heads\/([^`\s]+)/)?.[1] || "feature/x",
  resumed: true,
  // Carries the blocked attempt's commits, so it is NOT the base sha — the
  // whole reason equality cannot be the test here.
  headSha: "abc1234000000000000000000000000000000dad",
  baseSha: BASE_SHA,
  baseIsAncestor: true,
  ...over,
});

test("a preserved branch is updated from origin/main, not re-cut", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]))
  );
  const prompt = prepPrompt(calls);
  assert.match(
    prompt,
    /git rev-parse --verify --quiet refs\/heads\//,
    "prep must decide fresh-vs-resume before it touches anything"
  );
  assert.match(
    prompt,
    /git -C \S+ merge --no-edit origin\/main/,
    "a branch holding preserved work is brought up to date, never re-cut"
  );
  assert.match(
    prompt,
    /merge-base --is-ancestor origin\/main HEAD/,
    "ancestry is the invariant a branch with its own commits can satisfy"
  );
});

test("a resumed branch behind main passes on ancestry, not on equality", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) =>
      opts.label?.startsWith("prep:")
        ? resumed(prompt)
        : replyShip(passing([]))(prompt, opts)
  );
  assert.ok(
    calls.some((c) => c.label?.startsWith("impl:")),
    "preserved work that has taken main's commits is resumable — that is what keeping the tree was for"
  );
  assert.equal(result.blocked.length, 0);
  assert.equal(result.shipped.length, 1);
});

test("a resumed branch that did not take main's commits is still refused", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) =>
      opts.label?.startsWith("prep:")
        ? resumed(prompt, { baseIsAncestor: false })
        : replyShip(passing([]))(prompt, opts)
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("impl:")),
    "loosening the check for resumes must not loosen the invariant"
  );
  assert.equal(result.blocked.length, 1);
  assert.match(result.blocked[0].reason, /is NOT an ancestor of it/);
  assert.match(
    result.blocked[0].reason,
    /Do NOT delete the branch or the worktree/,
    "a refusal must not cost the human the preserved work"
  );
});

test("a conflicting update stops the track without destroying the branch", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) =>
      opts.label?.startsWith("prep:")
        ? {
            ...resumed(prompt),
            ready: false,
            conflicted: true,
            conflictedFiles: ["src/alpha.ts", "src/db/schema.ts"],
          }
        : replyShip(passing([]))(prompt, opts)
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("impl:")),
    "never proceed on the stale base"
  );
  assert.equal(result.blocked.length, 1);
  const { reason } = result.blocked[0];
  assert.match(reason, /src\/alpha\.ts, src\/db\/schema\.ts/, "name the files");
  assert.match(
    reason,
    /ABORTED/,
    "the preserved work is left exactly as it was"
  );
  assert.match(
    reason,
    /resolving-merge-conflicts\/SKILL\.md/,
    "a conflict is two intents disagreeing — a human picks, and gets told where the help is"
  );
  assert.doesNotMatch(
    reason,
    /is not on feature\/alpha/,
    "a conflict is a decision to make, not a broken worktree to go hunt"
  );
});

// ---------------------------------------------------------------------------
// build-until-done: push BEFORE the integration verifier
//
// G3 drives the branch's preview deployment, and the preview is built from
// `origin/<branch>`. On #307 the worktree sat a commit ahead of the remote for
// two attempts, so the gate kept reporting — convincingly — on code the fix had
// already replaced. The ordering is the guarantee.
// ---------------------------------------------------------------------------

const integrationVerify = (calls, track = "alpha") =>
  calls.filter(
    (c) => c.kind === "agent" && c.label?.startsWith(`verify:${track}#`)
  );

test("the branch is pushed and the shas asserted before integration G3 runs", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([]))
  );
  const push = calls.find((c) => c.label?.startsWith("push:"));
  const verify = integrationVerify(calls)[0];
  assert.ok(
    push,
    "the loop must publish the branch itself, not hope open-pr did"
  );
  assert.ok(
    calls.indexOf(push) < calls.indexOf(verify),
    "pushing after the verifier would validate a preview built from the previous commit"
  );
  assert.match(push.prompt, /git -C \S+ push -u origin \S+/);
  assert.match(
    push.prompt,
    /rev-parse origin\/\S+/,
    "the assertion is a sha comparison, not a successful push"
  );
  assert.match(
    verify.prompt,
    /origin\/feature\/alpha` is at `f604b2b/,
    "the verifier is told which sha it is entitled to see"
  );
});

test("a worktree ahead of its remote is never validated", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) =>
      opts.label?.startsWith("push:")
        ? {
            pushed: true,
            // #307 exactly: local a4c5ede, origin f604b2b.
            headSha: "a4c5ede00000000000000000000000000000beef",
            remoteSha: "f604b2b00000000000000000000000000000beef",
          }
        : replyShip(passing([]))(prompt, opts)
  );
  assert.equal(
    integrationVerify(calls).length,
    0,
    "a stale preview burns an attempt and teaches the loop something false"
  );
  assert.equal(result.blocked.length, 1);
  assert.match(result.blocked[0].failingGate, /G3/);
});

// ---------------------------------------------------------------------------
// build-until-done: the retry carries the root cause, and the fix answers it
//
// #307 burned attempts 2 and 3 on a stuck button and a pinned test while the
// `ReferenceError: ChurchBasicsFieldErrors` module-eval crash the verifier had
// NAMED shipped unfixed three times. Two things failed: the fixer was handed a
// one-line paraphrase instead of the evidence, and nothing ever asked it what it
// had done about the named cause.
// ---------------------------------------------------------------------------

const CRASH =
  "ReferenceError: ChurchBasicsFieldErrors is not defined\n    at eval (src/app/onboarding/church-basics.tsx:1:1)";

const scopedVerify = (calls) =>
  calls.filter(
    (c) => c.kind === "agent" && /^verify:\S+-s\d+w\d+#/.test(c.label || "")
  );

/** A scoped verifier that fails once with real evidence, then passes. */
const failsOnceWithEvidence = (impl) => {
  let seen = 0;
  return (prompt, opts) => {
    const l = opts.label || "";
    if (/^verify:\S+-s\d+w\d+#/.test(l) && ++seen === 1)
      return {
        verdict: "FAIL",
        gates: [{ id: "G2-subset", status: "FAIL", evidence: CRASH }],
        acceptanceCriteria: [],
        failingGate: "G2-subset",
        fixInstructions: "make the page render",
        summary: "the module crashes on evaluation",
      };
    if (impl && l.startsWith("impl:")) return impl(prompt, opts);
    return replyShip(passing([]))(prompt, opts);
  };
};

test("a retry quotes the failing gate's evidence verbatim, not a paraphrase", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    failsOnceWithEvidence(),
    { maxAttempts: 2 }
  );
  const retry = calls.filter((c) => c.label?.startsWith("impl:"))[1];
  assert.ok(retry, "a failed scoped verdict must produce a second attempt");
  assert.ok(
    retry.prompt.includes(CRASH),
    "the named error is the whole diagnosis — a summary of it is how #307 went hunting for a button"
  );
  assert.match(retry.prompt, /rootCauseAddressed/);
  assert.match(
    retry.prompt,
    /reproduce it yourself/i,
    "the fixer starts from the named failure, not from what looks wrong to it"
  );
});

test("a fix that will not say how it addressed the cause is refused before the verifier", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    failsOnceWithEvidence((prompt) =>
      /THE ROOT CAUSE IS BELOW/.test(prompt)
        ? {
            committed: true,
            filesChanged: ["src/alpha.ts"],
            summary: "fixed the stuck button and pinned the test",
            selfCheckPassed: true,
            commits: ["c0ffee00000000000000000000000000000000ab"],
            rootCause: "",
            rootCauseAddressed: "",
          }
        : {
            committed: true,
            filesChanged: [],
            summary: "ok",
            selfCheckPassed: true,
            commits: ["c0ffee00000000000000000000000000000000ac"],
          }
    ),
    { maxAttempts: 2 }
  );
  assert.equal(
    calls.filter((c) => c.label?.startsWith("impl:")).length,
    2,
    "the retry still runs — it is the verdict on it that changes"
  );
  assert.equal(
    scopedVerify(calls).length,
    1,
    "spending a verifier on a fix that dodged the named cause is how attempts 2 and 3 were burned"
  );
  assert.equal(result.blocked.length, 1);
});

test("an integration failure sent back to a workstream carries its evidence", async () => {
  // It used to arrive as a fresh attempt 1 with no report at all: the agent was
  // told to build the unit, not that anything had gone wrong with it.
  let seen = 0;
  const { calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
    ],
    (prompt, opts) => {
      const l = opts.label || "";
      if (l.startsWith("verify:schema#") && ++seen === 1)
        return {
          verdict: "FAIL",
          gates: [{ id: "G3", status: "FAIL", evidence: CRASH }],
          acceptanceCriteria: [],
          failingGate: "G3",
          failingWorkstream: "schema-s1w1",
          fixInstructions: "make the page render",
          summary: "the module crashes on evaluation",
        };
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: false, maxAttempts: 2 }
  );
  const redo = calls.filter(
    (c) => c.label?.startsWith("impl:") && c.label.includes("s1w1")
  )[1];
  assert.ok(redo, "the named workstream is re-run");
  assert.ok(
    redo.prompt.includes(CRASH),
    "the re-run must see the failure it was sent back to fix"
  );
  assert.match(redo.prompt, /rootCauseAddressed/);
});

test("the assembly repair is held to the same root-cause contract", async () => {
  let seen = 0;
  const { calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
    ],
    (prompt, opts) => {
      const l = opts.label || "";
      if (l.startsWith("verify:schema#") && ++seen === 1)
        return {
          verdict: "FAIL",
          gates: [{ id: "G1", status: "FAIL", evidence: CRASH }],
          acceptanceCriteria: [],
          failingGate: "G1",
          failingWorkstream: "",
          fixInstructions: "reconcile them",
          summary: "the two halves contradict each other",
        };
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: false, maxAttempts: 2 }
  );
  const repair = calls.find((c) => c.label?.startsWith("repair:"));
  assert.ok(repair.prompt.includes(CRASH), "verbatim evidence, here too");
  assert.match(repair.prompt, /rootCauseAddressed/);
});

// ---------------------------------------------------------------------------
// build-until-done: who owns the worktrees at each exit
//
// PR #333 was held with `bud-310-ws1*` still on disk (removed by hand later) and
// #303/#307 blocked with their trees intact — useful only because a human knew
// where to look. A merged track's tree is dead weight; a held or blocked one's
// tree is the only re-runnable copy of the work. So one is cleaned and the other
// is handed over BY NAME.
// ---------------------------------------------------------------------------

test("a merged track removes its own worktree and branch", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([])),
    { autoMerge: true }
  );
  const cleanup = calls.find((c) => c.label === "cleanup:alpha");
  const merge = calls.find((c) => c.label === "merge:alpha");
  assert.ok(cleanup, "a merged track owns its leftovers");
  assert.ok(
    calls.indexOf(merge) < calls.indexOf(cleanup),
    "never delete the tree of a branch that has not landed"
  );
  assert.match(cleanup.prompt, /\.claude\/worktrees\/bud-alpha/);
  assert.match(cleanup.prompt, /git worktree remove/);
  assert.match(cleanup.prompt, /git branch -D/);
  assert.deepEqual(
    result.shipped[0].survivingWorktrees,
    [],
    "a merged track leaves none"
  );
});

test("a PR only queued for auto-merge keeps its worktree", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) =>
      opts.label?.startsWith("merge:")
        ? { merged: false, state: "queued-for-auto-merge" }
        : replyShip(passing([]))(prompt, opts),
    { autoMerge: true }
  );
  assert.ok(
    !calls.some((c) => c.label === "cleanup:alpha"),
    "queued is not merged — deleting the tree under it is how the work disappears"
  );
});

test("a held track names its surviving worktrees in the PR comment", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([warn("spec-question", "is this the intended read?")])),
    { autoMerge: true }
  );
  const hold = calls.find((c) => c.label === "hold:alpha");
  assert.match(hold.prompt, /Surviving worktrees/);
  assert.match(
    hold.prompt,
    /\.claude\/worktrees\/bud-alpha` on branch `feature\/alpha/,
    "path AND branch — a path alone does not say what it holds"
  );
  assert.ok(
    !calls.some((c) => c.label === "cleanup:alpha"),
    "a held track's tree may still be needed to rule on it"
  );
  assert.deepEqual(result.shipped[0].survivingWorktrees, [
    ".claude/worktrees/bud-alpha",
  ]);
});

test("a blocked track hands its worktrees over in the exit comment", async () => {
  const { result, calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
      { ...buildUnit("api", 103), dependsOn: ["schema"] },
    ],
    (prompt, opts) => {
      const l = opts.label || "";
      if (/^verify:\S+-s1w\d+#/.test(l))
        return {
          verdict: "FAIL",
          gates: [{ id: "G2-subset", status: "FAIL", evidence: CRASH }],
          acceptanceCriteria: [],
          failingGate: "G2-subset",
          fixInstructions: "fix it",
          summary: "nope",
        };
      return replyShip(passing([]))(prompt, opts);
    }
  );
  const block = calls.find((c) => c.label === "block:schema");
  assert.ok(block, "an exhausted track must comment before it goes quiet");
  assert.match(block.prompt, /Surviving worktrees/);
  assert.match(
    block.prompt,
    /\.claude\/worktrees\/bud-schema-s1w1` on branch `feature\/schema-s1w1/,
    "the fan-out workstreams' trees are survivors too, not just the track's"
  );
  assert.ok(
    block.prompt.includes(CRASH),
    "the evidence goes to the human verbatim, as it does to a fixer"
  );
  assert.match(
    block.prompt,
    /Do NOT remove any worktree/,
    "a blocked track's tree is the evidence"
  );
  assert.ok(
    result.blocked[0].survivingWorktrees.includes(
      ".claude/worktrees/bud-schema"
    ),
    "the run report repeats them — the first two passes were cleaned up from memory"
  );
});

// ---------------------------------------------------------------------------
// The review-fix loop (#399) — findings are fixed IN-PASS, never filed as debt
//
// The reviewer's Critical and structural findings route to a fix agent and a
// re-review, capped at QUALITY_ROUNDS = 2, at both the scoped and integration
// sites. Exhaust → the track HOLDs with a DECISION comment (the held-PR
// pattern) — never agent:blocked, never merge-with-findings. A fix that
// answers no finding is refused before a re-review (the #307 discipline), and
// a re-review FAIL re-enters the real attempt machinery.
// ---------------------------------------------------------------------------

const finding = (severity, summary) => ({
  severity,
  summary,
  detail: `${summary} — exact lines`,
  files: ["src/alpha.ts"],
  remedy: `${summary} gone`,
});

const isScopedVerifyLabel = (l) => /^verify:\S+-s\d+w\d+#/.test(l || "");

test("integration findings trigger a fix round + re-review, then the track merges", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) => {
      const l = opts.label || "";
      if (l.startsWith("verify:alpha#"))
        return {
          ...passing([]),
          findings: [finding("critical", "tenant scope missing")],
        };
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: true }
  );
  const fix = calls.find((c) => c.label === "fix:alpha#r1");
  const rr = calls.find((c) => c.label === "re-review:alpha#r1");
  assert.ok(
    fix,
    "critical findings on a PASS go to a fix agent in the same pass"
  );
  assert.ok(
    fix.prompt.includes("tenant scope missing"),
    "the finding is quoted verbatim, not paraphrased"
  );
  assert.ok(rr, "the fix is re-reviewed, never trusted");
  assert.ok(calls.indexOf(fix) < calls.indexOf(rr));
  assert.equal(
    calls.filter((c) => c.label?.startsWith("push:alpha")).length,
    2,
    "a committing fix round re-runs push+assert — the preview-sha discipline extends to fix commits"
  );
  assert.ok(
    calls.some((c) => c.label === "merge:alpha"),
    "resolved findings do not hold the merge"
  );
  assert.equal(result.shipped.length, 1);
});

test("findings that survive 2 quality rounds HOLD with a DECISION — never merge, never block", async () => {
  const stubborn = finding("structural", "spaghetti mode bolted into checkout");
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) => {
      const l = opts.label || "";
      if (l.startsWith("verify:alpha#"))
        return { ...passing([]), findings: [stubborn] };
      if (l.startsWith("re-review:alpha#"))
        return { ...passing([]), findings: [stubborn] };
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: true }
  );
  assert.equal(
    calls.filter((c) => c.label?.startsWith("fix:alpha#")).length,
    2,
    "the cap is 2 quality rounds — on exhaust the loop stops, it does not keep looping"
  );
  assert.ok(
    !calls.some((c) => c.label === "merge:alpha"),
    "never merge-with-findings: unresolved findings make holds non-empty, so the merge agent is unreachable"
  );
  assert.equal(
    labelCalls(calls, "blocked").length,
    0,
    "never agent:blocked — the track exits through the normal held path"
  );
  const hold = calls.find((c) => c.label === "hold:alpha");
  assert.ok(hold, "the hold materializes at the auto-merge gate");
  assert.match(hold.prompt, /unresolved review finding/);
  assert.match(hold.prompt, /merge as-is — rule the finding accepted/);
  assert.match(hold.prompt, /direct a named fix/);
  assert.ok(
    hold.prompt.includes("spaghetti mode bolted into checkout"),
    "the finding reaches the DECISION verbatim"
  );
  assert.equal(result.shipped[0].merge, "held-for-review");
});

test("a fix that answers no finding is refused before a re-review is spent", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) => {
      const l = opts.label || "";
      if (l.startsWith("verify:alpha#"))
        return { ...passing([]), findings: [finding("critical", "x")] };
      if (l.startsWith("fix:"))
        return {
          committed: false,
          filesChanged: [],
          summary: "did some things",
          perFinding: [],
        };
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: true }
  );
  assert.equal(
    calls.filter((c) => c.label?.startsWith("fix:alpha#")).length,
    2,
    "the answerless round still counts against the cap"
  );
  assert.equal(
    calls.filter((c) => c.label?.startsWith("re-review:")).length,
    0,
    "refuse-before-reviewer — the #307 discipline, per finding"
  );
  assert.ok(
    calls.some((c) => c.label === "hold:alpha"),
    "the findings stand and hold the gate"
  );
});

test("suggestions never gate and never trigger a fix round", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) =>
      (opts.label || "").startsWith("verify:alpha#")
        ? {
            ...passing([]),
            findings: [finding("suggestion", "could rename this")],
          }
        : replyShip(passing([]))(prompt, opts),
    { autoMerge: true }
  );
  assert.equal(calls.filter((c) => c.label?.startsWith("fix:")).length, 0);
  assert.ok(calls.some((c) => c.label === "merge:alpha"));
});

test("scoped findings run the loop in the workstream, and leftovers force the hold at the gate", async () => {
  const stubborn = finding("critical", "db.transaction on neon-http");
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) => {
      const l = opts.label || "";
      if (isScopedVerifyLabel(l))
        return { ...passing([]), findings: [stubborn] };
      if (l.startsWith("re-review:alpha-"))
        return { ...passing([]), findings: [stubborn] };
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: true }
  );
  assert.ok(
    calls.some((c) => c.label === "fix:alpha-s0w1#r1"),
    "the scoped loop runs in the workstream's own worktree"
  );
  assert.equal(
    labelCalls(calls, "blocked").length,
    0,
    "scoped exhaust does NOT block — ok:true with unresolvedFindings"
  );
  const shipCall = calls.find(
    (c) => c.kind === "workflow" && c.scriptPath.endsWith("verify-and-ship.js")
  );
  assert.equal(
    shipCall.args.carriedFindings.length,
    1,
    "leftovers ride into verify-and-ship as carriedFindings"
  );
  assert.equal(shipCall.args.carriedFindings[0].workstream, "alpha-s0w1");
  assert.ok(
    calls.some((c) => c.label === "hold:alpha"),
    "carried findings force the HOLD at the auto-merge gate"
  );
  assert.equal(result.shipped[0].merge, "held-for-review");
  assert.deepEqual(result.shipped[0].unresolvedFindings, [
    "db.transaction on neon-http",
  ]);
});

test("a re-review FAIL routes into the attempt machinery, not the quality counter", async () => {
  let rr = 0;
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) => {
      const l = opts.label || "";
      if (isScopedVerifyLabel(l))
        return {
          ...passing([]),
          findings: rr === 0 ? [finding("critical", "broken import")] : [],
        };
      if (l.startsWith("re-review:alpha-") && ++rr === 1)
        return {
          verdict: "FAIL",
          gates: [
            {
              id: "G2-subset",
              status: "FAIL",
              evidence: "the fix broke the suite",
            },
          ],
          acceptanceCriteria: [],
          failingGate: "G2-subset",
          fixInstructions: "un-break it",
          summary: "the fix broke the tests",
        };
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: true, maxAttempts: 2 }
  );
  const impls = calls.filter((c) => c.label?.startsWith("impl:"));
  assert.equal(impls.length, 2, "the FAIL spends a real workstream attempt");
  assert.ok(
    impls[1].prompt.includes("the fix broke the suite"),
    "the retry sees the re-review's evidence verbatim, through the normal retryBlock path"
  );
});

// ---------------------------------------------------------------------------
// The G3 re-anchor (#399): a quality-round fix commit moves the branch tip,
// so the functional evidence collected by the first integration verify
// belongs to a sha that no longer exists at the tip. CI re-anchors G1/G2 at
// the final sha; the loop must re-anchor G3 there itself — no sha ships whose
// functional gate never ran at that sha.
// ---------------------------------------------------------------------------

test("a committed fix round forces a G3 re-run at the new sha before the PR", async () => {
  // The fix-round re-push lands on a DIFFERENT sha than the first push, so a
  // regression that re-pins the G3 prompt to the stale pre-fix sha is
  // detectable: the prompt must carry the round-push sha, never f604b2b.
  const roundPushSha = "beefbeef0000000000000000000000000000f1x0";
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) => {
      const l = opts.label || "";
      // A round push is labelled push:<id>#<attempt>r<round>.
      if (/^push:.+r\d+$/.test(l))
        return { pushed: true, headSha: roundPushSha, remoteSha: roundPushSha };
      if (l.startsWith("verify:alpha#"))
        return {
          ...passing([]),
          findings: [finding("critical", "tenant scope missing")],
        };
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: true }
  );
  const g3 = calls.find((c) => c.label?.startsWith("verify:g3:alpha"));
  const pr = calls.find((c) => c.label?.startsWith("pr:alpha"));
  assert.ok(g3, "the functional gate must re-run at the sha that will merge");
  assert.ok(
    calls.indexOf(g3) < calls.indexOf(pr),
    "the re-anchor runs BEFORE anything ships the new sha"
  );
  assert.match(
    g3.prompt,
    /beefbeef/,
    "the re-run is pinned to the re-pushed finalSha"
  );
  assert.ok(
    !/f604b2b/.test(g3.prompt),
    "the re-run must NOT be pinned to the stale pre-fix (first-push) sha"
  );
  assert.ok(
    calls.some((c) => c.label === "merge:alpha"),
    "a passing re-run still auto-merges cleanly"
  );
  assert.equal(result.shipped.length, 1);
});

test("no fix commits means no G3 re-run — the first evidence still matches the tip", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([])),
    { autoMerge: true }
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("verify:g3:")),
    "a track with no post-verify commits needs no re-anchor"
  );
});

test("a G3 re-run FAIL re-enters the attempt machinery like any gate", async () => {
  let g3Seen = 0;
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) => {
      const l = opts.label || "";
      if (l.startsWith("verify:alpha#"))
        return {
          ...passing([]),
          findings: g3Seen ? [] : [finding("critical", "x")],
        };
      if (l.startsWith("verify:g3:") && ++g3Seen === 1)
        return {
          verdict: "FAIL",
          gates: [
            { id: "G3", status: "FAIL", evidence: "the fix broke the flow" },
          ],
          acceptanceCriteria: [],
          failingGate: "G3",
          failingWorkstream: "",
          fixInstructions: "unbreak it",
          summary: "regression introduced by the fix round",
        };
      return replyShip(passing([]))(prompt, opts);
    },
    { autoMerge: true, maxAttempts: 2 }
  );
  assert.ok(
    calls.some((c) => c.label?.startsWith("repair:")),
    "the FAIL takes the normal unattributable-failure path, spending a real attempt"
  );
  assert.equal(
    result.shipped.length,
    1,
    "the second attempt re-verifies and ships"
  );
});

// ---------------------------------------------------------------------------
// The /deliver path (autoMerge=false) and surviving findings: the ruling's
// exhaust outcome is "HOLD with a DECISION comment", and the reviewer on this
// path reads the PR — not the workflow return payload. The menu must reach
// the PR on both paths.
// ---------------------------------------------------------------------------

test("on a direct /deliver run, surviving findings still reach the PR as a DECISION", async () => {
  const stubborn = finding("structural", "spaghetti mode bolted into checkout");
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    (prompt, opts) => {
      const l = opts.label || "";
      if (l.startsWith("verify:alpha#"))
        return { ...passing([]), findings: [stubborn] };
      if (l.startsWith("re-review:alpha#"))
        return { ...passing([]), findings: [stubborn] };
      return replyShip(passing([]))(prompt, opts);
    }
    // no autoMerge — the direct /deliver default
  );
  const menu = calls.find((c) => c.label === "findings:alpha");
  assert.ok(
    menu,
    "the DECISION comment must not depend on AUTO_MERGE — without it the human reviews the PR blind"
  );
  assert.match(menu.prompt, /gh pr comment/);
  assert.match(menu.prompt, /merge as-is — rule the finding accepted/);
  assert.match(menu.prompt, /direct a named fix/);
  assert.ok(
    menu.prompt.includes("spaghetti mode bolted into checkout"),
    "the finding reaches the DECISION verbatim"
  );
  assert.match(menu.prompt, /Surviving worktrees/);
  assert.equal(result.shipped[0].merge, "not-attempted");
});

// ---------------------------------------------------------------------------
// The generate-and-filter recipe (#399 WS3): 3 candidates, an opus judge,
// ff-only land. The runBuild harness evaluates the real recipe file, so these
// cover its control flow: the happy path lands the winner and proceeds to the
// scoped verifier; a winner of 0 returns commits: [] and the parent's
// empty-commits gate fails the attempt before a verifier is spent.
// ---------------------------------------------------------------------------

const candSha = (i) => `aa${i}0000000000000000000000000000000000aa`;

const gafReply =
  ({ winner = 2 } = {}) =>
  (prompt, opts) => {
    const l = opts.label || "";
    if (/^cand\d+:/.test(l)) {
      const i = Number(l.match(/^cand(\d+):/)[1]);
      return {
        committed: true,
        filesChanged: [],
        summary: `candidate ${i}`,
        approach: `approach ${i}`,
        selfCheckPassed: true,
        commits: [candSha(i)],
      };
    }
    if (l.startsWith("judge:"))
      return {
        winner,
        reasons:
          winner === 0 ? "none acceptable" : `candidate ${winner} is cleanest`,
        perCandidate: [1, 2, 3].map((c) => ({
          candidate: c,
          committed: true,
          verdict: c === winner ? "winner" : "rejected",
          notes: c === winner ? "" : "weaker tests",
        })),
      };
    if (l.startsWith("land:"))
      return {
        ...(winner !== 0
          ? { mergeOk: true, landedShas: [candSha(winner)] }
          : {}),
        headSha: winner !== 0 ? candSha(winner) : BASE_SHA,
        worktreeList: "/repo  abcd123 [main]",
        recipeBranches: "",
      };
    return replyShip(passing([]))(prompt, opts);
  };

test("a generate-and-filter unit runs the recipe child, lands the winner, and ships", async () => {
  const { result, calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), recipe: "generate-and-filter" }],
    gafReply()
  );
  const recipeCall = calls.find(
    (c) =>
      c.kind === "workflow" &&
      c.scriptPath.includes("recipes/generate-and-filter.js")
  );
  assert.ok(recipeCall, "the recipe named on the unit is the child that runs");
  assert.equal(
    calls.filter((c) => /^cand\d+:/.test(c.label || "")).length,
    3,
    "three independent candidate implementers fan out"
  );
  assert.ok(
    calls.some((c) => c.label?.startsWith("judge:")),
    "an opus judge picks the winner"
  );
  assert.equal(
    scopedVerify(calls).length,
    1,
    "the landed winner proceeds to the scoped verifier like any attempt"
  );
  assert.equal(result.shipped.length, 1);
});

test("a judge that picks no winner (0) fails the attempt through the empty-commits gate", async () => {
  const { result, calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), recipe: "generate-and-filter" }],
    gafReply({ winner: 0 })
  );
  assert.equal(result.blocked.length, 1);
  assert.equal(
    result.blocked[0].failingGate,
    "recipe",
    "commits: [] comes back and the parent's empty-commits check fails the attempt"
  );
  assert.equal(
    scopedVerify(calls).length,
    0,
    "no verifier is spent on an attempt that landed nothing"
  );
});

// ---------------------------------------------------------------------------
// Recipe weighting (#399): recipes.md and dispatch's SKILL.md say a
// generate-and-filter workstream "counts as 3 agents against the cap" and
// costs ~3x an attempt. RECIPE_AGENT_COST is where that claim is enforced —
// these pin the two mechanisms: the weighted reserve refuses an attempt it
// cannot fund BEFORE the recipe child launches, and the weighted chunking
// keeps the summed in-flight weight under the agent cap.
// ---------------------------------------------------------------------------

test("the token reserve is recipe-weighted: generate-and-filter needs 3x before it starts", async () => {
  const tight = {
    total: 1_000_000,
    spent: () => 700_000,
    remaining: () => 300_000,
  };
  const { result, calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), recipe: "generate-and-filter" }],
    gafReply(),
    { budgetImpl: tight }
  );
  assert.ok(
    !calls.some(
      (c) => c.kind === "workflow" && c.scriptPath.includes("recipes/")
    ),
    "the refusal happens BEFORE the recipe child launches — never mid-flight inside it"
  );
  assert.equal(result.blocked.length, 1);
  assert.match(
    result.blocked[0].reason,
    /450k/,
    "the refusal shows the weighted arithmetic (150k reserve x 3)"
  );

  const plain = await runBuild(
    [buildUnit("alpha", 101)],
    replyShip(passing([])),
    { budgetImpl: tight }
  );
  assert.equal(
    plain.result.shipped.length,
    1,
    "the same budget funds an implement-straight attempt — the weight, not the check, is what changed"
  );
});

test("the agent cap chunks by recipe weight, not workstream count", async () => {
  const { calls } = await runBuild(
    [
      { ...buildUnit("alpha", 101), recipe: "generate-and-filter" },
      { ...buildUnit("beta", 102), recipe: "generate-and-filter" },
    ],
    gafReply(),
    { maxConcurrentAgents: 3 }
  );
  const alphaDone = calls.findIndex(
    (c) => c.label === "label:in-review:alpha#1"
  );
  const betaStart = calls.findIndex((c) => c.label === "start:beta");
  assert.ok(alphaDone !== -1 && betaStart !== -1);
  assert.ok(
    alphaDone < betaStart,
    "two weight-3 tracks under a cap of 3 must serialize — six candidate implementers at once is the 2026-08-09 machine-freeze class"
  );
});

// ---------------------------------------------------------------------------
// The adversarial-implement recipe (#413 WS1): implementer → adversary attacks
// the diff in-worktree → implementer fixes, looping until a round names nothing
// new, capped at 3 rounds.
//
// The parent keeps only `commits` and `rootCauseAddressed` out of a recipe's
// return, so the loop-shaped properties — how many rounds ran, what the cap
// recorded, which agent was told what — are invisible from runBuild. These
// evaluate the recipe file DIRECTLY with stubbed globals, the same wrapper the
// runtime uses, and assert on its own return value. The two runBuild tests at
// the end cover the seam: that the parent selects it and weights it.
// ---------------------------------------------------------------------------

/**
 * Run a recipe child directly. `reply(prompt, opts)` answers each agent. Its
 * `workflow` throws, exactly as the runtime's does — nesting is one level.
 */
async function runRecipe(id, recipeArgs, reply) {
  const calls = [];
  const globals = {
    args: recipeArgs,
    budget: { total: null, spent: () => 0, remaining: () => Infinity },
    log: (m) => calls.push({ kind: "log", value: m }),
    phase: (p) => calls.push({ kind: "phase", value: p }),
    agent: async (prompt, opts = {}) => {
      calls.push({
        kind: "agent",
        label: opts.label,
        phase: opts.phase,
        model: opts.model,
        agentType: opts.agentType,
        prompt,
      });
      return reply(prompt, opts);
    },
    parallel: async (thunks) =>
      Promise.all(
        thunks.map((t) =>
          Promise.resolve()
            .then(t)
            .catch(() => null)
        )
      ),
    workflow: () => {
      throw new Error(
        "workflow() nesting is one level deep — a child must never call workflow()"
      );
    },
  };
  const fn = new Function(
    ...Object.keys(globals),
    `return (async () => { ${load(`recipes/${id}.js`)} })()`
  );
  return { result: await fn(...Object.values(globals)), calls };
}

/** The recipeArgs contract (ops/agent-os/recipes.md), as the parent renders it. */
const recipeArgs = (over = {}) => ({
  track: { id: "alpha", issues: [101], branch: "feature/alpha" },
  workstream: {
    id: "alpha-s0w0",
    lane: "backend",
    issues: [101],
    files: ["src/alpha.ts"],
    summary: "summary for alpha",
    units: [buildUnit("alpha", 101)],
  },
  worktree: "/repo/.claude/worktrees/alpha",
  branch: "feature/alpha",
  base: "origin/main",
  stageIndex: 0,
  attempt: 1,
  priorReport: null,
  retryBlock: null,
  conventions: "CONVENTIONS BLOCK",
  implAgentType: "backend",
  unitBlocksRendered: "### Unit 1: alpha",
  ...over,
});

const IMPL_SHA = "a11a11a11a11a11a11a11a11a11a11a11a11a11a";
const fixSha = (round) => `${round}f${"0".repeat(38)}`;
const adversaryFinding = (n) => ({
  severity: "critical",
  summary: `hole ${n}`,
  attack: `POST the action with a forged church_id — route ${n}`,
  files: ["src/alpha.ts"],
  remedy: `scope the query by session church_id — remedy ${n}`,
});

/**
 * The adversary names one finding per round for the first `findingRounds`
 * rounds, then reports the diff clean.
 */
const advReply =
  ({ findingRounds = 0, implCommits = [IMPL_SHA], fixCommits = true } = {}) =>
  (prompt, opts) => {
    const l = opts.label || "";
    if (l.startsWith("impl:"))
      return {
        committed: true,
        filesChanged: ["src/alpha.ts"],
        summary: "built it",
        selfCheckPassed: true,
        commits: implCommits,
        rootCause: "the named ReferenceError",
        rootCauseAddressed: "moved the import; `pnpm test` is green",
      };
    const adv = l.match(/^adv(\d+):/);
    if (adv) {
      const round = Number(adv[1]);
      return round <= findingRounds
        ? {
            newFindings: [adversaryFinding(round)],
            summary: `attacked; round ${round} got in`,
          }
        : { newFindings: [], summary: "attacked every axis; it held" };
    }
    const fix = l.match(/^advfix(\d+):/);
    if (fix) {
      const round = Number(fix[1]);
      return {
        committed: true,
        filesChanged: ["src/alpha.ts"],
        summary: `closed round ${round}`,
        commits: fixCommits ? [fixSha(round)] : [],
        perFinding: [
          { finding: `hole ${round}`, addressed: "scoped it; test added" },
        ],
      };
    }
    return {};
  };

const labelled = (calls, re) => calls.filter((c) => re.test(c.label || ""));

test("a clean first round ends the adversary loop — no fixer is spent", async () => {
  const { result, calls } = await runRecipe(
    "adversarial-implement",
    recipeArgs(),
    advReply()
  );
  assert.equal(labelled(calls, /^adv\d+:/).length, 1, "one attack ran");
  assert.equal(
    labelled(calls, /^advfix\d+:/).length,
    0,
    "a diff that held costs no fix round"
  );
  assert.deepEqual(result.commits, [IMPL_SHA]);
  assert.deepEqual(result.warnings, [], "a clean loop warns about nothing");
  assert.match(result.summary, /1 round, no findings/);
});

test("findings go to the implementer and the loop re-attacks the fix", async () => {
  const { result, calls } = await runRecipe(
    "adversarial-implement",
    recipeArgs(),
    advReply({ findingRounds: 1 })
  );
  assert.equal(
    labelled(calls, /^adv\d+:/).length,
    2,
    "round 2 exists because a fix is new code the adversary has never read"
  );
  assert.equal(labelled(calls, /^advfix\d+:/).length, 1);
  assert.deepEqual(
    result.commits,
    [fixSha(1), IMPL_SHA],
    "`git log --format=%H` is newest-first, so the fix leads — commits[0] must stay the branch tip"
  );
  assert.deepEqual(result.warnings, []);
  assert.match(result.summary, /2 rounds, 1 finding\(s\) closed/);
});

test("the fixer gets the finding VERBATIM, and the adversary never writes code", async () => {
  const { calls } = await runRecipe(
    "adversarial-implement",
    recipeArgs(),
    advReply({ findingRounds: 1 })
  );
  const adv = labelled(calls, /^adv1:/)[0];
  const fix = labelled(calls, /^advfix1:/)[0];
  assert.equal(
    adv.agentType,
    "code-reviewer",
    "the attacker is a different agent from the implementer — it must not mark its own homework"
  );
  assert.equal(adv.model, "opus");
  assert.match(
    adv.prompt,
    /MUST NOT write code, commit, push, merge, edit labels or issues/
  );
  assert.match(
    adv.prompt,
    /SESSION FIRST, THEN THE PARSE/,
    "the HR4 security lens, run pre-gate — the same axes, not a generic review"
  );
  assert.match(adv.prompt, /TENANT BOUNDARIES/);
  assert.match(adv.prompt, /memory\/invariants\.md/);
  assert.equal(fix.agentType, "backend", "the implementer's lane fixes");
  assert.ok(
    fix.prompt.includes(adversaryFinding(1).attack),
    "the named attack reaches the fixer verbatim — a paraphrase is where a defect becomes a hunch"
  );
  assert.ok(fix.prompt.includes(adversaryFinding(1).remedy));
  assert.match(fix.prompt, /Do NOT push/);
});

test("a later round is told what was already reported, so it reports only what is NEW", async () => {
  const { calls } = await runRecipe(
    "adversarial-implement",
    recipeArgs(),
    advReply({ findingRounds: 1 })
  );
  const second = labelled(calls, /^adv2:/)[0];
  assert.match(second.prompt, /already reported/);
  assert.ok(
    second.prompt.includes(adversaryFinding(1).summary),
    "without the prior findings the loop can never terminate — round 2 re-reports round 1"
  );
});

test("the 3-round cap is enforced AND recorded in the warnings — never a silent stop", async () => {
  const { result, calls } = await runRecipe(
    "adversarial-implement",
    recipeArgs(),
    // The adversary never runs out of findings.
    advReply({ findingRounds: 99 })
  );
  assert.equal(labelled(calls, /^adv\d+:/).length, 3, "capped at 3 attacks");
  assert.equal(labelled(calls, /^advfix\d+:/).length, 3, "and 3 fixes");
  assert.ok(
    result.warnings.some((w) => /3-round cap/.test(w)),
    "a loop that gave up looks exactly like a loop that converged — the difference has to be said out loud"
  );
  assert.match(result.summary, /cap reached without a clean round/);
  assert.deepEqual(
    result.commits,
    [fixSha(3), fixSha(2), fixSha(1), IMPL_SHA],
    "every round's commits survive, newest first"
  );
});

test("a fix that committed nothing is warned about, not reported closed", async () => {
  const { result } = await runRecipe(
    "adversarial-implement",
    recipeArgs(),
    advReply({ findingRounds: 1, fixCommits: false })
  );
  assert.ok(
    result.warnings.some((w) => /committed nothing/.test(w)),
    "the finding is still open and the returned warnings are where the journal meets it"
  );
  assert.ok(
    result.warnings.some((w) => /hole 1/.test(w)),
    "the open finding is NAMED, not counted"
  );
});

test("a dead adversary is a warning, and the attempt still carries its commits", async () => {
  const { result } = await runRecipe(
    "adversarial-implement",
    recipeArgs(),
    (prompt, opts) =>
      /^adv\d+:/.test(opts.label || "") ? null : advReply()(prompt, opts)
  );
  assert.deepEqual(result.commits, [IMPL_SHA]);
  assert.ok(
    result.warnings.some((w) => /adversary agent died/.test(w)),
    "the gates still run — but nobody may read the journal as if the diff was attacked"
  );
});

// The summary is the recipe's most visible output and, for a reader skimming
// the journal, often the only one. These two pin the property the recipe's own
// header states: a loop that quietly gave up must not read like a loop that
// converged. Both defects were real — an empty `seenFindings` was being taken
// for "the adversary signed it off", and a populated one for "they were closed".
test("a dead adversary NEVER reports 'no findings' — an unfinished attack is not a clean one", async () => {
  const { result } = await runRecipe(
    "adversarial-implement",
    recipeArgs(),
    (prompt, opts) =>
      /^adv\d+:/.test(opts.label || "") ? null : advReply()(prompt, opts)
  );
  assert.doesNotMatch(
    result.summary,
    /no findings/,
    "byte-identical to the clean run's summary is exactly the failure the cap exists to prevent"
  );
  assert.match(result.summary, /attack incomplete/);
});

test("a dead fixer NEVER reports findings 'closed' — nothing closed them", async () => {
  const { result } = await runRecipe(
    "adversarial-implement",
    recipeArgs(),
    (prompt, opts) =>
      /^advfix\d+:/.test(opts.label || "")
        ? null
        : advReply({ findingRounds: 1 })(prompt, opts)
  );
  assert.doesNotMatch(
    result.summary,
    /finding\(s\) closed/,
    "the fixer died with the finding open — reporting it closed is the lie"
  );
  assert.match(result.summary, /left open — the fix never landed/);
  assert.ok(
    result.warnings.some((w) => /fix agent died/.test(w)),
    "and the warning names it too"
  );
});

test("the adversary's diff range is anchored on a REF, never on the implementer's commit count", async () => {
  const { calls } = await runRecipe(
    "adversarial-implement",
    // Three commits, so a count-derived range would render `~3` and be wrong
    // the moment the implementer under-reports.
    recipeArgs(),
    advReply({
      implCommits: [IMPL_SHA, `b${"1".repeat(39)}`, `c${"2".repeat(39)}`],
    })
  );
  const adv = labelled(calls, /^adv1:/)[0];
  assert.match(
    adv.prompt,
    /git -C \S+ diff origin\/main\.\.\.feature\/alpha/,
    "the range comes from `base`, which no agent reported"
  );
  assert.doesNotMatch(
    adv.prompt,
    /diff \S+~\d+\.\./,
    "a self-reported count that is short silently narrows what gets attacked, and the adversary cannot tell"
  );
  assert.match(
    adv.prompt,
    /THE LOG WINS/,
    "the report is cross-checked against the log rather than trusted"
  );
});

test("an implementer that committed nothing skips the adversary entirely", async () => {
  const { result, calls } = await runRecipe(
    "adversarial-implement",
    recipeArgs(),
    advReply({ implCommits: [] })
  );
  assert.deepEqual(
    result.commits,
    [],
    "commits: [] is what the parent's empty-commits gate reads"
  );
  assert.equal(
    labelled(calls, /^adv\d+:/).length,
    0,
    "spending an opus attacker on a diff that does not exist proves nothing"
  );
});

test("a retry passes the implementer's root-cause answer through verbatim", async () => {
  const { result, calls } = await runRecipe(
    "adversarial-implement",
    recipeArgs({
      priorReport: { verdict: "FAIL", failingGate: "G2-subset" },
      retryBlock: `THE ROOT CAUSE IS BELOW\n${CRASH}`,
    }),
    advReply({ findingRounds: 1 })
  );
  assert.equal(result.rootCause, "the named ReferenceError");
  assert.equal(
    result.rootCauseAddressed,
    "moved the import; `pnpm test` is green",
    "the parent's refusal gate reads this — the adversary rounds report through warnings and never rewrite it"
  );
  const impl = labelled(calls, /^impl:/)[0];
  assert.ok(
    impl.prompt.startsWith("THE ROOT CAUSE IS BELOW"),
    "mod 2: the parent-rendered retryBlock is prepended VERBATIM"
  );
});

test("an adversarial-implement unit runs the recipe child and ships", async () => {
  const { result, calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), recipe: "adversarial-implement" }],
    replyShip(passing([]))
  );
  assert.ok(
    calls.some(
      (c) =>
        c.kind === "workflow" &&
        c.scriptPath.includes("recipes/adversarial-implement.js")
    ),
    "the recipe named on the unit is the child that runs"
  );
  assert.ok(
    calls.some((c) => /^adv1:/.test(c.label || "")),
    "the attack runs inside the attempt, before any gate"
  );
  assert.equal(
    scopedVerify(calls).length,
    1,
    "the attacked diff proceeds to the scoped verifier like any attempt"
  );
  assert.equal(result.shipped.length, 1);
});

test("the token reserve is recipe-weighted: adversarial-implement needs 3x before it starts", async () => {
  const tight = {
    total: 1_000_000,
    spent: () => 700_000,
    remaining: () => 300_000,
  };
  const { result, calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), recipe: "adversarial-implement" }],
    replyShip(passing([])),
    { budgetImpl: tight }
  );
  assert.ok(
    !calls.some(
      (c) => c.kind === "workflow" && c.scriptPath.includes("recipes/")
    ),
    "an attempt that cannot fund its adversary rounds must be refused BEFORE it starts — stopping mid-loop ships the unattacked diff, which is the one outcome the recipe exists to prevent"
  );
  assert.equal(result.blocked.length, 1);
  assert.match(
    result.blocked[0].reason,
    /450k/,
    "the refusal shows the weighted arithmetic (150k reserve x 3)"
  );
});

// ---------------------------------------------------------------------------
// The recipe `warnings` channel (the return contract, recipes.md).
//
// A loop-shaped recipe's cap, its dead agents and its unfixed findings all come
// back as `warnings` and nowhere else. Until this was wired the parent read
// only `commits` and `rootCauseAddressed`, so an attempt that gave up reached
// the verifier carrying commits and nothing else — indistinguishable from a
// converged one, while two files claimed the opposite. These pin BOTH halves of
// the promise: the journal and the verifier's own prompt.
// ---------------------------------------------------------------------------

const RECIPE_WARNING =
  "adversarial-implement hit its 3-round cap: 2 finding(s) are still open";

test("a recipe's warnings reach the journal AND the scoped verifier's prompt", async () => {
  const { calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), recipe: "adversarial-implement" }],
    replyShip(passing([])),
    {
      workflowImpl: async () => ({
        summary: "built it, but the loop never converged",
        commits: ["c0ffee00000000000000000000000000000000aa"],
        warnings: [RECIPE_WARNING, "  ", null],
      }),
    }
  );
  assert.ok(
    calls.some((c) => c.kind === "log" && c.value.includes(RECIPE_WARNING)),
    "the journal is where a human meets it"
  );
  assert.ok(
    calls.some(
      (c) => c.kind === "log" && /adversarial-implement/.test(c.value || "")
    ),
    "and the log line names the recipe that said it"
  );
  const verify = scopedVerify(calls);
  assert.equal(verify.length, 1);
  assert.ok(
    verify[0].prompt.includes(RECIPE_WARNING),
    "the verifier is the one agent that can act on it — a warning it never sees gates nothing"
  );
  assert.match(
    verify[0].prompt,
    /treat each as evidence, not as noise/,
    "framed as evidence, not as an aside to skim past"
  );
  assert.doesNotMatch(
    verify[0].prompt,
    /^- \s*$/m,
    "blank and null warnings are dropped rather than rendered as empty bullets"
  );
});

test("a recipe that committed nothing still says WHY — its warnings ride the retry", async () => {
  const { calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), recipe: "adversarial-implement" }],
    replyShip(passing([])),
    {
      maxAttempts: 2,
      workflowImpl: async (_spec, wfArgs) =>
        wfArgs.attempt === 1
          ? {
              summary: "nothing built",
              commits: [],
              warnings: ["the implementer agent died — no commits were made"],
            }
          : {
              summary: "built it",
              commits: ["c0ffee00000000000000000000000000000000aa"],
              warnings: [],
            },
    }
  );
  assert.ok(
    calls.some(
      (c) =>
        c.kind === "log" && /the implementer agent died/.test(c.value || "")
    ),
    "logged before the empty-commits gate, or a dead implementer reads as a plain 'no commits'"
  );
  const retry = calls.find(
    (c) => c.kind === "workflow" && c.args?.attempt === 2
  );
  assert.match(
    retry.args.retryBlock,
    /the implementer agent died/,
    "the next attempt is told what the last one could not close"
  );
});

// ---------------------------------------------------------------------------
// The repro-first recipe (#413 WS1): repro agent writes the failing test and
// RUNS it (must go red) → implementer fixes the code without touching it → a
// third agent re-runs the SAME command (must go green).
//
// Every property worth having here is an ORDER or a REFUSAL, and neither is
// visible from runBuild — the parent keeps only `commits` and
// `rootCauseAddressed` out of a recipe's return. So these evaluate the recipe
// file directly through `runRecipe`, exactly as the adversarial-implement tests
// above do, and the two runBuild tests at the end cover the seam.
// ---------------------------------------------------------------------------

const REPRO_SHA = `9e${"0".repeat(38)}`;
const REPRO_COMMAND = "pnpm test src/alpha.test.ts";
const RED_OUTPUT =
  "FAIL src/alpha.test.ts\n  x scopes the read by church_id\n  AssertionError: expected 2 rows, got 5";
const GREEN_OUTPUT = "PASS src/alpha.test.ts (1 test, 1 passed)";

/**
 * The three-agent happy path, with each knob a test needs to break out on its
 * own. `null` for any of the three phases makes that agent die.
 */
const reproReply =
  ({
    wentRed = true,
    reproCommand = REPRO_COMMAND,
    reproPaths = ["src/alpha.test.ts"],
    redOutput = RED_OUTPUT,
    redIsTheBug = "the assertion is the defect — the query is unscoped",
    reproCommits = [REPRO_SHA],
    deviations = "",
    implCommits = [IMPL_SHA],
    implDead = false,
    confirmDead = false,
    ran = true,
    confirmCommand = REPRO_COMMAND,
    confirmOutput = GREEN_OUTPUT,
    passed = true,
    reproChanged = false,
  } = {}) =>
  (prompt, opts) => {
    const l = opts.label || "";
    if (l.startsWith("repro:"))
      return {
        wentRed,
        reproCommand,
        reproPaths,
        redOutput,
        redIsTheBug,
        committed: reproCommits.length > 0,
        commits: reproCommits,
        deviations,
        summary: "wrote the failing test and watched it fail",
      };
    if (l.startsWith("impl:"))
      return implDead
        ? null
        : {
            committed: true,
            filesChanged: ["src/alpha.ts"],
            summary: "fixed the query",
            selfCheckPassed: true,
            commits: implCommits,
            rootCause: "the named ReferenceError",
            rootCauseAddressed: "moved the import; `pnpm test` is green",
          };
    if (l.startsWith("green:"))
      return confirmDead
        ? null
        : {
            ran,
            command: confirmCommand,
            output: confirmOutput,
            passed,
            reproChanged,
          };
    return {};
  };

const order = (calls, re) => calls.findIndex((c) => re.test(c.label || ""));

test("the repro runs FIRST, and the fix only ever follows a red run", async () => {
  const { result, calls } = await runRecipe(
    "repro-first",
    recipeArgs(),
    reproReply()
  );
  const [repro, impl, green] = [/^repro:/, /^impl:/, /^green:/].map((re) =>
    order(calls, re)
  );
  assert.ok(repro !== -1 && impl !== -1 && green !== -1, "all three ran");
  assert.ok(
    repro < impl && impl < green,
    "a test written after the fix has never had the chance to fail — the order IS the recipe"
  );
  assert.deepEqual(
    result.commits,
    [IMPL_SHA, REPRO_SHA],
    "`git log --format=%H` is newest-first, so the fix leads and the repro commit still rides along"
  );
  assert.deepEqual(result.warnings, []);
  assert.match(result.summary, /red→green confirmed/);
});

test("a repro that never goes red refuses the attempt — no implementer is spent", async () => {
  const { result, calls } = await runRecipe(
    "repro-first",
    recipeArgs(),
    reproReply({
      wentRed: false,
      deviations: "touched src/other.ts to read the failing path",
    })
  );
  assert.deepEqual(
    result.commits,
    [],
    "commits: [] is what the parent's empty-commits gate reads — the attempt fails before a verifier is spent"
  );
  assert.equal(
    order(calls, /^impl:/),
    -1,
    "a green repro means the bug is not where the issue says it is; sending an implementer in behind it fixes the wrong thing"
  );
  assert.equal(order(calls, /^green:/), -1);
  assert.ok(
    result.warnings.some((w) => /never went red|did not fail/.test(w)),
    "the refusal has to SAY what could not be shown, or the next attempt repeats it"
  );
  assert.ok(
    result.warnings.some((w) => /still on feature\/alpha/.test(w)),
    "and say that the repro commit survives, so the retry starts from it rather than from nothing"
  );
  assert.ok(
    result.warnings.some((w) => /touched src\/other\.ts/.test(w)),
    "a refusal still reports what the repro agent did outside its declared files — the refusal is not a reason to drop the other channel"
  );
});

test("…but on a RETRY the same un-reproducible finding is FIXED, not refused", async () => {
  // The refusal above is right for attempt 1 and terminal on attempt 2:
  // MAX_ATTEMPTS is 2 for any wave without a risk:high unit, the branch is not
  // reset between attempts, and a verifier finding that is not test-shaped (a
  // G5 deviation, a G0, a lint error) has nothing that can be made to go red.
  // Refusing there spends the last attempt on a refusal and blocks the
  // workstream over a fix that implement-straight would have made in one file —
  // and neither implement-straight nor adversarial-implement can refuse a retry
  // before the implementer has seen the retryBlock.
  //
  // The carve-out's LIKELY shape keeps the command: REPRO_SCHEMA requires
  // `reproCommand` and `redOutput`, and the brief asks for `wentRed: false`
  // "with what you saw" — so the fixture keeps both, and phase 3 must still be
  // skipped. Gating that skip on the string instead of on the observed red sent
  // a confirm agent in holding a prompt that asserts a red that never happened,
  // and its `passed: false` came back as "the repro is STILL RED after the fix"
  // — a fabricated red, into the journal and into the next attempt's
  // fixInstructions.
  const { result, calls } = await runRecipe(
    "repro-first",
    recipeArgs({
      priorReport: { verdict: "FAIL", failingGate: "G5" },
      retryBlock: `THE ROOT CAUSE IS BELOW\nG5: src/other.ts is outside the declared file set`,
    }),
    reproReply({ wentRed: false, passed: false, confirmOutput: "boom" })
  );
  assert.notEqual(
    order(calls, /^impl:/),
    -1,
    "the implementer MUST be spawned on the attempt that was supposed to fix the named finding"
  );
  assert.equal(
    order(calls, /^green:/),
    -1,
    "and NO confirm agent is spent on a repro that never went red, command or no command — phase 3 exists to show red→green, and there is no red to pair"
  );
  assert.ok(
    !result.warnings.some((w) => /STILL RED/.test(w)),
    "nothing may report a red this attempt never observed — that warning rides fixInstructions into the next attempt as the failure to reproduce"
  );
  assert.ok(
    labelled(calls, /^impl:/)[0].prompt.startsWith("THE ROOT CAUSE IS BELOW"),
    "and it fixes what the verifier named, since that report is the evidence standing in for the repro"
  );
  assert.ok(
    result.commits.length > 0,
    "commits: [] would fail the parent's empty-commits gate and exhaust the last attempt"
  );
  assert.ok(
    result.warnings.some((w) => /not test-shaped/.test(w)),
    "the carve-out names what could not be reproduced — it is a fix without a repro, not a proven red→green"
  );
  assert.ok(
    result.warnings.some((w) => /wentRed: false/.test(w)),
    "and still says which half of the claim was missing"
  );
  assert.match(
    result.summary,
    /unconfirmed — no repro went red/,
    "nothing may read as a red→green this attempt did not show"
  );
});

test("a retry with no repro command skips the confirmation instead of faking one", async () => {
  const { result, calls } = await runRecipe(
    "repro-first",
    recipeArgs({
      priorReport: { verdict: "FAIL", failingGate: "lint" },
      retryBlock: "THE ROOT CAUSE IS BELOW\nlint: unused import",
    }),
    reproReply({ wentRed: false, reproCommand: "", redOutput: "" })
  );
  assert.notEqual(order(calls, /^impl:/), -1, "the fix still happens");
  assert.equal(
    order(calls, /^green:/),
    -1,
    "no red was observed and there is not even a command to re-run — an agent sent to run nothing has nothing to report"
  );
  assert.ok(
    !result.warnings.some((w) => /confirming agent died/.test(w)),
    "a SKIPPED phase 3 is not a dead confirmer"
  );
  assert.match(result.summary, /unconfirmed — no repro went red/);
  assert.ok(
    !/repro: ``/.test(result.summary),
    "and the summary names no empty repro command"
  );
});

test("a red claim nobody can re-run is refused exactly like a green one", async () => {
  // "Red" is a claim with three parts. Missing any one of them and the
  // confirmation cannot happen at all, which makes the whole recipe
  // unfalsifiable — so each is refused, and each says which part was missing.
  for (const [over, why] of [
    [{ reproCommand: "" }, /named no command/],
    [{ redOutput: "" }, /transcribed no failing output/],
    [{ reproCommits: [] }, /committed nothing/],
  ]) {
    const { result, calls } = await runRecipe(
      "repro-first",
      recipeArgs(),
      reproReply(over)
    );
    assert.deepEqual(result.commits, [], `refused: ${why}`);
    assert.equal(order(calls, /^impl:/), -1);
    assert.ok(
      result.warnings.some((w) => why.test(w)),
      `the warning names the missing half: ${why}`
    );
  }
});

test("the red transcript reaches the implementer VERBATIM, and it is told to leave the repro alone", async () => {
  const { calls } = await runRecipe("repro-first", recipeArgs(), reproReply());
  const impl = labelled(calls, /^impl:/)[0];
  assert.ok(
    impl.prompt.includes(RED_OUTPUT),
    "a paraphrased stack trace is where a defect turns back into a hunch"
  );
  assert.ok(impl.prompt.includes(REPRO_COMMAND));
  assert.match(
    impl.prompt,
    /Do NOT edit, weaken, skip or delete the repro/,
    "editing the assertion until it passes is the one move this recipe exists to prevent"
  );
  assert.match(impl.prompt, /Do NOT push/);
});

test("the implementer never certifies its own fix — a different agent re-runs the repro", async () => {
  const { calls } = await runRecipe("repro-first", recipeArgs(), reproReply());
  const green = labelled(calls, /^green:/)[0];
  assert.equal(
    green.agentType,
    "code-reviewer",
    "'the repro passes now' is exactly the claim a green-washed fix makes about itself"
  );
  assert.ok(green.prompt.includes(REPRO_COMMAND), "the SAME command, verbatim");
  assert.ok(
    green.prompt.includes(RED_OUTPUT),
    "with the before-picture, so 'it passes' can be told from 'it no longer runs'"
  );
  assert.match(green.prompt, /MUST NOT write code, edit any file, commit/);
});

test("the confirmation finds the repro commit from the LOG, not from the reported sha", async () => {
  const { calls } = await runRecipe("repro-first", recipeArgs(), reproReply());
  const green = labelled(calls, /^green:/)[0];
  assert.match(
    green.prompt,
    /log --oneline --reverse origin\/main\.\.feature\/alpha -- src\/alpha\.test\.ts/,
    "the anchor is ref-derived — a mis-transcribed sha points the edit check at the wrong commit and nobody can tell"
  );
  assert.match(green.prompt, /THE LOG WINS/);
});

test("a dead confirmer NEVER reports green — an unproven fix is not a proven one", async () => {
  const { result } = await runRecipe(
    "repro-first",
    recipeArgs(),
    reproReply({ confirmDead: true })
  );
  assert.deepEqual(
    result.commits,
    [IMPL_SHA, REPRO_SHA],
    "the work is real, so the gates still get it"
  );
  assert.doesNotMatch(
    result.summary,
    /red→green confirmed/,
    "byte-identical to a confirmed run is exactly the failure the third agent exists to prevent"
  );
  assert.match(result.summary, /unconfirmed/);
  assert.ok(result.warnings.some((w) => /confirming agent died/.test(w)));
});

test("a confirmation that ran a DIFFERENT command is not a green run", async () => {
  const { result } = await runRecipe(
    "repro-first",
    recipeArgs(),
    reproReply({ confirmCommand: "pnpm test src/unrelated.test.ts" })
  );
  assert.doesNotMatch(result.summary, /red→green confirmed/);
  assert.match(result.summary, /different command/);
  assert.ok(
    result.warnings.some((w) => /instead of the repro command/.test(w)),
    "a narrower command answers a different question, and passing it off as the repro is the cheap way to green"
  );
});

test("a repro still red after the fix keeps its commits and says so out loud", async () => {
  const { result } = await runRecipe(
    "repro-first",
    recipeArgs(),
    reproReply({ passed: false, confirmOutput: RED_OUTPUT })
  );
  assert.deepEqual(
    result.commits,
    [IMPL_SHA, REPRO_SHA],
    "the diff is real work; discarding it on a failing repro would throw away the next attempt's starting point"
  );
  assert.match(result.summary, /STILL RED after the fix/);
  assert.ok(
    result.warnings.some((w) => /STILL RED/.test(w)),
    "the warning is what reaches the journal and the scoped verifier's prompt"
  );
});

test("a repro edited after it went red is reported even when the run is green", async () => {
  const { result } = await runRecipe(
    "repro-first",
    recipeArgs(),
    reproReply({
      reproChanged: true,
      confirmDead: false,
    })
  );
  assert.ok(
    result.warnings.some((w) =>
      /EDITED after the commit that made it red/.test(w)
    ),
    "weakening the assertion is how a red repro is made green without a fix — green is not the end of the question"
  );
  assert.match(result.summary, /edited after it went red/);
});

test("a repro that named NO file gets the gap named, never a fabricated EDITED claim", async () => {
  // `reproPaths` is the one part of the red claim phaseOneFailure never checks
  // (an empty array satisfies a schema `required`), so a proven red can reach
  // phase 3 with no path. Ranging the edit-check over `-- .` there diffs the
  // implementer's WHOLE fix and comes back "the repro changed" every time — the
  // fabricated red again, one function down, riding the journal into the next
  // attempt's fixInstructions. So the confirm agent is told to answer `false`
  // rather than asked a question it cannot answer.
  const { result, calls } = await runRecipe(
    "repro-first",
    recipeArgs(),
    reproReply({ reproPaths: [], reproChanged: true })
  );
  const green = labelled(calls, /^green:/)[0];
  assert.ok(
    !/ -- \.(\s|`|$)/.test(green.prompt),
    "no whole-branch range: `-- .` is not a wider check, it is a check that always fires"
  );
  assert.doesNotMatch(
    green.prompt,
    /log --oneline --reverse/,
    "with nothing to anchor on, the edit-check framing leaves the prompt entirely"
  );
  assert.match(green.prompt, /Return `reproChanged: false`/);
  assert.ok(
    !result.warnings.some((w) => /EDITED/.test(w)),
    "the recipe may not report an edit no anchored check ever observed"
  );
  assert.ok(
    result.warnings.some((w) => /could not be anchored/.test(w)),
    "the truthful warning names the missing check instead — that is what the journal and the next attempt read"
  );
  assert.doesNotMatch(result.summary, /edited after it went red/);
  assert.match(result.summary, /red→green confirmed/);
});

test("a dead implementer refuses rather than shipping a known-failing test as the attempt", async () => {
  const { result, calls } = await runRecipe(
    "repro-first",
    recipeArgs(),
    reproReply({ implDead: true })
  );
  assert.deepEqual(
    result.commits,
    [],
    "that diff is a failing test and nothing else — sending it to a verifier buys a confident FAIL for the price of a full gate run"
  );
  assert.equal(order(calls, /^green:/), -1, "there is nothing to confirm");
  assert.ok(
    result.warnings.some((w) => /still failing/.test(w)),
    "and the branch state is named, because the next attempt inherits it"
  );
});

test("a LIVE implementer that reports no commits is warned about, and the repro is still re-run", async () => {
  // The opposite of the dead-implementer path, on purpose: an implementer that
  // fixed the bug and mis-transcribed its shas is the common case of this
  // shape. Refusing here would leave the next attempt's repro agent looking at
  // a repro that now PASSES — which it must refuse in turn, dead-ending a track
  // over a transcription slip. The confirmation run answers what the shas
  // cannot.
  const { result, calls } = await runRecipe(
    "repro-first",
    recipeArgs(),
    reproReply({ implCommits: [] })
  );
  assert.ok(
    order(calls, /^green:/) !== -1,
    "the run that can tell a mis-transcribed sha from a missing fix must still happen"
  );
  assert.deepEqual(result.commits, [REPRO_SHA]);
  assert.ok(
    result.warnings.some((w) => /reported no commits of its own/.test(w)),
    "and the ambiguity is named rather than resolved by guessing"
  );
  assert.match(result.summary, /red→green confirmed/);
});

test("a retry hands the retryBlock to BOTH the repro agent and the implementer, verbatim", async () => {
  const { result, calls } = await runRecipe(
    "repro-first",
    recipeArgs({
      priorReport: { verdict: "FAIL", failingGate: "G2-subset" },
      retryBlock: `THE ROOT CAUSE IS BELOW\n${CRASH}`,
    }),
    reproReply()
  );
  assert.ok(
    labelled(calls, /^repro:/)[0].prompt.startsWith("THE ROOT CAUSE IS BELOW"),
    "on a retry the failure the verifier NAMED is the repro to write first"
  );
  assert.ok(
    labelled(calls, /^impl:/)[0].prompt.startsWith("THE ROOT CAUSE IS BELOW"),
    "mod 2: the parent-rendered retryBlock is prepended VERBATIM to the implementer prompt"
  );
  assert.equal(result.rootCause, "the named ReferenceError");
  assert.equal(
    result.rootCauseAddressed,
    "moved the import; `pnpm test` is green",
    "the parent's refusal gate reads this — the repro and the confirmation never rewrite it"
  );
});

/** replyShip knows nothing about repro-first's two extra phases. */
const replyShipRepro = (verifyReport) => (prompt, opts) => {
  const l = opts.label || "";
  if (l.startsWith("repro:") || l.startsWith("green:"))
    return reproReply({ implCommits: [] })(prompt, opts);
  return replyShip(verifyReport)(prompt, opts);
};

test("a repro-first unit runs the recipe child and ships", async () => {
  const { result, calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), recipe: "repro-first" }],
    replyShipRepro(passing([]))
  );
  assert.ok(
    calls.some(
      (c) =>
        c.kind === "workflow" && c.scriptPath.includes("recipes/repro-first.js")
    ),
    "the recipe named on the unit is the child that runs"
  );
  assert.ok(
    calls.some((c) => /^repro:/.test(c.label || "")),
    "the repro runs inside the attempt, before the implementer"
  );
  assert.equal(
    scopedVerify(calls).length,
    1,
    "a proven fix proceeds to the scoped verifier like any attempt"
  );
  assert.equal(result.shipped.length, 1);
});

test("repro-first weighs 1: the budget that refuses adversarial-implement funds it", async () => {
  // Three agents, weight 1 — deliberately. The recipe REORDERS one attempt's
  // work rather than fanning it out, and weighting it by agent count would
  // refuse ordinary bug attempts on budgets that fund the identical work under
  // implement-straight. That is how a discipline gets switched off for costing
  // too much.
  const tight = {
    total: 1_000_000,
    spent: () => 700_000,
    remaining: () => 300_000,
  };
  const { result, calls } = await runBuild(
    [{ ...buildUnit("alpha", 101), recipe: "repro-first" }],
    replyShipRepro(passing([])),
    { budgetImpl: tight }
  );
  assert.ok(
    calls.some(
      (c) =>
        c.kind === "workflow" && c.scriptPath.includes("recipes/repro-first.js")
    ),
    "the same 300k that refuses a weight-3 recipe outright funds this one"
  );
  assert.equal(result.blocked.length, 0);
  assert.equal(result.shipped.length, 1);
});

// ---------------------------------------------------------------------------
// The two file-level mechanisms: the parent idiom and the format hook.
//
// Neither is exercised by a stubbed run — one is a doctrine about which command
// agents are told to use, the other is a shell hook. Both were re-derived live
// by agents in the first two passes, so both are pinned here as text.
// ---------------------------------------------------------------------------

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PARENT_DOC_FILES = [
  ".claude/workflows/build-until-done.js",
  "ops/agent-os/dod.md",
  "ops/agent-os/labels.md",
];

// Every workflow script must parse — AC1 of #399. The set is ENUMERATED from
// disk rather than maintained by hand, so a new recipe can never be silently
// unlisted.
//
// NOTE: `node --check` is deliberately NOT used here — on Node 24 it exits 0
// WITHOUT parsing any file it detects as ESM, and `export const meta` makes
// every workflow script ESM-detected, so that gate could never fail. Instead
// each file is parsed exactly the way the runtime (and the runBuild harness
// above) evaluates it: strip the export, wrap the body in the
// injected-globals function, and let the parser see all of it.
const listJs = (dir) =>
  fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `${dir}/${f}`)
    .sort();
const WORKFLOW_FILES = [
  ...listJs(".claude/workflows"),
  ...listJs(".claude/workflows/recipes"),
];

test("every workflow script parses under the harness wrapper (AC1)", () => {
  for (const name of [
    "build-until-done.js",
    "verify-and-ship.js",
    "frd-plan.js",
    "frd-implement.js",
    "recipes/implement-straight.js",
    "recipes/generate-and-filter.js",
    "recipes/adversarial-implement.js",
    "recipes/repro-first.js",
  ])
    assert.ok(
      WORKFLOW_FILES.includes(`.claude/workflows/${name}`),
      `${name} must be in the enumerated set`
    );
  for (const file of WORKFLOW_FILES) {
    const source = read(file).replace(/^export const meta/m, "const meta");
    try {
      new Function(
        "args",
        "budget",
        "log",
        "agent",
        "parallel",
        "workflow",
        "phase",
        "pipeline",
        `return (async () => { ${source} })()`
      );
    } catch (e) {
      assert.fail(`${file} does not parse: ${e.message}`);
    }
  }
});

// A recipe is registered in FOUR places (recipes.md "Adding a recipe"), and
// three of them are text a stubbed run cannot reach: the parse-time registry,
// the cost weight, the dispatch selection row and the contract section. Half a
// registration is the failure mode — a recipe file with no KNOWN_RECIPES entry
// throws at selection; a cost row missing under-reserves the fan-out.
test("adversarial-implement is registered in all four places, and the risk:high default is stated", () => {
  const loop = read(".claude/workflows/build-until-done.js");
  assert.match(
    loop,
    /"adversarial-implement"/,
    "KNOWN_RECIPES is the parse-time registry — an unlisted recipe throws on selection"
  );
  assert.match(
    loop,
    /"adversarial-implement":\s*3/,
    "RECIPE_AGENT_COST = 3 is where the ~3x claim is ENFORCED, not merely documented"
  );
  assert.match(
    read(".claude/skills/dispatch/SKILL.md"),
    /`adversarial-implement`[^\n]*risk:high/,
    "dispatch's selection table is authoritative for which task shapes get which recipe"
  );
  assert.match(
    read("ops/agent-os/recipes.md"),
    /^## `adversarial-implement`$/m,
    "recipes.md carries a section per the 'Adding a recipe' checklist"
  );
});

test("repro-first is registered in all four places, and the bug default is stated", () => {
  const loop = read(".claude/workflows/build-until-done.js");
  assert.match(
    loop,
    /"repro-first"/,
    "KNOWN_RECIPES is the parse-time registry — an unlisted recipe throws on selection"
  );
  assert.match(
    loop,
    /"repro-first":\s*1/,
    "weight 1 despite three agents: the recipe reorders one attempt's work rather than fanning it out"
  );
  assert.match(
    read(".claude/skills/dispatch/SKILL.md"),
    /`repro-first`[^\n]*bug/,
    "dispatch's selection table is authoritative for which task shapes get which recipe"
  );
  assert.match(
    read("ops/agent-os/recipes.md"),
    /^## `repro-first`$/m,
    "recipes.md carries a section per the 'Adding a recipe' checklist"
  );
});

// ---------------------------------------------------------------------------
// The two PR #420 rulings (Sebastian, 2026-08-13). Both are DOC rulings over
// code that already behaves the ruled way, so nothing a stubbed run can reach
// proves them — the docs ARE the deliverable, and an un-pinned doc ruling is
// how the drift these tests fix got in. `recipeRow` slices the one table row so
// an assertion about repro-first can never be satisfied by adversarial's row
// (or by the prose below the table) the way a whole-file `assert.match` can.
// ---------------------------------------------------------------------------

const recipeRow = (source, label, id) => {
  const row = source
    .split("\n")
    .filter((line) => line.startsWith(`| \`${id}\``));
  assert.equal(
    row.length,
    1,
    `${label} must carry exactly one table row for \`${id}\` — found ${row.length}`
  );
  return row[0];
};

test("ruling 1 (PR #420): repro-first wins the risk:high + bug tiebreak", () => {
  const dispatch = read(".claude/skills/dispatch/SKILL.md");
  const recipes = read("ops/agent-os/recipes.md");

  // Each row assertion must fail on a row stating the OPPOSITE ruling, so every
  // one of them names the DIRECTION — a bare /risk:high/ is satisfied by "…
  // `risk:high` ones EXCLUDED", which is the ruling inverted.
  const reproRow = recipeRow(dispatch, "dispatch/SKILL.md", "repro-first");
  assert.match(
    reproRow,
    /`risk:high`[^|]{0,40}\bINCLUDED\b/i,
    "the selection row must say the bug default HOLDS for risk:high units — a reader who stops at the table is the reader this ruling is for"
  );
  assert.doesNotMatch(
    reproRow,
    /`risk:high`[^|]{0,40}\b(EXCLUDED|NOT INCLUDED)\b/i,
    "…and must not carve them back out in the same breath"
  );
  const adversaryRow = recipeRow(
    dispatch,
    "dispatch/SKILL.md",
    "adversarial-implement"
  );
  assert.match(
    adversaryRow,
    /not\s+(also\s+)?`bug`-labeled/i,
    "the risk:high default must state its exception — NEGATED, or the two rows both claim the same unit"
  );

  // The tiebreak itself, and the rationale it was ruled on.
  assert.match(
    dispatch,
    /\*\*`repro-first` wins\*\*/,
    "dispatch states the inverted tiebreak"
  );
  assert.doesNotMatch(
    dispatch,
    /\*\*`adversarial-implement` wins\*\*/,
    "the superseded tiebreak must be gone, not merely contradicted further down"
  );
  assert.match(
    dispatch,
    /HR4[^\n]*integration[\s\S]{0,240}?backstop/,
    "the row's rationale is the ruling's: HR4 backstops security at integration, enforced red→green has no backstop"
  );

  // recipes.md must AGREE — it is the contract dispatch's table points at.
  assert.match(
    recipes,
    /`repro-first` wins/,
    "recipes.md states the same tiebreak; a contract that disagrees with the selection table is the drift this ruling closed"
  );
  assert.match(
    recipeRow(recipes, "recipes.md", "repro-first"),
    /`risk:high`[^|]{0,40}\bincluded\b/i,
    "the recipe-library row says which units it takes, risk:high bugs INCLUDED — same direction as dispatch's row, not merely the same words"
  );
});

test("ruling 2 (PR #420): the never-red refusal is documented as attempt-1 only", () => {
  const dispatch = read(".claude/skills/dispatch/SKILL.md");
  const reproRow = recipeRow(dispatch, "dispatch/SKILL.md", "repro-first");

  assert.match(
    reproRow,
    /attempt 1/,
    "the refusal claim must be scoped to attempt 1 — stated unconditionally it contradicts `if (phaseOneFailure && !isRetry)` in recipes/repro-first.js"
  );
  assert.match(
    reproRow,
    /RETRY[\s\S]{0,200}?(warn|unconfirmed)/i,
    "…and must say what a retry does instead: warn, proceed, report the repro unconfirmed"
  );

  // The narrowing is the CODE's behaviour; pin the doc to it rather than to a
  // second description of it.
  assert.match(
    read(".claude/workflows/recipes/repro-first.js"),
    /if \(phaseOneFailure && !isRetry\) return refuse\(/,
    "the docs above describe this line — if it changes, they are wrong again"
  );

  assert.match(
    recipeRow(read("ops/agent-os/recipes.md"), "recipes.md", "repro-first"),
    /red on attempt 1/,
    "the recipe-library row carries the same scoping as the selection table"
  );
});

test("ruling 2 (PR #420): the recipe library credits repro-first to WS2", () => {
  const row = recipeRow(
    read("ops/agent-os/recipes.md"),
    "recipes.md",
    "repro-first"
  );
  assert.match(
    row,
    /landed \(#413 WS2\)/,
    "repro-first landed in #413 WS2; WS1 is adversarial-implement's"
  );
  assert.match(
    recipeRow(
      read("ops/agent-os/recipes.md"),
      "recipes.md",
      "adversarial-implement"
    ),
    /landed \(#413 WS1\)/,
    "…and adversarial-implement keeps WS1 — the fix must not swap the drift for its mirror image"
  );
});

// ---------------------------------------------------------------------------
// Twin blocks (#399): build-until-done.js and verify-and-ship.js each carry a
// copy of the shared guards (the two-table pattern, like dispatch /
// token-preflight). "Change one, change both" was prose until the review-fix
// loops quietly diverged — so the twins are machine-enforced now: every
// declared twin is fenced with `// TWIN:BEGIN <name>` / `// TWIN:END <name>`
// markers in BOTH files, and this test asserts the fenced copies are
// text-identical after (a) stripping comment lines, (b) normalizing the two
// blessed identifier renames the child uses to avoid shadowing its top-level
// `track`/`attempt` (trk→track, att→attempt), and (c) collapsing whitespace
// (prettier line-breaks differently around the longer names). Editing one
// copy without the other fails this test.
// ---------------------------------------------------------------------------
const TWIN_NAMES = [
  "QUALITY_ROUNDS",
  "FIX_SCHEMA",
  "BLOCK_SCHEMA",
  "LABEL_STATE_SCHEMA",
  "hashes",
  "treeLines",
  "findingsBlock",
  "labelViolations",
  "settleLabels",
  "review-fix-loop",
];

const twinBlock = (source, name, file) => {
  const begin = source.indexOf(`// TWIN:BEGIN ${name}\n`);
  const end = source.indexOf(`// TWIN:END ${name}`);
  assert.ok(
    begin !== -1 && end > begin,
    `${file} must fence its "${name}" twin with TWIN:BEGIN/TWIN:END markers`
  );
  return (
    source
      .slice(begin, end)
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
      })
      .join("\n")
      .replace(/\btrk\b/g, "track")
      .replace(/\batt\b/g, "attempt")
      .replace(/\s+/g, " ")
      // The rename above changes line lengths, so prettier breaks the two copies
      // differently — which adds/removes trailing commas along with the
      // whitespace. Both are formatting, not text.
      .replace(/,\s*([}\])])/g, " $1")
      .trim()
  );
};

test("every declared twin is text-identical across build-until-done and verify-and-ship", () => {
  const parent = read(".claude/workflows/build-until-done.js");
  const child = read(".claude/workflows/verify-and-ship.js");
  for (const name of TWIN_NAMES)
    assert.equal(
      twinBlock(parent, name, "build-until-done.js"),
      twinBlock(child, name, "verify-and-ship.js"),
      `twin "${name}" has forked between the two files — change one, change both`
    );
});

test("no prompt or doc READS the parent through REST", async () => {
  // `gh api repos/{owner}/{repo}/issues/<n> --jq .parent` returns null even when
  // a parent exists, and G0 treats a missing parent as a finding — so a false
  // null there fails a gate on a lie. The form may only appear as a warning.
  for (const file of [...new Set([...PARENT_DOC_FILES, ...WORKFLOW_FILES])]) {
    for (const line of read(file).split("\n")) {
      if (!/gh api[^\n]*issues\/[^\n]*parent/.test(line)) continue;
      assert.match(
        line,
        /do NOT|never|returns `null`|trap/i,
        `${file} reads the parent through REST: ${line.trim()}`
      );
    }
  }
});

test("the GraphQL parent idiom is recorded where agents will meet it", async () => {
  for (const file of PARENT_DOC_FILES)
    assert.match(
      read(file),
      /gh issue view [^\n]*--json parent/,
      `${file} must state the working idiom, not leave it to be re-derived`
    );
});

test("the format hook escapes the worktree ignore, and the walk still skips it", async () => {
  // `.prettierignore` applies to explicitly-named paths exactly as it does to
  // walked ones, so while the hook ran from the repo root this line made it
  // silently skip every file an agent wrote in a worktree — exit 0, no output,
  // no change — and CI became the only formatter check that could see them
  // (a CI fail on #302). The hook now resolves the NEAREST .prettierignore
  // walking up from the file, which inside a worktree is that worktree's own.
  const ignore = read(".prettierignore");
  assert.match(
    ignore,
    /^\.claude\/worktrees\/$/m,
    "dropping this makes `pnpm format:check` walk every sibling checkout"
  );

  const settings = JSON.parse(read(".claude/settings.json"));
  const hook = settings.hooks.PostToolUse.flatMap((m) => m.hooks).find((h) =>
    /prettier/.test(h.command)
  );
  assert.ok(hook, "the PostToolUse format hook must exist");
  assert.match(
    hook.command,
    /--ignore-path/,
    "without an explicit ignore path the hook resolves .prettierignore from the session cwd, which is the repo root"
  );
  assert.match(
    hook.command,
    /\.prettierignore/,
    "the ignore file it walks up to find is the worktree's own"
  );
  assert.match(
    hook.command,
    /while \[/,
    "nearest-ancestor resolution, so a main-checkout edit behaves exactly as before"
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
