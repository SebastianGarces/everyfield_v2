// Tests for the deterministic halves of the delivery workflows.
//
// `frd-plan.js`, `frd-implement.js` and `build-until-done.js` are Workflow
// scripts: the runtime evaluates each inside an async function with `args`,
// `agent`, `parallel`, `pipeline`, `phase`, `log` and `budget` injected as
// globals, which is why they use a top-level `return`. That shape means they
// cannot be imported — so these tests rebuild the wrapper and inject stubbed
// globals, exercising the scheduling, the guards and the prompt contracts
// without spending a single agent call.
//
// What a stubbed run can prove is the schedule, the guards and the text the
// prompts pin. Agent behaviour is not, and cannot be, tested here.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Resolved from this file, not the cwd — the test must not depend on where it is run from.
const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const load = (name) =>
  read(`.claude/workflows/${name}`).replace(
    /^export const meta/m,
    "const meta"
  );

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

const promptOf = (calls, phase) =>
  calls.find((c) => c.kind === "agent" && c.phase === phase)?.prompt;

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

test("high-risk units become prerequisites, and dependencies on them survive as edges", async () => {
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
    "the dependency on the prerequisite is kept, not dropped"
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
  // the frontier. Fail loudly at plan time rather than publish a deadlock.
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

  const prompt = promptOf(calls, "Publish");
  assert.ok(
    prompt.indexOf('"first"') < prompt.indexOf('"second"'),
    "the publish prompt lists blockers before what they block"
  );
});

test("a prerequisite publishes as buildable work, never as a human gate", async () => {
  // An agent rules for itself from the values and the invariants; needs-spec is
  // the last resort, not the default for a whole risk class.
  const { calls } = await runPlan(
    planWith(
      [unit("service")],
      [{ id: "schema", title: "SCHEMA", reason: "one db:generate may run" }]
    ),
    { frd: "f.md" },
    { parentIssue: 72, published: [], edges: [], notes: "" }
  );
  const prompt = promptOf(calls, "Publish");
  assert.match(prompt, /--label agent:queued --parent <parent>/);
  assert.doesNotMatch(
    prompt,
    /needs-spec/,
    "a prerequisite is a gate on the DoD, not a hold for a human"
  );
});

test("schema serializes as a prerequisite WITHOUT being labelled risk:high", async () => {
  // Pre-release there is no separate production database, so schema work is
  // ordered, not dangerous. risk:high is auth, tenancy and payments only.
  const { calls } = await runPlan(
    planWith(
      [unit("service")],
      [{ id: "schema", title: "SCHEMA", reason: "one db:generate may run" }]
    ),
    { frd: "f.md" },
    { parentIssue: 72, published: [], edges: [], notes: "" }
  );
  const prompt = promptOf(calls, "Publish");
  assert.doesNotMatch(
    prompt,
    /\[schema\] SCHEMA {2}← also --label risk:high/,
    "a schema prerequisite carries no automatic risk:high"
  );
  assert.match(prompt, /schema and migrations are ordered, not dangerous/);
});

test("an auth unit is the thing that still publishes risk:high", async () => {
  const { calls } = await runPlan(
    planWith([unit("auth-guard", { risk: "high", files: ["src/auth.ts"] })]),
    { frd: "f.md" },
    { parentIssue: 72, published: [], edges: [], notes: "" }
  );
  const prompt = promptOf(calls, "Publish");
  assert.match(prompt, /\[auth-guard\] AUTH-GUARD {2}← also --label risk:high/);
  assert.match(prompt, /risk=high — auth, tenancy or payments/);
});

test("the publish prompt keeps the structural headings frd-implement reads", async () => {
  const { calls } = await runPlan(
    planWith([unit("a", { files: ["src/shared.ts"] }), unit("b", { files: ["src/shared.ts"] })]), // prettier-ignore
    { frd: "f.md" },
    { parentIssue: 72, published: [], edges: [], notes: "" }
  );
  const prompt = promptOf(calls, "Publish");
  assert.match(prompt, /## Likely files/, "the DSU eats this section");
  assert.match(
    prompt,
    /## Workstreams/,
    "intra-track order travels in this one"
  );
  assert.match(
    prompt,
    /gh issue list --state all --search "<title> in:title"/,
    "re-running must reuse issues, not duplicate the board"
  );
});

test("each workstream block carries its OWN files, order and criteria", async () => {
  // The script computes the intra-track order; if the prompt does not render it
  // per unit, build-until-done reads a track it cannot stage.
  const { calls } = await runPlan(
    planWith([
      unit("barrel", { files: ["src/shared.ts", "src/barrel.ts"] }),
      unit("consumer", { files: ["src/shared.ts"], dependsOn: ["barrel"] }),
    ]),
    { frd: "f.md" },
    { parentIssue: 72, published: [], edges: [], notes: "" }
  );
  const prompt = promptOf(calls, "Publish");
  assert.match(
    prompt,
    /files: src\/shared\.ts, src\/barrel\.ts/,
    "a unit's own file list must appear under its own workstream block"
  );
  assert.match(
    prompt,
    /depends on: barrel/,
    "intra-track ordering is what the board carries to the builder"
  );
  assert.match(prompt, /ACs: consumer works/);
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

const runImplement = (board, argv = {}, over = {}) =>
  runWorkflow(load("frd-implement.js"), {
    args: argv,
    agentImpl: (_p, opts) => {
      if (over[opts.phase]) return over[opts.phase](opts);
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
        return {
          verdict: "PASS",
          critical: [],
          warnings: [],
          summary: "",
          updated: [{ issue: 104, label: "agent:in-progress" }],
        };
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
  const prompt = promptOf(calls, "Frontier");
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

// The frontier query reads the whole board in one call. Each assertion below
// guards a failure mode of the alternatives, not a style preference.
test("the frontier query reads the whole board in one unpaged-safe call", async () => {
  const { calls } = await runImplement({
    frontier: [frontierUnit("solo")],
    blocked: [],
    notes: "",
  });
  const prompt = promptOf(calls, "Frontier");

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
  assert.match(promptOf(calls, "Frontier"), /11, 22/);
});

test("the reviewer settles the board it just reviewed — no separate settle pass", async () => {
  const { result, calls } = await runImplement({
    frontier: [frontierUnit("solo")],
    blocked: [],
    notes: "",
  });
  assert.ok(
    !calls.some((c) => c.kind === "agent" && c.phase === "Settle"),
    "a passing run costs one pass per track, not two"
  );
  const review = calls.find((c) => c.kind === "agent" && c.phase === "Review");
  assert.match(review.prompt, /this is the ONE review this branch gets/);
  assert.match(
    review.prompt,
    /no DoD, no PR, so no `agent:in-review`/,
    "this workflow opens no PR, so it cannot claim review-readiness"
  );
  assert.match(review.prompt, /Passing tracks stay `agent:in-progress`/);
  assert.match(review.prompt, /swap `agent:in-progress` for `agent:blocked`, unassign/); // prettier-ignore
  assert.ok(
    result.boardUpdates.length,
    "the reviewer's own label writes are the run's board updates"
  );
});

test("a track that produced nothing still gets its issues settled", async () => {
  const { calls } = await runImplement(
    { frontier: [frontierUnit("solo")], blocked: [], notes: "" },
    {},
    { Implement: () => null }
  );
  const settle = calls.find((c) => c.kind === "agent" && c.phase === "Settle");
  assert.ok(
    settle,
    "no reviewer ran, so nothing else would move the issue off agent:in-progress"
  );
  assert.match(settle.prompt, /swap `agent:in-progress` for `agent:blocked`, unassign/); // prettier-ignore
  assert.match(settle.prompt, /ops\/agent-os\/labels\.md/);
  assert.match(settle.prompt, /no branch was produced/);
});

test("a reviewer that dies leaves a failed track, not a reviewed one", async () => {
  // The silent stop this guards: the branch exists, nobody reviewed it, and the
  // issues stay agent:in-progress and assigned — wedging every later pass.
  const { result, calls } = await runImplement(
    { frontier: [frontierUnit("solo")], blocked: [], notes: "" },
    {},
    { Review: () => null }
  );
  assert.equal(
    result.branches.length,
    0,
    "an unreviewed track has not landed, whatever it committed"
  );
  const settle = calls.find((c) => c.kind === "agent" && c.phase === "Settle");
  assert.ok(settle, "the fallback must cover a dead reviewer, not just a dead builder"); // prettier-ignore
  assert.match(
    settle.prompt,
    /branch `feature\/solo` exists, but no review landed/,
    "the branch is named so the committed work is not lost or rebuilt"
  );
});

// ---------------------------------------------------------------------------
// build-until-done — the harness
//
// One file, seven steps, at most one agent each: setup, implement, integrate,
// review, fix, ship, exit. Every stub below answers a step by its agent label.
// ---------------------------------------------------------------------------

async function runBuild(units, reply, over = {}) {
  const { budgetImpl, ...argOver } = over;
  const source = load("build-until-done.js");
  const calls = [];
  const globals = {
    args: { units, base: "main", ...argOver },
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
        model: opts.model,
        agentType: opts.agentType,
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

const buildUnit = (id, issue, over = {}) => ({
  id,
  title: id.toUpperCase(),
  lane: "backend",
  risk: "low",
  issue,
  files: [`src/${id}.ts`],
  summary: `summary for ${id}`,
  acceptanceCriteria: [`${id} works`],
  ...over,
});

const BASE_SHA = "700c33300000000000000000000000000000cafe";
const HEAD_SHA = "f604b2b00000000000000000000000000000beef";
const COMMIT = "c0ffee00000000000000000000000000000000aa";
const PR_URL = "https://gh/pr/1";
const CRASH =
  "ReferenceError: ChurchBasicsFieldErrors is not defined\n    at eval (src/app/onboarding/church-basics.tsx:1:1)";

const agents = (calls, prefix) =>
  calls.filter((c) => c.kind === "agent" && c.label?.startsWith(prefix));
const one = (calls, prefix) => agents(calls, prefix)[0];

/** The issues a setup step was told to claim, read out of its own prompt. */
const claimedIn = (p) =>
  (p.match(/and no others: ([^\n]*)/)?.[1] || "")
    .split(",")
    .map((n) => Number(n.trim()))
    .filter(Boolean);
/** The issue numbers a ship/exit step was addressed about. */
const issuesIn = (p) =>
  [
    ...(p.match(/issue\(s\) ((?:#\d+(?:, )?)+)/)?.[1] || "").matchAll(/\d+/g),
  ].map((m) => Number(m[0]));
/** The workstream branches an integrate step was told to merge. */
const branchesIn = (p) =>
  [...p.matchAll(/^ {2}- (feature\/\S+)$/gm)].map((m) => m[1]);
const findingCount = (p) => (p.match(/--- finding \d+ \[/g) || []).length;

const review = (over = {}) => ({
  verdict: "PASS",
  headSha: HEAD_SHA,
  remoteSha: HEAD_SHA,
  acceptanceCriteria: [],
  warnings: [],
  findings: [],
  summary: "reads clean",
  ...over,
});
const finding = (severity, summary) => ({
  severity,
  summary,
  detail: `${summary} — exact lines`,
  files: ["src/alpha.ts"],
  remedy: `${summary} gone`,
});
const warn = (kind, summary) => ({
  kind,
  summary,
  detail: `${summary} detail`,
});

/**
 * The honest answer to every step: each stub transcribes what its own prompt
 * asked for, so a prompt that stops asking is a failing test, not a silent pass.
 */
const DEFAULTS = {
  "setup:": (p) => ({
    claimed: claimedIn(p),
    ready: true,
    branch: p.match(/-b (\S+)/)?.[1] || "feature/x",
    resumed: false,
    // A freshly cut branch IS its base commit — the check that anchors
    // "cut from the remote tip".
    headSha: BASE_SHA,
    baseSha: BASE_SHA,
  }),
  "impl:": () => ({
    committed: true,
    filesChanged: [],
    summary: "built it",
    commits: [COMMIT],
  }),
  "integrate:": (p) => ({ merged: branchesIn(p), conflicts: [] }),
  "review:": () => review(),
  "fix:": (p) => ({
    committed: true,
    filesChanged: [],
    summary: "fixed it",
    perFinding: Array.from({ length: findingCount(p) }, (_, i) => ({
      finding: `finding ${i + 1}`,
      fixed: true,
      addressed: "fixed and proven",
    })),
    rootCause: "the named cause",
    rootCauseAddressed: "gone, with the output that proves it",
  }),
  "ship:": (p) => ({
    headSha: HEAD_SHA,
    remoteSha: HEAD_SHA,
    works: { status: "PASS", evidence: "asserted every criterion" },
    opened: true,
    url: PR_URL,
    checkConclusion: "success",
    labels: issuesIn(p).map((issue) => ({
      issue,
      labels: ["agent:in-review"],
    })),
    mergeState: /gh pr merge <number> --squash/.test(p)
      ? "merged"
      : p.match(/mergeState: "([a-z-]+)"/)?.[1] || "not-attempted",
  }),
  "exit:": (p) => ({
    commented: true,
    observed: issuesIn(p).map((issue) => ({
      issue,
      labels: [p.match(/--add-label (agent:[\w-]+)/)?.[1] || "agent:blocked"],
    })),
  }),
};

/** `stub({"review:": () => ...})` replaces one step's answer, keeping the rest. */
const stub = (over = {}) => {
  const table = { ...DEFAULTS, ...over };
  return (prompt, opts) => {
    const l = opts.label || "";
    for (const [prefix, value] of Object.entries(table))
      if (l.startsWith(prefix))
        return typeof value === "function" ? value(prompt, opts) : value;
    return {};
  };
};

// ---------------------------------------------------------------------------
// build-until-done: the schedule
// ---------------------------------------------------------------------------

test("a single-unit track runs one agent in the track worktree, with nothing to integrate", async () => {
  const { result, calls } = await runBuild([buildUnit("alpha", 101)], stub());
  assert.deepEqual(
    agents(calls, "").map((c) => c.label),
    ["setup:alpha", "impl:alpha-s0w1", "review:alpha#1", "ship:alpha#1"],
    "the happy path is four passes"
  );
  assert.match(
    one(calls, "impl:").prompt,
    /Work in the existing worktree/,
    "a solo workstream uses the track worktree rather than cutting its own"
  );
  assert.equal(result.shipped.length, 1);
  assert.equal(result.shipped[0].pr, PR_URL);
});

test("dependsOn splits one track into a prerequisite stage and a parallel fan-out", async () => {
  const { calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
      { ...buildUnit("api", 103), dependsOn: ["schema"] },
    ],
    stub()
  );
  assert.equal(
    agents(calls, "setup:").length,
    1,
    "units joined by dependsOn belong to one track, one branch, one PR"
  );
  const impls = agents(calls, "impl:").map((c) => c.label);
  assert.deepEqual(impls, [
    "impl:schema-s0w1",
    "impl:schema-s1w1",
    "impl:schema-s1w2",
  ]);

  for (const c of agents(calls, "impl:").slice(1)) {
    assert.match(
      c.prompt,
      /git worktree add -b feature\/schema-s1w\d \.claude\/worktrees\/bud-schema-s1w\d feature\/schema\b/,
      "a fan-out workstream branches from the TRACK branch, so it carries the prerequisite's commits"
    );
    assert.match(c.prompt, /from the TRACK branch, never from origin\/main/);
  }
  assert.ok(
    one(calls, "integrate:").label === "integrate:schema#s1",
    "parallel branches are merged back before the track ships"
  );
});

test("a stage's file-sharing units collapse into one agent; disjoint ones are separate tracks", async () => {
  const shared = "src/db/schema/index.ts";
  const { calls } = await runBuild(
    [
      { ...buildUnit("a", 101), files: [shared] },
      { ...buildUnit("b", 102), files: [shared] },
      { ...buildUnit("c", 103), files: ["src/c.ts"] },
    ],
    stub()
  );
  assert.equal(agents(calls, "setup:").length, 2, "c is its own track");
  const impls = agents(calls, "impl:");
  assert.equal(
    impls.length,
    2,
    "one agent for the shared-file pair, one for c — never two agents on one file"
  );
  assert.match(
    impls.find((c) => c.label.startsWith("impl:a")).prompt,
    /### Unit 2:/,
    "the pair is built in one worktree, in order"
  );
});

test("a dependsOn cycle inside a track is refused at plan time", async () => {
  await assert.rejects(
    () =>
      runBuild(
        [
          { ...buildUnit("a", 101), dependsOn: ["b"] },
          { ...buildUnit("b", 102), dependsOn: ["a"] },
        ],
        stub()
      ),
    /cycle/i,
    "a cycle can never reach a stage — failing loudly beats hanging"
  );
});

test("a workstream that dies fails its track instead of vanishing from it", async () => {
  const { result, calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
      { ...buildUnit("api", 103), dependsOn: ["schema"] },
    ],
    (prompt, opts) => {
      if (opts.label === "impl:schema-s1w2") throw new Error("this agent died");
      return stub()(prompt, opts);
    }
  );
  assert.equal(result.shipped.length, 0, "a track with a hole has not shipped");
  assert.equal(result.blocked.length, 1);
  assert.ok(
    !calls.some((c) => c.label?.startsWith("ship:")),
    "a PR must never be opened for a track whose stage did not complete"
  );
});

test("the agent cap chunks the tracks: a cap of one serializes them", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101), buildUnit("beta", 202)],
    stub(),
    { maxConcurrentAgents: 1 }
  );
  const labels = calls.filter((c) => c.kind === "agent").map((c) => c.label);
  assert.ok(
    labels.indexOf("ship:alpha#1") < labels.indexOf("setup:beta"),
    "the concurrency ceiling is what keeps a wide wave from freezing the machine"
  );
});

test("the cap counts AGENTS, so a wide track shrinks how many tracks run at once", async () => {
  // Applied per level, the real ceiling would be the cap squared. A track whose
  // widest stage is 3 may only run one-at-a-time under a cap of 4.
  const wide = (name, base) => [
    buildUnit(name, base),
    { ...buildUnit(`${name}-a`, base + 1), dependsOn: [name] },
    { ...buildUnit(`${name}-b`, base + 2), dependsOn: [name] },
    { ...buildUnit(`${name}-c`, base + 3), dependsOn: [name] },
  ];
  const { calls } = await runBuild(
    [...wide("alpha", 100), ...wide("beta", 200)],
    stub(),
    { maxConcurrentAgents: 4 }
  );
  const labels = calls.filter((c) => c.kind === "agent").map((c) => c.label);
  assert.ok(
    labels.indexOf("ship:alpha#1") < labels.indexOf("setup:beta"),
    "4 agents ÷ a 3-wide stage = one track at a time"
  );
});

test("the fan-in guard reports a track that returned no verdict — and still settles it", async () => {
  // A track whose buildTrack threw comes back as a hole. A filtered-out hole is
  // a unit nobody built and nobody was told about.
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "setup:": () => {
        throw new Error("the runtime died under this track");
      },
    })
  );
  assert.ok(!calls.some((c) => c.label?.startsWith("impl:")));
  assert.equal(result.lost.length, 1);
  assert.equal(result.lost[0].track, "alpha");
  assert.match(result.summary, /lost without a verdict/);
  const exit = one(calls, "exit:");
  assert.ok(exit, "a hole still owes every issue a comment and a label");
  assert.match(exit.prompt, /--add-label agent:blocked --remove-label agent:in-progress/); // prettier-ignore
});

// ---------------------------------------------------------------------------
// build-until-done: setup — the claim's blast radius and the base
// ---------------------------------------------------------------------------

test("the claim names an exact issue list and forbids enumerating the label", async () => {
  const { calls } = await runBuild([buildUnit("alpha", 101)], stub());
  const setup = one(calls, "setup:");
  assert.match(setup.prompt, /EXACTLY these issues and no others: 101/);
  assert.match(
    setup.prompt,
    /Do NOT run `gh issue list`/,
    "a sweep happens when an agent enumerates the label to decide what to edit"
  );
  assert.match(
    setup.prompt,
    /must be exactly 1/,
    "stating the expected count gives the agent a self-check"
  );
  assert.match(setup.prompt, /scripts\/worktree-env\.sh/);
  assert.equal(setup.model, "haiku", "claiming and cutting is cheap work");
});

test("a claim that swept issues the pass does not own aborts before building", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101), buildUnit("beta", 202)],
    // The real failure: the claim step returns the whole board, not just #101.
    stub({
      "setup:": (p) => ({
        ...DEFAULTS["setup:"](p),
        claimed: [...claimedIn(p), 15, 16, 62],
      }),
    })
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("impl:")),
    "building against a corrupted board is the thing the guard exists to prevent"
  );
  assert.equal(result.shipped.length, 0);
  assert.equal(
    result.blocked.length,
    2,
    "a swept claim is answered, not thrown — the claim it just wrote is real"
  );
  assert.equal(result.lost.length, 0);
  assert.match(result.blocked[0].reason, /belong to no one here/);
});

test("a claim confined to the pass's own issues proceeds to implement", async () => {
  const { calls } = await runBuild([buildUnit("alpha", 101)], stub());
  assert.ok(
    calls.some((c) => c.label?.startsWith("impl:")),
    "the guard must not false-positive on issues the pass legitimately owns"
  );
});

test("the track branch is fetched and cut from origin/main, not the local ref", async () => {
  const { calls } = await runBuild([buildUnit("alpha", 101)], stub());
  const prompt = one(calls, "setup:").prompt;
  assert.match(
    prompt,
    /git fetch origin/,
    "an unfetched remote-tracking ref is a stale local ref with a longer name"
  );
  assert.match(prompt, /git worktree add -b \S+ \S+ origin\/main\b/);
  assert.doesNotMatch(
    prompt,
    /git worktree add -b \S+ \S+ main\b/,
    "a local `main` is whatever this checkout last fetched"
  );
});

test("a bare base is normalised onto the remote; an explicit sha is not", async () => {
  const sha = "14c5d33abc0000000000000000000000000000ff";
  const pinned = await runBuild([buildUnit("alpha", 101)], stub(), {
    base: sha,
  });
  assert.match(
    one(pinned.calls, "setup:").prompt,
    new RegExp(`git worktree add -b \\S+ \\S+ ${sha}`),
    "a deliberate pin must survive normalisation"
  );
});

test("a track cut from a stale base is blocked before a workstream runs", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "setup:": (p) => ({
        ...DEFAULTS["setup:"](p),
        headSha: "14c5d33abc0000000000000000000000000000ff",
      }),
    })
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

test("a preserved branch is updated from origin/main and passes on ancestry", async () => {
  // A resumed branch carries its own commits, so its HEAD can never equal
  // origin/main once main moves. Ancestry is the same invariant for that shape.
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "setup:": (p) => ({
        ...DEFAULTS["setup:"](p),
        resumed: true,
        headSha: "abc1234000000000000000000000000000000dad",
        baseIsAncestor: true,
      }),
    })
  );
  const prompt = one(calls, "setup:").prompt;
  assert.match(prompt, /git rev-parse --verify --quiet refs\/heads\//);
  assert.match(
    prompt,
    /git -C \S+ merge --no-edit origin\/main/,
    "a branch holding preserved work is brought up to date, never re-cut"
  );
  assert.match(prompt, /merge-base --is-ancestor origin\/main HEAD/);
  assert.equal(result.blocked.length, 0);
  assert.equal(result.shipped.length, 1);
});

test("a resumed branch that did not take main's commits is still refused", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "setup:": (p) => ({
        ...DEFAULTS["setup:"](p),
        resumed: true,
        headSha: "abc1234000000000000000000000000000000dad",
        baseIsAncestor: false,
      }),
    })
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("impl:")),
    "loosening the check for resumes must not loosen the invariant"
  );
  assert.match(result.blocked[0].reason, /is NOT an ancestor/);
  assert.match(
    result.blocked[0].reason,
    /do not delete the branch or the worktree/i,
    "a refusal must not cost the human the preserved work"
  );
});

test("a conflicting update stops the track without destroying the branch", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "setup:": (p) => ({
        ...DEFAULTS["setup:"](p),
        ready: false,
        resumed: true,
        conflicted: true,
        conflictedFiles: ["src/alpha.ts", "src/db/schema.ts"],
      }),
    })
  );
  assert.ok(!calls.some((c) => c.label?.startsWith("impl:")));
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
});

// ---------------------------------------------------------------------------
// build-until-done: ONE review, at most ONE fix round
// ---------------------------------------------------------------------------

test("the branch is published and the shas asserted inside the review pass", async () => {
  const { calls } = await runBuild([buildUnit("alpha", 101)], stub());
  const r = one(calls, "review:");
  assert.match(r.prompt, /git -C \S+ push -u origin \S+/);
  assert.match(
    r.prompt,
    /rev-parse origin\/\S+/,
    "the assertion is a sha comparison, not a successful push"
  );
  assert.match(r.prompt, /failingGate `publish`/);
  assert.equal(r.agentType, "code-reviewer");
});

test("a branch the remote does not have is republished instead of shipped", async () => {
  let seen = 0;
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "review:": () =>
        ++seen === 1
          ? review({ remoteSha: "a4c5ede00000000000000000000000000000beef" })
          : review(),
    })
  );
  assert.deepEqual(
    agents(calls, "review:").map((c) => c.label),
    ["review:alpha#1", "review:alpha#2"],
    "validating a sha the remote lacks teaches the loop something false"
  );
  assert.equal(agents(calls, "ship:").length, 1);
  assert.equal(result.shipped.length, 1);
});

test("the one review holds every axis, and leaves the browser to ship", async () => {
  const { calls } = await runBuild([buildUnit("alpha", 101)], stub());
  const prompt = one(calls, "review:").prompt;
  assert.match(prompt, /this is the ONE review/);
  assert.match(
    prompt,
    /memory\/invariants\/\*\.md/,
    "conventions are hard rules"
  );
  assert.match(prompt, /security lens/i, "high-risk diffs get it here, not in a lens pass"); // prettier-ignore
  assert.match(
    prompt,
    /Do NOT drive a browser/,
    "the one browser look happens last, at the final sha"
  );
  assert.match(prompt, /product-docs\/product-values\.md/);
  assert.match(prompt, /CONTEXT\.md/);
  assert.match(
    prompt,
    /consulate/,
    "a hard call convenes perspectives, not a human"
  );
  assert.match(prompt, /Default to FAIL when evidence is missing/);
});

test("actionable findings get exactly one fix round and no re-review", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "review:": () =>
        review({ findings: [finding("critical", "tenant scope missing")] }),
    }),
    { autoMerge: true }
  );
  const fixes = agents(calls, "fix:");
  assert.equal(fixes.length, 1, "one round, hardcoded — there is no second");
  assert.ok(
    fixes[0].prompt.includes("tenant scope missing"),
    "the finding is quoted verbatim, not paraphrased"
  );
  assert.match(fixes[0].prompt, /there is no second round and no re-review/);
  assert.match(fixes[0].prompt, /Fill `perFinding` for every item above, in order/); // prettier-ignore
  assert.equal(
    agents(calls, "review:").length,
    1,
    "a PR gets exactly one review — the fix answers a stated remedy instead"
  );
  assert.equal(result.shipped.length, 1);
  assert.equal(result.shipped[0].merge, "merged");
});

test("suggestions never gate and never trigger a fix round", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "review:": () =>
        review({ findings: [finding("suggestion", "could rename this")] }),
    }),
    { autoMerge: true }
  );
  assert.equal(agents(calls, "fix:").length, 0);
  assert.match(one(calls, "ship:").prompt, /gh pr merge <number> --squash/);
});

test("an unanswered finding holds the merge and reaches the PR as a decision", async () => {
  const stubborn = finding("structural", "spaghetti mode bolted into checkout");
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "review:": () => review({ findings: [stubborn] }),
      // A fix that answers nothing: the finding stands.
      "fix:": () => ({
        committed: false,
        filesChanged: [],
        summary: "did some things",
        perFinding: [],
      }),
    }),
    { autoMerge: true }
  );
  const ship = one(calls, "ship:").prompt;
  assert.ok(
    !/gh pr merge <number> --squash/.test(ship),
    "never merge-with-findings"
  );
  assert.match(ship, /unresolved review finding/);
  assert.match(ship, /merge as-is, ruling the finding accepted/);
  assert.match(ship, /direct a named fix/);
  assert.ok(
    ship.includes("spaghetti mode bolted into checkout"),
    "the finding reaches the DECISION verbatim"
  );
  assert.deepEqual(result.shipped[0].unresolvedFindings, [
    "spaghetti mode bolted into checkout",
  ]);
  assert.equal(result.blocked.length, 0, "a decision is not a block");
});

test("a finding the fixer DECLINES stays unresolved and reaches the PR", async () => {
  // The fail-closed half of perFinding: a row that answers at length but sets
  // `fixed: false` is a refusal, and a refusal is exactly what must be decided
  // by a human rather than merged.
  const declined = finding("critical", "no tenant scope on the new query");
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "review:": () => review({ findings: [declined] }),
      "fix:": () => ({
        committed: true,
        filesChanged: [],
        summary: "considered it",
        perFinding: [
          {
            finding: "no tenant scope",
            fixed: false,
            addressed: "not addressed — I judged it out of scope",
          },
        ],
      }),
    }),
    { autoMerge: true }
  );
  const ship = one(calls, "ship:").prompt;
  assert.ok(!/gh pr merge/.test(ship), "a declined critical finding cannot merge itself away"); // prettier-ignore
  assert.ok(ship.includes("no tenant scope on the new query"));
  assert.deepEqual(result.shipped[0].unresolvedFindings, [
    "no tenant scope on the new query",
  ]);
});

test("a review FAIL hands the fixer the findings, not just the failing gate", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "review:": () =>
        review({
          verdict: "FAIL",
          failingGate: "correctness",
          summary: CRASH,
          findings: [finding("critical", "the null row is never handled")],
        }),
    })
  );
  const fix = one(calls, "fix:").prompt;
  assert.ok(fix.includes(CRASH), "the named cause still travels verbatim");
  assert.ok(
    fix.includes("the null row is never handled"),
    "each finding carries its own remedy — dropping them re-derives the review"
  );
  assert.ok(fix.includes('What "fixed" looks like'));
});

test("a review FAIL spends an attempt, is fixed once, and blocks on exhaustion", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "review:": () =>
        review({ verdict: "FAIL", failingGate: "correctness", summary: CRASH }),
    })
  );
  assert.deepEqual(
    calls.filter((c) => c.kind === "agent").map((c) => c.label),
    [
      "setup:alpha",
      "impl:alpha-s0w1",
      "review:alpha#1",
      "fix:alpha#1",
      "review:alpha#2",
      "exit:alpha",
    ],
    "two attempts, one fix round, then a loud exit"
  );
  const fix = one(calls, "fix:").prompt;
  assert.match(fix, /THE CAUSE IS BELOW, IN ITS OWN WORDS/);
  assert.ok(
    fix.includes(CRASH),
    "the named error is the whole diagnosis — a summary of it sends the fixer hunting"
  );
  assert.match(fix, /`rootCauseAddressed`/);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].failingGate, "correctness");
});

// ---------------------------------------------------------------------------
// build-until-done: ship — WORKS, the PR, the CI anchor, the labels
// ---------------------------------------------------------------------------

test("the ship pass proves a UI change on the preview, once, at the final sha", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101, { lane: "frontend" })],
    stub()
  );
  const prompt = one(calls, "ship:").prompt;
  assert.match(prompt, /\.claude\/skills\/validate\/SKILL\.md/);
  assert.match(
    prompt,
    /scripts\/preview-url\.sh feature\/alpha --wait --bypass/,
    "unnamed, it resolves whatever HEAD the agent's shell is on"
  );
  assert.match(
    prompt,
    /never localhost:3000/,
    "localhost serves main and would pass code this track never wrote"
  );
  assert.match(prompt, /lighthouse a11y audit — below 90 is a FAIL/);
  assert.match(prompt, /Tear the browser down/);
});

test("the ship pass proves a backend change with one real request", async () => {
  const prompt = one(
    (await runBuild([buildUnit("alpha", 101)], stub())).calls,
    "ship:"
  ).prompt;
  assert.match(prompt, /Make ONE real request/);
  assert.match(prompt, /rolls back on a scratch DB/, "the high-risk rider");
});

test("the PR body carries the evidence, the Manual QA and the Closes edges", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101), buildUnit("beta", 102, { files: ["src/alpha.ts"] })], // prettier-ignore
    stub()
  );
  const prompt = one(calls, "ship:").prompt;
  assert.match(prompt, /## 👀 Manual QA/);
  assert.match(prompt, /WHAT THE AUTOMATION COULD NOT JUDGE/);
  assert.match(
    prompt,
    /Do NOT restate the acceptance criteria/,
    "human attention is the scarcest thing here"
  );
  assert.match(prompt, /Closes #101, Closes #102/);
  assert.match(
    prompt,
    /\.claude\/skills\/open-pr\/SKILL\.md/,
    "the body template and the label discipline have one home, and the shipper must reach it"
  );
  assert.match(prompt, /gh pr checks <number> --watch --fail-fast/);
  assert.match(
    prompt,
    /"Format, Lint, Typecheck, Build"/,
    "CI green is the merge contract, and this is the check that says so"
  );
});

// PR #439 shipped labelled risk:high off a declared-medium track: the body owed a
// schema diff, the template gated that section on "high-risk only", and the shipper
// raised the tier to make its own body legal. The tier is the input, never the
// output — nothing the body has to carry may reach back and change it.
test("the PR template keys the schema diff to the migration, not to the risk tier", () => {
  const skill = read(".claude/skills/open-pr/SKILL.md");
  const summary = skill.match(/<summary>Schema diff \(([^)]*)\)<\/summary>/);
  assert.ok(summary, "the template still has a schema-diff section");
  assert.doesNotMatch(
    summary[1],
    /high[- ]risk/i,
    "a migration is owed at any tier — gating the section on risk:high invites the shipper to raise the tier"
  );
  assert.match(summary[1], /migration/i, "and it says what does owe it");
  assert.match(
    skill,
    /A migration never sets it/,
    "HIGH_RISK is auth/tenancy/payments, and the skill has to say so where the flag is set"
  );
});

test("a red check fails the attempt, runs one fix, and re-runs ONLY the ship step", async () => {
  let ships = 0;
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "ship:": (p) => ({
        ...DEFAULTS["ship:"](p),
        ...(++ships === 1
          ? {
              checkConclusion: "failure",
              checkSummary: "typecheck: " + CRASH,
            }
          : {}),
      }),
    })
  );
  assert.equal(
    agents(calls, "review:").length,
    1,
    "a PR gets one review; a red check needs a fix and another ship"
  );
  assert.deepEqual(
    agents(calls, "ship:").map((c) => c.label),
    ["ship:alpha#1", "ship:alpha#2"]
  );
  const fix = one(calls, "fix:");
  assert.ok(fix.prompt.includes(CRASH), "the failing step travels verbatim");
  assert.equal(result.shipped.length, 1);
});

test("a WORKS failure that survives both attempts blocks with its evidence", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      // A ship pass that obeyed the abort: no PR, no labels, no merge.
      "ship:": (p) => ({
        ...DEFAULTS["ship:"](p),
        works: { status: "FAIL", evidence: CRASH },
        opened: false,
        url: "",
        checkConclusion: "none",
        labels: [],
        mergeState: "not-attempted",
      }),
    }),
    { autoMerge: true }
  );
  assert.equal(result.shipped.length, 0);
  assert.equal(result.deliveryFailed.length, 0, "WORKS is a gate, not a delivery step"); // prettier-ignore
  assert.equal(result.blocked[0].failingGate, "WORKS");
  assert.ok(
    one(calls, "exit:").prompt.includes(CRASH),
    "the evidence goes to the human verbatim, as it does to a fixer"
  );
});

test("the ship pass is told to STOP before the PR when WORKS fails", async () => {
  // Without the abort the agent opens the PR, flips the labels and (under
  // autoMerge) squashes a branch that does not work onto main — and only THEN
  // does the loop read works.status.
  const { calls } = await runBuild([buildUnit("alpha", 101)], stub(), {
    autoMerge: true,
  });
  const prompt = one(calls, "ship:").prompt;
  assert.match(prompt, /\*\*If WORKS is FAIL, STOP HERE\.\*\*/);
  assert.match(
    prompt,
    /do NOT open a PR, edit labels or merge/,
    "the loop decides the retry; the ship agent must not deliver a broken branch first"
  );
  assert.ok(
    prompt.indexOf("If WORKS is FAIL, STOP HERE") <
      prompt.indexOf("3. **PR.**"),
    "the abort has to come before the step it aborts"
  );
});

test("the labels are written and READ BACK inside ship, once", async () => {
  const { result, calls } = await runBuild([buildUnit("alpha", 101)], stub());
  const prompt = one(calls, "ship:").prompt;
  assert.match(prompt, /gh issue edit n --add-label agent:in-review --remove-label agent:in-progress/); // prettier-ignore
  assert.match(prompt, /gh pr edit <number> --add-label agent:in-review/);
  assert.match(
    prompt,
    /gh issue view n --json labels --jq '\[\.labels\[\]\.name\]'/,
    "`gh issue edit` exiting 0 is not evidence; the read-back is"
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("label:")),
    "the read-back rides in the ship pass — it is not an agent of its own"
  );
  assert.equal(result.shipped.length, 1);
});

test("a track whose issue does not read agent:in-review is errored, not shipped", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      // The silent no-op shape: every command "succeeds", the label never moves.
      "ship:": (p) => ({
        ...DEFAULTS["ship:"](p),
        labels: [{ issue: 101, labels: ["agent:in-progress"] }],
      }),
    })
  );
  assert.equal(
    agents(calls, "ship:").length,
    1,
    "one read-back, no retry loop"
  );
  assert.equal(result.shipped.length, 0);
  assert.equal(result.errored.length, 1);
  assert.deepEqual(result.errored[0].unlabelledIssues, [101]);
  assert.ok(
    result.errored[0].observedLabels.some((o) =>
      o.labels.includes("agent:in-progress")
    ),
    "the observed board state is carried into the report, not summarised away"
  );
  assert.match(result.nextStep, /before trusting the board/);
  // A `log()` alone leaves the issue reading agent:in-progress, which halts the
  // next unattended pass. Every non-shipped outcome takes the exit.
  const exit = one(calls, "exit:");
  assert.ok(exit, "an unconfirmed label still owes the issue a comment");
  assert.match(exit.prompt, /--add-label agent:in-review --remove-label agent:in-progress/); // prettier-ignore
  assert.match(exit.prompt, /nothing needs rebuilding or re-reviewing/);
});

// ---------------------------------------------------------------------------
// build-until-done: the auto-merge gate — four holds, plus CI green
// ---------------------------------------------------------------------------

test("a clean pass auto-merges and cleans up its own worktree", async () => {
  const { result, calls } = await runBuild([buildUnit("alpha", 101)], stub(), {
    autoMerge: true,
  });
  const prompt = one(calls, "ship:").prompt;
  assert.match(prompt, /gh pr merge <number> --squash --delete-branch --auto/);
  assert.match(prompt, /git worktree remove <path> --force/);
  assert.equal(result.shipped[0].merge, "merged");
  assert.deepEqual(
    result.shipped[0].survivingWorktrees,
    [],
    "a merged track leaves none"
  );
});

test("auto-merge is off by default, so a direct call cannot merge to main", async () => {
  const { result, calls } = await runBuild([buildUnit("alpha", 101)], stub());
  assert.ok(
    !/gh pr merge/.test(one(calls, "ship:").prompt),
    "opting in must be explicit — /deliver must not merge by surprise"
  );
  assert.equal(result.shipped[0].merge, "not-attempted");
});

test("risk:high never auto-merges, even on a spotless pass", async () => {
  const { calls } = await runBuild(
    [buildUnit("alpha", 101, { risk: "high" })],
    stub(),
    { autoMerge: true }
  );
  const prompt = one(calls, "ship:").prompt;
  assert.ok(!/gh pr merge/.test(prompt), "schema/auth/tenancy is where a bad merge is unrecoverable"); // prettier-ignore
  assert.match(prompt, /risk:high — never auto-merges/);
  assert.match(prompt, /--label risk:high/, "the PR carries the label too");
});

test("a unit's hold flag holds its whole track, and only that track", async () => {
  const { result, calls } = await runBuild(
    [
      { ...buildUnit("factory", 101), hold: true },
      // Same track: the shared file unions them, so one unit's hold must reach
      // the PR the other one is also riding on.
      { ...buildUnit("beside", 102), files: ["src/factory.ts"] },
      buildUnit("clean", 103),
    ],
    stub(),
    { autoMerge: true }
  );
  const held = agents(calls, "ship:").find((c) => c.label.includes("factory"));
  const clean = agents(calls, "ship:").find((c) => c.label.includes("clean"));
  assert.ok(!/gh pr merge/.test(held.prompt));
  assert.match(held.prompt, /hold — a factory change/);
  assert.match(
    clean.prompt,
    /gh pr merge/,
    "holding one track must not cost the pass every other track's merge"
  );
  assert.equal(result.shipped.find((s) => s.track === "clean").merge, "merged");
});

test("a factory-path unit holds itself, whether or not the caller declared it", async () => {
  // The machine that decides what merges keeps a human. Deriving it from the
  // files means a caller that forgets `hold: true` cannot merge the loop's own
  // rules to main unattended.
  const { calls } = await runBuild(
    [
      { ...buildUnit("factory", 101), files: [".claude/workflows/x.js"] },
      { ...buildUnit("doctrine", 102), files: ["ops/agent-os/dod.md"] },
      buildUnit("clean", 103),
    ],
    stub(),
    { autoMerge: true }
  );
  for (const id of ["factory", "doctrine"]) {
    const held = agents(calls, "ship:").find((c) => c.label.includes(id));
    assert.ok(!/gh pr merge/.test(held.prompt), `${id} must never auto-merge`);
    assert.match(held.prompt, /hold — a factory change/);
  }
  assert.match(
    agents(calls, "ship:").find((c) => c.label.includes("clean")).prompt,
    /gh pr merge/,
    "an ordinary track is unaffected"
  );
});

test("a spec-question holds the track for a human; a ruling ships with the PR", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "review:": () =>
        review({
          verdict: "PASS_WITH_WARNINGS",
          warnings: [
            warn("spec-question", "is a church-wide packet the intended read?"),
            warn("ruling", "used the org's timezone (memory/invariants dates)"),
          ],
        }),
    }),
    { autoMerge: true }
  );
  const prompt = one(calls, "ship:").prompt;
  assert.ok(
    !/gh pr merge/.test(prompt),
    "shipping a product decision the human never made is the failure this prevents"
  );
  assert.match(prompt, /spec-question\(s\)/);
  assert.match(
    prompt,
    /\.claude\/skills\/prototype\/SKILL\.md/,
    "a direction question is answered by trying the options, not by reading prose"
  );
  assert.match(prompt, /Rulings/, "a ruling is recorded in the PR body");
  assert.deepEqual(result.shipped[0].heldBy, [
    "is a church-wide packet the intended read?",
  ]);
  assert.deepEqual(result.shipped[0].rulings, [
    "used the org's timezone (memory/invariants dates)",
  ]);
});

// ---------------------------------------------------------------------------
// build-until-done: the exits — never a silent stop
// ---------------------------------------------------------------------------

test("a DoD pass whose delivery fails lands on agent:delivery-failed, not agent:blocked", async () => {
  const PUSH_REJECTED = "push rejected: remote denied write access";
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      // The real shape: WORKS passed, no PR exists, so no check exists either.
      "ship:": (p) => ({
        ...DEFAULTS["ship:"](p),
        opened: false,
        url: "",
        reason: PUSH_REJECTED,
        checkConclusion: "none",
        labels: [],
      }),
    })
  );
  const exit = one(calls, "exit:").prompt;
  assert.match(exit, /--add-label agent:delivery-failed --remove-label agent:in-progress/); // prettier-ignore
  assert.match(
    exit,
    /retry the delivery/,
    "the human action that distinguishes this label from agent:blocked"
  );
  assert.match(exit, /must NOT re-review or rebuild/);
  assert.ok(
    exit.includes(PUSH_REJECTED),
    "the delivery error is the diagnosis"
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("fix:")),
    "a failed PR step is not a code failure — it must not burn a fix agent and a second ship"
  );
  assert.equal(agents(calls, "ship:").length, 1);
  assert.equal(result.blocked.length, 0);
  assert.equal(result.deliveryFailed.length, 1);
  assert.equal(result.deliveryFailed[0].failingGate, "delivery");
  assert.equal(result.deliveryFailed[0].branch, "feature/alpha");
  assert.equal(result.deliveryFailed[0].labelSettled, true);
  assert.match(result.nextStep, /the code already passed/);
});

test("a blocked track comments its evidence, labels itself, and reads the label back", async () => {
  const { result, calls } = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "review:": () =>
        review({ verdict: "FAIL", failingGate: "correctness", summary: CRASH }),
    })
  );
  const exit = one(calls, "exit:");
  assert.match(exit.prompt, /gh issue comment <n>/);
  assert.match(exit.prompt, /--add-label agent:blocked --remove-label agent:in-progress/); // prettier-ignore
  assert.match(exit.prompt, /gh issue view n --json labels --jq '\[\.labels\[\]\.name\]'/); // prettier-ignore
  assert.equal(exit.label, "exit:alpha", "one agent comments AND labels AND reads back"); // prettier-ignore
  assert.equal(result.blocked[0].labelSettled, true);
});

test("a stopped track hands over every worktree it left behind, by name", async () => {
  const { result, calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
      { ...buildUnit("api", 103), dependsOn: ["schema"] },
    ],
    (prompt, opts) => {
      if (opts.label === "impl:schema-s1w2") throw new Error("this agent died");
      return stub()(prompt, opts);
    }
  );
  const exit = one(calls, "exit:").prompt;
  assert.match(exit, /Surviving worktrees/);
  assert.match(
    exit,
    /`\.claude\/worktrees\/bud-schema-s1w1` on `feature\/schema-s1w1`/,
    "the fan-out workstreams' trees are survivors too, not just the track's"
  );
  assert.match(
    exit,
    /you remove none of them/,
    "a blocked track's tree is the only re-runnable copy of the work"
  );
  assert.ok(
    result.blocked[0].survivingWorktrees.includes(
      ".claude/worktrees/bud-schema"
    )
  );
});

test("an attempt that cannot be funded stops before it starts", async () => {
  const { result, calls } = await runBuild([buildUnit("alpha", 101)], stub(), {
    budgetImpl: {
      total: 1_000_000,
      spent: () => 900_000,
      remaining: () => 100_000,
    },
  });
  assert.ok(
    !calls.some((c) => c.label?.startsWith("review:")),
    "stopping mid-tail is the expensive failure — one flat check before the tail"
  );
  assert.ok(
    !calls.some((c) => c.label?.startsWith("impl:")),
    "the implement stages are the expensive part; a wave must not build work it can never ship"
  );
  assert.equal(result.blocked.length, 1);
  assert.match(result.blocked[0].reason, /token reserve hit before stage 0/);
});

test("each step runs at its ruled tier", async () => {
  // A fan-out track with a finding exercises six of the seven steps; the
  // seventh only exists on a failure, so it comes from a second run.
  const passing = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
      { ...buildUnit("api", 103), dependsOn: ["schema"] },
    ],
    stub({
      "review:": () => review({ findings: [finding("critical", "no tenant scope")] }), // prettier-ignore
    })
  );
  const failing = await runBuild(
    [buildUnit("alpha", 101)],
    stub({
      "review:": () =>
        review({ verdict: "FAIL", failingGate: "correctness", summary: CRASH }),
    })
  );
  const calls = [...passing.calls, ...failing.calls];
  const tier = (prefix) => {
    const c = one(calls, prefix);
    return [c.model, c.agentType];
  };
  assert.deepEqual(tier("setup:"), ["haiku", undefined], "claim and cut");
  assert.deepEqual(tier("impl:"), ["opus", "backend"]);
  assert.deepEqual(tier("integrate:"), ["opus", "backend"]);
  assert.deepEqual(tier("review:"), ["opus", "code-reviewer"]);
  assert.deepEqual(tier("fix:"), ["opus", "backend"]);
  // Ship transcribes GitHub's answer and can mutate main: it must not drop to
  // the quick-command tier.
  assert.deepEqual(tier("ship:"), ["opus", undefined]);
  assert.deepEqual(tier("exit:"), ["haiku", undefined], "transcribe and label");
});

test("the gate contract has one home, and both judging passes point at it", async () => {
  const { calls } = await runBuild([buildUnit("alpha", 101)], stub());
  for (const prefix of ["review:", "ship:"])
    assert.match(
      one(calls, prefix).prompt,
      /ops\/agent-os\/dod\.md/,
      `${prefix} must cite the gate contract rather than carry a copy of it`
    );
});

test("the implementer is told the conventions and told not to ship", async () => {
  const { calls } = await runBuild([buildUnit("alpha", 101)], stub());
  const prompt = one(calls, "impl:").prompt;
  assert.match(prompt, /Read AGENTS\.md, then memory\/invariants\.md/);
  assert.match(
    prompt,
    /Do NOT push, open a PR, edit labels or issues, or merge/,
    "the loop integrates, reviews and ships"
  );
});

test("the integration step resolves conflicts by intent and typechecks the assembly", async () => {
  const { calls } = await runBuild(
    [
      buildUnit("schema", 101),
      { ...buildUnit("ui", 102), dependsOn: ["schema"] },
      { ...buildUnit("api", 103), dependsOn: ["schema"] },
    ],
    stub()
  );
  const prompt = one(calls, "integrate:").prompt;
  assert.match(prompt, /git -C .* merge --no-ff/);
  assert.match(
    prompt,
    /\.claude\/skills\/resolving-merge-conflicts\/SKILL\.md/
  );
  assert.match(
    prompt,
    /pnpm typecheck/,
    "two individually-correct workstreams can still contradict each other"
  );
});

// ---------------------------------------------------------------------------
// File-level mechanisms: the parent idiom and the format hook. Neither is
// exercised by a stubbed run, and agents re-derived both when they were prose.
// ---------------------------------------------------------------------------

const listJs = (dir) =>
  fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `${dir}/${f}`)
    .sort();
const WORKFLOW_FILES = listJs(".claude/workflows");

const PARENT_DOC_FILES = ["ops/agent-os/dod.md", "ops/agent-os/labels.md"];

// `node --check` is deliberately NOT used here — on Node 24 it exits 0 WITHOUT
// parsing any file it detects as ESM, and `export const meta` makes every
// workflow script ESM-detected. Instead each file is parsed exactly the way the
// runtime (and the harnesses above) evaluate it.
test("every workflow script parses under the harness wrapper", () => {
  for (const name of ["build-until-done.js", "frd-plan.js", "frd-implement.js"])
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
        "phase",
        "pipeline",
        `return (async () => { ${source} })()`
      );
    } catch (e) {
      assert.fail(`${file} does not parse: ${e.message}`);
    }
  }
});

test("the loop is one file: no child workflow, no recipe seam", () => {
  assert.doesNotMatch(
    read(".claude/workflows/build-until-done.js"),
    /\bworkflow\(/,
    "a child workflow duplicates the guards it carries across the seam"
  );
  assert.ok(
    !fs.existsSync(path.join(ROOT, ".claude/workflows/recipes")),
    "one implement strategy means there is nothing to select between"
  );
});

test("no prompt or doc READS the parent through REST", () => {
  // `gh api repos/{owner}/{repo}/issues/<n> --jq .parent` returns null even when
  // a parent exists, so a reader that trusts it acts on a lie. The form may only
  // appear as a warning.
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

test("the GraphQL parent idiom is recorded where agents will meet it", () => {
  for (const file of PARENT_DOC_FILES)
    assert.match(
      read(file),
      /gh issue view [^\n]*--json parent/,
      `${file} must state the working idiom, not leave it to be re-derived`
    );
});

test("the format hook escapes the worktree ignore, and the walk still skips it", () => {
  // `.prettierignore` applies to explicitly-named paths exactly as it does to
  // walked ones, so a hook running from the repo root silently skips every file
  // an agent writes in a worktree. The hook resolves the NEAREST .prettierignore
  // walking up from the file, which inside a worktree is that worktree's own.
  assert.match(
    read(".prettierignore"),
    /^\.claude\/worktrees\/$/m,
    "dropping this makes `pnpm format:check` walk every sibling checkout"
  );

  const settings = JSON.parse(read(".claude/settings.json"));
  const hook = settings.hooks.PostToolUse.flatMap((m) => m.hooks).find((h) =>
    /prettier/.test(h.command)
  );
  assert.ok(hook, "the PostToolUse format hook must exist");
  assert.match(hook.command, /--ignore-path/);
  assert.match(hook.command, /\.prettierignore/);
  assert.match(
    hook.command,
    /while \[/,
    "nearest-ancestor resolution, so a main-checkout edit behaves exactly as before"
  );
});
