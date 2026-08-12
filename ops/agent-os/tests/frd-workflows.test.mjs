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
