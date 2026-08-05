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

/** Answers the claim step with `inProgressNow`, and fails any later gate fast. */
const replyWith = (inProgressNow, claimed) => (prompt, opts) => {
  if (opts.label?.startsWith("start:")) return { claimed, inProgressNow };
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
const replyShip = (verifyReport, labelImpl, prImpl) => (prompt, opts) => {
  const l = opts.label || "";
  if (l.startsWith("label:"))
    return (labelImpl || labelledOk)(prompt, opts, verifyReport);
  if (prImpl && l.startsWith("pr:")) return prImpl(prompt, opts);
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
