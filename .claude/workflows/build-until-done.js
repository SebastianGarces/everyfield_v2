export const meta = {
  name: "build-until-done",
  description:
    "The loop. Per track: a prerequisite stage, then parallel workstreams in their own worktrees off the track branch, merged back stage by stage. Each workstream passes its own scoped gates; the assembled branch passes ONE integration DoD (independent verifier + MCP) → on PASS open a PR with the evidence bundle. On exhaustion (max attempts / token reserve) label the issue agent:blocked and alert — never a silent stop, never a PR that isn't proven done.",
  whenToUse:
    "After spec-intake + token-preflight, to actually build a wave of tracks autonomously to PR. Pass args = the wave's units array (each: {id,title,lane,files,summary,acceptanceCriteria,issue,risk,dependsOn,hold?}), optionally {units, base, maxAttempts, maxConcurrentAgents}.",
  phases: [
    {
      title: "Build",
      detail:
        "stage by stage: one agent per workstream in its own worktree cut from the track branch, merged back before the next stage starts",
    },
    {
      title: "Verify",
      detail:
        "scoped gates per workstream (G0 / G2-subset / G5), then ONE integration DoD on the assembled branch incl. MCP G3; high-risk adds three diverse lenses (correctness / security / reproducibility), every one of which must clear",
    },
    {
      title: "Ship",
      detail:
        "open-pr — gated on a PASS verdict, with the evidence bundle — then write the outcome label and READ IT BACK; an unconfirmed label errors the track instead of shipping it",
      model: "opus",
    },
  ],
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const parsed = typeof args === "string" ? JSON.parse(args) : args;
const units = Array.isArray(parsed) ? parsed : parsed?.units;
if (!Array.isArray(units) || units.length === 0)
  throw new Error(
    "Pass the wave's units array as args, e.g. [{id,title,lane,files,summary,acceptanceCriteria,issue,risk}, ...]"
  );
// ---------------------------------------------------------------------------
// Recipes — the strategy layer (#399). A recipe is a child workflow at
// .claude/workflows/recipes/<id>.js that implements ONE WORKSTREAM ATTEMPT and
// nothing else; the guarantee layer keeps everything around it (claiming,
// staging, worktrees, scoped verify, attempt accounting, merge-back, and the
// whole verify-and-ship tail). Contract: ops/agent-os/recipes.md.
//
// An unknown id fails HERE, at parse — before any claim, before any worktree,
// never mid-build.
// ---------------------------------------------------------------------------
const KNOWN_RECIPES = ["implement-straight", "generate-and-filter"];
const recipeOf = (u) => u.recipe || "implement-straight";
for (const u of units)
  if (!KNOWN_RECIPES.includes(recipeOf(u)))
    throw new Error(
      `unit "${u.id}" names unknown recipe "${u.recipe}". Known recipes: ${KNOWN_RECIPES.join(", ")}. ` +
        `Recipe validation is a parse-time gate — failing here means nothing was claimed and no worktree was cut.`
    );
const MAX_ATTEMPTS = parsed?.maxAttempts || 3;
// How many times a label write is re-attempted before the track is errored.
// A label write is idempotent, so retrying is free; NOT retrying is what left
// two tracks lying on 2026-07-26.
const LABEL_ATTEMPTS = parsed?.labelAttempts || 3;
// Opt-in per run. Off by default so a direct `/deliver` call cannot merge to
// main by surprise; `dispatch` turns it on explicitly.
const AUTO_MERGE = parsed?.autoMerge === true;
// The base is a REMOTE ref, and that is not a detail.
//
// The maiden staged-tracks run (wf_74fd1c21) cut its track branch from the local
// `main` at 14c5d33, two commits behind origin/main at 700c333. Every verifier in
// that track then read a pre-#302 `ops/agent-os/dod.md` out of its worktree, and
// PR #333 landed on `mergeStateStatus: BEHIND` — the main ruleset requires
// up-to-date branches — so auto-merge could not fire without a manual
// `gh pr update-branch`. A local ref is whatever the human's checkout last
// fetched; `origin/main` is what the PR will actually merge into.
//
// So a caller-supplied bare branch name is normalised onto the remote. An
// explicit `origin/...`, a SHA or a tag is taken literally — those are already
// unambiguous, and rewriting them would break a deliberate pin.
const BASE_INPUT = parsed?.base || "main";
const BASE = /^(origin\/|[0-9a-f]{7,40}$|refs\/|v\d)/.test(BASE_INPUT)
  ? BASE_INPUT
  : `origin/${BASE_INPUT}`;
// Stop starting a NEW attempt if we can't safely finish one. Tunable per run.
//
// This is now a PER-WORKSTREAM reserve, not a per-track one. A stage that runs
// four workstreams in parallel needs four times this before it may start, which
// is the whole point: the old flat number was sized for a track that was always
// one agent, and it would happily start a stage it could not finish.
const RESERVE = parsed?.reserve || 150_000;
// The cap is on AGENTS, not tracks. One track can now hold eight workstreams, so
// "3 tracks" stopped saying anything about load. Concurrency bounds cost; the
// review queue (dispatch gate 1) bounds output. Neither substitutes for the other.
const MAX_CONCURRENT_AGENTS = parsed?.maxConcurrentAgents || 6;

const CONVENTIONS = `Read AGENTS.md and CLAUDE.md, then memory/entrypoints.md, memory/invariants.md (the one-liner index — every rule is stated there), the memory/invariants/*.md domain files matching the files you own, and relevant memory/contracts/*.md before opening source files. Hard rules: pnpm; Drizzle migrations via db:generate+db:migrate (NEVER db:push); shadcn via pnpm dlx shadcn@latest add; cursor-pointer on clickables; never start a dev server (the human keeps localhost:3000 running).`;

const IMPL_SCHEMA = {
  type: "object",
  required: ["committed", "filesChanged", "summary", "selfCheckPassed"],
  properties: {
    committed: {
      type: "boolean",
      description: "code committed to the track branch",
    },
    filesChanged: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    selfCheckPassed: {
      type: "boolean",
      description: "tsc + lint passed in the worktree",
    },
    deviations: {
      type: "string",
      description: "any files touched outside the declared set, justified",
    },
  },
};

// ---------------------------------------------------------------------------
// The retry contract — a fix must answer the ROOT CAUSE it was given.
//
// On #307 (run wf_763bdf16) the verifier named a `ReferenceError:
// ChurchBasicsFieldErrors` module-eval crash. Attempts 2 and 3 came back having
// fixed a stuck button and pinned a test — plausible work, both times, against a
// page that still crashed on evaluation. The named cause shipped unfixed three
// times and the track exhausted its attempts.
//
// Two things failed there, and this schema is half the fix. The other half is
// the prompt: the retry now quotes the failing gate's evidence VERBATIM instead
// of handing over a one-line `fixInstructions` paraphrase. Here the implementer
// must restate that cause in its own words and say what it did about it — and
// the loop refuses the attempt if it cannot, BEFORE spending a verifier on it.
// "I fixed some things" is exactly the answer that burned #307.
// ---------------------------------------------------------------------------
const RETRY_IMPL_SCHEMA = {
  type: "object",
  required: [...IMPL_SCHEMA.required, "rootCause", "rootCauseAddressed"],
  properties: {
    ...IMPL_SCHEMA.properties,
    rootCause: {
      type: "string",
      description:
        "The root cause the verifier NAMED, restated in your own words. Not the symptom, not the gate id — the defect. If the evidence names an error, quote it.",
    },
    rootCauseAddressed: {
      type: "string",
      description:
        "What you changed so that NAMED cause is gone, and how you proved it is gone (the command you ran and what it printed). If you did not fix it, say so plainly here — a truthful 'not addressed, here is why' is worth more than a fix report for something else.",
    },
  },
};
// DOD_SCHEMA, MERGE_SCHEMA, PUSH_SCHEMA, CLEANUP_SCHEMA, PR_SCHEMA,
// LENS_SCHEMA and HIGH_RISK_LENSES MOVED to .claude/workflows/verify-and-ship.js
// with the guarantee tail (#399). They live ONLY there now.

// ---------------------------------------------------------------------------
// The SCOPED verdict — one workstream, not one track.
//
// Only the gates that can honestly be scoped to a subset of the branch live
// here: G0 (this workstream's own ACs), G2-subset (the tests covering its files)
// and G5 (its diff against ITS declared files). G1 and G3 are deliberately
// absent — the build is repo-wide and G3 needs a preview deployment that only
// exists per branch, so running either per workstream would buy nothing and cost
// N times. They run once, at integration.
// ---------------------------------------------------------------------------
const SCOPED_DOD_SCHEMA = {
  type: "object",
  required: ["verdict", "gates", "acceptanceCriteria", "summary"],
  properties: {
    verdict: { type: "string", enum: ["PASS", "PASS_WITH_WARNINGS", "FAIL"] },
    gates: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status", "evidence"],
        properties: {
          id: { type: "string", description: "G0 | G2-subset | G5" },
          status: { type: "string", enum: ["PASS", "FAIL", "SKIPPED"] },
          evidence: { type: "string" },
        },
      },
    },
    acceptanceCriteria: {
      type: "array",
      items: {
        type: "object",
        required: ["ac", "status", "evidence"],
        properties: {
          ac: { type: "string" },
          status: { type: "string", enum: ["PASS", "FAIL"] },
          evidence: { type: "string" },
        },
      },
    },
    failingGate: { type: "string" },
    fixInstructions: { type: "string" },
    summary: { type: "string" },
  },
};

// Merging a stage's parallel workstream branches back onto the track branch.
// This is the one place the loop can hit a real conflict, because two agents
// wrote in separate worktrees; `resolving-merge-conflicts` exists for exactly
// this and is now called from inside the loop rather than by a human.
const INTEGRATE_SCHEMA = {
  type: "object",
  required: ["merged", "conflicts"],
  properties: {
    merged: {
      type: "array",
      items: { type: "string" },
      description: "workstream branches actually merged into the track branch",
    },
    conflicts: {
      type: "array",
      items: { type: "string" },
      description: "branches that could NOT be merged cleanly, with the reason",
    },
    detail: { type: "string" },
  },
};

// ---------------------------------------------------------------------------
// Folding code-quality warnings into a per-parent rollup (RULED 2026-08-05).
//
// The old path filed one `agent:queued` issue per warning, and 12 of an 86-issue
// backlog arrived that way: a contrast ratio, a docblock, a stale line in a
// memory contract — each then demanding a branch, a hermetic build, a full test
// suite, a preview deploy, a CI wait and a human-facing PR. One of them (#231)
// was the loop filing an issue about its own G0 violation.
//
// What must NOT be lost in the change: the warnings still land BEFORE the merge,
// so a merge cannot swallow them. An append mutates an existing body, which is
// precisely the operation that failed silently on 2026-07-26 — so, exactly like
// settleLabels, the agent reports what `gh issue view --json body` PRINTED and
// the loop asserts it.
// ---------------------------------------------------------------------------
const FOLLOWUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["followUps"],
  properties: {
    followUps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issue", "kind", "anchor", "confirmed"],
        properties: {
          issue: {
            type: "integer",
            description: "the rollup issue the AC was appended to",
          },
          kind: { type: "string", enum: ["appended", "created"] },
          anchor: {
            type: "string",
            description:
              "the exact AC line written, so the loop can find it in the read-back",
          },
          confirmed: {
            type: "boolean",
            description:
              "true ONLY if you saw this line in the body `gh issue view` printed AFTER the write",
          },
        },
      },
    },
    rollupLabels: {
      type: "array",
      items: { type: "string" },
      description: "labels the rollup carries after the write",
    },
    note: { type: "string" },
  },
};
const CLAIM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claimed", "inProgressNow"],
  properties: {
    claimed: {
      type: "array",
      items: { type: "integer" },
      description: "The issue numbers this step actually edited.",
    },
    inProgressNow: {
      type: "array",
      items: { type: "integer" },
      description:
        "Every issue currently carrying agent:in-progress, for blast-radius verification.",
    },
  },
};

// DUPLICATED in .claude/workflows/verify-and-ship.js (the two-table pattern,
// like dispatch/token-preflight): change one, change both.
const BLOCK_SCHEMA = {
  type: "object",
  required: ["commented"],
  properties: { commented: { type: "boolean" }, note: { type: "string" } },
};

// ---------------------------------------------------------------------------
// The label is the outcome — so it is read back, not assumed.
//
// On 2026-07-26 the loop wrote its narrative (PR body / issue comment) and its
// LABEL as two steps, and on 2 of 8 tracks the second one silently did not
// happen: #110 shipped a full evidence bundle and #74 was blocked, and both
// issues stayed on `agent:in-progress`. Neither step reported an error.
//
// `ops/agent-os/labels.md` declares the labels canonical and the Project board
// derived, so a missed label is not cosmetic — it is the system of record
// telling a lie that a human cannot distinguish from the truth (in-progress
// with an open PR reads identically as passed, failed and still-running). A
// reviewer acting on it promoted a blocked PR into the review queue.
//
// The fix is the #139 claim-guard shape: the writing agent reports what
// `gh issue view` PRINTED after the write, the loop asserts that observation,
// retries, and on final failure the track is ERRORED rather than reported as
// success. An agent's "I labelled it" is not evidence; the read-back is.
//
// DUPLICATED in .claude/workflows/verify-and-ship.js (the two-table pattern,
// like dispatch/token-preflight): change one, change both. The parent keeps
// its copy for blockTrack and the claim path; the child owns the ship-side
// label writes.
// ---------------------------------------------------------------------------
const LABEL_STATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["observed"],
  properties: {
    observed: {
      type: "array",
      description:
        "One row per issue, holding the labels `gh issue view` printed AFTER the write. Transcribe what you saw; do not report what you intended.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issue", "labels"],
        properties: {
          issue: { type: "integer" },
          labels: { type: "array", items: { type: "string" } },
        },
      },
    },
    prLabels: {
      type: "array",
      items: { type: "string" },
      description:
        "Labels `gh pr view` printed after the write, when a PR was in scope.",
    },
    note: { type: "string" },
  },
};
// ---------------------------------------------------------------------------
// Grouping, in two layers that used to be one.
//
// A TRACK is a connected component over (shared file ∪ dependsOn): everything
// that must live on one branch because it either touches the same file or needs
// the other's code to exist. One track is still one branch, one worktree, one PR.
//
// Inside a track, STAGES are the topological levels of dependsOn, and inside a
// stage the file-overlap DSU runs again — but only over that stage's units. That
// is the change: overlap WITHIN a stage forces one agent (there is no safe way to
// let two agents write one file concurrently), while overlap ACROSS stages is
// free, because stages are sequential and the later one starts from the earlier
// one's commit.
//
// The old code unioned by file across the whole track, which is why a track could
// only ever be one agent. `dependsOn` used to be discarded before it got here
// (frd-plan dropped same-track edges); it now survives, and it is what makes a
// prerequisite-then-fan-out shape expressible at all.
// ---------------------------------------------------------------------------
const normFile = (f) =>
  String(f)
    .replace(/\s*\((new|modified|edit|edited)\)\s*$/i, "")
    .trim();
function makeDSU(ids) {
  const p = new Map(ids.map((i) => [i, i]));
  const find = (x) => {
    let r = x;
    while (p.get(r) !== r) r = p.get(r);
    while (p.get(x) !== r) {
      const n = p.get(x);
      p.set(x, r);
      x = n;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) p.set(ra, rb);
  };
  return { find, union };
}

/** Group `us` into file-disjoint clusters. Shared file => same cluster. */
function clusterByFile(us) {
  const dsu = makeDSU(us.map((u) => u.id));
  const owners = new Map();
  for (const u of us)
    for (const raw of u.files || []) {
      const f = normFile(raw);
      if (!owners.has(f)) owners.set(f, []);
      owners.get(f).push(u.id);
    }
  for (const [, o] of owners)
    if (o.length > 1) for (let i = 1; i < o.length; i++) dsu.union(o[0], o[i]);
  const groups = new Map();
  for (const u of us) {
    const r = dsu.find(u.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(u);
  }
  return [...groups.values()];
}

const summarise = (us, extra = {}) => ({
  units: us,
  issues: [...new Set(us.map((u) => u.issue).filter((x) => x != null))],
  files: [...new Set(us.flatMap((u) => (u.files || []).map(normFile)))],
  risk: us.some((u) => u.risk === "high") ? "high" : us[0].risk || "low",
  // Both of these are one-way: a unit can only ever make its track MORE held,
  // never less. `hold` is the declared never-auto-merge flag — a factory change
  // (this loop, the delivery-OS skills, ops/agent-os) or an issue that says so —
  // and it rides with the unit so a mixed wave can still auto-merge the tracks
  // beside it. See the auto-merge gate below.
  hold: us.some((u) => u.hold === true),
  lane:
    [...new Set(us.map((u) => u.lane))].length === 1 ? us[0].lane : "fullstack",
  ...extra,
});

// Layer 1: tracks — connected components over shared file AND dependsOn.
const trackDsu = makeDSU(units.map((u) => u.id));
const byUnitId = new Map(units.map((u) => [u.id, u]));
{
  const owners = new Map();
  for (const u of units)
    for (const raw of u.files || []) {
      const f = normFile(raw);
      if (!owners.has(f)) owners.set(f, []);
      owners.get(f).push(u.id);
    }
  for (const [, o] of owners)
    if (o.length > 1)
      for (let i = 1; i < o.length; i++) trackDsu.union(o[0], o[i]);
  for (const u of units)
    for (const d of u.dependsOn || [])
      if (byUnitId.has(d)) trackDsu.union(u.id, d);
}
const trackGroups = new Map();
for (const u of units) {
  const r = trackDsu.find(u.id);
  if (!trackGroups.has(r)) trackGroups.set(r, []);
  trackGroups.get(r).push(u);
}

/**
 * Layer 2: stages within one track, then workstreams within one stage.
 *
 * A cycle here would deadlock the track forever, exactly as a cycle on the board
 * would deadlock the frontier — so it throws at plan time rather than hanging.
 */
function planStages(trackUnits, trackId) {
  const ids = new Set(trackUnits.map((u) => u.id));
  const depsOf = (u) => (u.dependsOn || []).filter((d) => ids.has(d));
  const level = new Map();
  const visiting = new Set();
  const depth = (id) => {
    if (level.has(id)) return level.get(id);
    if (visiting.has(id))
      throw new Error(
        `dependsOn cycle inside track "${trackId}" at unit "${id}". ` +
          `A cycle can never reach a stage — fix the decomposition.`
      );
    visiting.add(id);
    let d = 0;
    for (const p of depsOf(byUnitId.get(id))) d = Math.max(d, 1 + depth(p));
    visiting.delete(id);
    level.set(id, d);
    return d;
  };
  for (const u of trackUnits) depth(u.id);

  const maxLevel = Math.max(...trackUnits.map((u) => level.get(u.id)));
  const stages = [];
  for (let l = 0; l <= maxLevel; l++) {
    const inLevel = trackUnits.filter((u) => level.get(u.id) === l);
    if (!inLevel.length) continue;
    stages.push(
      clusterByFile(inLevel).map((us, i) => {
        // One workstream runs ONE recipe. Units may only share a workstream
        // (same stage + shared files) when they agree on it — a mixed set is a
        // plan defect, thrown here at plan time, never mid-build.
        const recipes = [...new Set(us.map(recipeOf))];
        if (recipes.length > 1)
          throw new Error(
            `units ${us.map((u) => `"${u.id}"`).join(", ")} share a workstream in track "${trackId}" ` +
              `but name different recipes (${recipes.join(", ")}) — a workstream runs one recipe. ` +
              `Fix the decomposition or the recipe choices.`
          );
        return summarise(us, {
          id: `${trackId}-s${stages.length}w${i + 1}`,
          recipe: recipes[0],
        });
      })
    );
  }
  return stages;
}

const tracks = [...trackGroups.values()].map((us) => {
  const id = us[0].id;
  return summarise(us, { id, stages: planStages(us, id) });
});

const totalWorkstreams = tracks.reduce(
  (n, t) => n + t.stages.reduce((m, s) => m + s.length, 0),
  0
);
log(
  `${units.length} unit(s) → ${tracks.length} track(s), ${totalWorkstreams} workstream(s); ` +
    `max ${MAX_ATTEMPTS} attempt(s) per workstream; ≤${MAX_CONCURRENT_AGENTS} agents at once.`
);
for (const t of tracks)
  if (t.stages.length > 1 || t.stages[0].length > 1)
    log(
      `   ${t.id}: ${t.stages.map((s, i) => `stage ${i} × ${s.length}`).join(" → ")}`
    );

// Every issue this pass is permitted to touch. Any `agent:in-progress` outside
// this set means a labelling step overreached — see board-design-2026-07.md §11.
const PASS_ISSUES = [...new Set(tracks.flatMap((t) => t.issues))];

// ---------------------------------------------------------------------------
// Per-track verify-until-done loop
// ---------------------------------------------------------------------------
function unitBlocks(holder) {
  return holder.units
    .map(
      (
        u,
        i
      ) => `### Unit ${i + 1}: ${u.title} (${u.lane}) — issue #${u.issue ?? "?"}
Summary: ${u.summary}
Files: ${(u.files || []).join(", ")}
Acceptance criteria:
${(u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n")}`
    )
    .join("\n\n");
}

const allCriteria = (holder) =>
  holder.units
    .map((u) => (u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n"))
    .join("\n");

// DUPLICATED in .claude/workflows/verify-and-ship.js — change one, change both.
const hashes = (issues) => issues.map((n) => `#${n}`).join(", ");

/**
 * The failing gate's evidence, VERBATIM — not a summary of it.
 *
 * `fixInstructions` is the verifier's paraphrase, and a paraphrase is where a
 * named `ReferenceError` becomes "the page does not render" and the next
 * implementer goes hunting for a stuck button (#307, attempts 2–3). The
 * implementer gets the raw gate evidence and the raw per-AC evidence, quoted, so
 * the cause survives the handoff intact.
 */
function evidenceBlock(report) {
  if (!report) return "(the verifier returned nothing at all)";
  const failing = (report.gates || []).filter((g) => g?.status === "FAIL");
  const failedAcs = (report.acceptanceCriteria || []).filter(
    (a) => a?.status === "FAIL"
  );
  const lines = [];
  if (report.failingGate) lines.push(`FAILING GATE: ${report.failingGate}`);
  for (const g of failing)
    lines.push(`--- gate ${g.id} evidence (verbatim) ---\n${g.evidence}`);
  for (const a of failedAcs)
    lines.push(`--- failed AC: ${a.ac} ---\n${a.evidence}`);
  if (report.summary) lines.push(`--- verifier summary ---\n${report.summary}`);
  if (report.fixInstructions)
    lines.push(`--- fix instructions ---\n${report.fixInstructions}`);
  if (report.notes) lines.push(`--- notes ---\n${report.notes}`);
  return lines.length
    ? lines.join("\n\n")
    : "(the verifier reported a failure but attached no evidence — say so, and treat the missing evidence as the first thing to fix)";
}

/**
 * Every worktree and local branch this track will leave behind if it stops here.
 *
 * Both live passes exited without saying: PR #333 was held with `bud-310-ws1*`
 * still on disk (removed by hand later), and #303/#307 blocked with their trees
 * intact — useful only because a human happened to know where to look. A merged
 * track cleans up after itself; a held or blocked one hands the list over, since
 * those trees are the only place the work exists in a re-runnable form.
 */
function survivingTrees(track, branch, wt) {
  const trees = [
    {
      path: wt,
      branch,
      holds: `the track branch for issue(s) ${hashes(track.issues)} — every stage merged into it so far`,
    },
  ];
  for (const stage of track.stages || [])
    for (const ws of stage)
      if (ws.wt && ws.wt !== wt)
        trees.push({
          path: ws.wt,
          branch: ws.branch,
          holds: `workstream ${ws.id} (issue(s) ${hashes(ws.issues)}) — ${(ws.files || []).join(", ") || "no declared files"}`,
        });
  return trees;
}

// DUPLICATED in .claude/workflows/verify-and-ship.js — change one, change both.
const treeLines = (trees) =>
  (trees || [])
    .map(
      (t) => `  - worktree \`${t.path}\` on branch \`${t.branch}\` — ${t.holds}`
    )
    .join("\n") || "  (none — nothing was created)";

/**
 * `parallel()` with a ceiling. Runs thunks in chunks of `limit` so a track with
 * eight workstreams cannot put eight agents in flight at once.
 *
 * Chunking rather than a rolling window is deliberate: a stage is a barrier
 * anyway (nothing in stage N+1 may start before stage N integrates), so the
 * scheduling this gives up is scheduling the design does not want.
 */
async function boundedParallel(thunks, limit = MAX_CONCURRENT_AGENTS) {
  const out = [];
  for (let i = 0; i < thunks.length; i += limit)
    out.push(...(await parallel(thunks.slice(i, i + limit))));
  return out;
}

/**
 * Which of `issues` do NOT demonstrably read `target`.
 *
 * A missing row counts as a violation: an issue nobody reported on is an issue
 * nobody looked at. `agent:in-progress` surviving alongside the target counts
 * too — the status labels are mutually exclusive (labels.md), and the observed
 * failure mode was exactly a stale `agent:in-progress` left in place.
 *
 * DUPLICATED in .claude/workflows/verify-and-ship.js — change one, change both.
 */
function labelViolations(issues, observed, target) {
  return (issues || []).filter((n) => {
    const row = (observed || []).find((o) => Number(o?.issue) === Number(n));
    if (!row) return true;
    const labels = row.labels || [];
    return !labels.includes(target) || labels.includes("agent:in-progress");
  });
}

/**
 * Write `target` onto the track's issues (and, for the review queue, its PR),
 * then READ THE LABELS BACK and assert them. Retries, and reports failure
 * instead of a cheerful boolean.
 *
 * DUPLICATED in .claude/workflows/verify-and-ship.js — change one, change both.
 *
 * Returns { settled, observed, prLabels, attempts, missing }.
 */
async function settleLabels(track, target, { phase = "Ship", pr = null } = {}) {
  if (!track.issues.length)
    return { settled: true, observed: [], attempts: 0, missing: [] };

  const list = track.issues.join(", ");
  const wantsPrLabel = Boolean(pr?.url) && target === "agent:in-review";
  let observed = [];
  let prLabels = [];

  for (let attempt = 1; attempt <= LABEL_ATTEMPTS; attempt++) {
    const reply = await agent(
      `Put the board in its true state. The issues are ${list} and the target status label is \`${target}\`.
${attempt > 1 ? `\nATTEMPT ${attempt}: a previous attempt did NOT land. The issues that still do not read \`${target}\` are ${labelViolations(track.issues, observed, target).join(", ") || "(none reported — the last attempt returned nothing)"}. Re-run the edit for those and read them back again.\n` : ""}
1. For EACH issue n in ${list}:
   \`gh issue edit n --add-label ${target} --remove-label agent:in-progress\`
   The status labels are mutually exclusive, so also remove any OTHER \`agent:*\`
   label the issue still carries. If a \`--remove-label\` fails because the label
   was already gone, that is fine — re-run it as an \`--add-label\` only.
${wantsPrLabel ? `2. Ensure the PR ${pr.url} carries \`${target}\` too: \`gh pr edit ${pr.url} --add-label ${target}\`.\n` : ""}
${wantsPrLabel ? "3" : "2"}. Now READ IT BACK. Do not skip this and do not answer from what you
   intended. For each issue n run:
   \`gh issue view n --json labels --jq '[.labels[].name]'\`
${wantsPrLabel ? `   and \`gh pr view ${pr.url} --json labels --jq '[.labels[].name]'\`\n` : ""}
   Report EXACTLY what those commands printed, even if it is not what you expected —
   the loop compares your report against the target and will retry. A wrong answer
   here is worse than a failed edit, because it makes a broken board look settled.

Return {"observed":[{"issue":n,"labels":[...]} for every issue in ${list}]${wantsPrLabel ? ', "prLabels":[...]' : ""}}.`,
      {
        label: `label:${target.replace("agent:", "")}:${track.id}#${attempt}`,
        phase,
        // Cheap is safe here ONLY because the answer is verified below. The
        // 2026-07-26 failure was a cheap agent silently no-opping; the guard,
        // not the model tier, is what makes that survivable — which is why
        // haiku is fine here while blockTrack (unverified prose) stays sonnet.
        model: "haiku",
        effort: "low",
        schema: LABEL_STATE_SCHEMA,
      }
    );

    observed = reply?.observed || [];
    prLabels = reply?.prLabels || [];
    const missing = labelViolations(track.issues, observed, target);
    const prMissing = wantsPrLabel && !prLabels.includes(target);

    if (!missing.length && !prMissing)
      return {
        settled: true,
        observed,
        prLabels,
        attempts: attempt,
        missing: [],
      };

    log(
      `🏷️  ${track.id} label write did not stick on attempt ${attempt}/${LABEL_ATTEMPTS} — ` +
        `${missing.length ? `issue(s) ${missing.join(", ")} do not read ${target}` : ""}` +
        `${missing.length && prMissing ? "; " : ""}${prMissing ? `the PR does not carry ${target}` : ""}`
    );
  }

  return {
    settled: false,
    observed,
    prLabels,
    attempts: LABEL_ATTEMPTS,
    missing: labelViolations(track.issues, observed, target),
  };
}

async function blockTrack(track, reason, lastReport, trees = []) {
  log(`⛔ ${track.id} blocked: ${reason}`);
  await agent(
    `A build loop for issue(s) ${track.issues.map((n) => `#${n}`).join(", ")} could not reach the Definition of Done.
Reason: ${reason}.
Failing gate / findings: ${lastReport ? JSON.stringify({ failingGate: lastReport.failingGate, fixInstructions: lastReport.fixInstructions, summary: lastReport.summary }) : "no verifier report"}.

The full evidence, verbatim — put it in the comment as-is, do not summarise it:
\`\`\`
${evidenceBlock(lastReport)}
\`\`\`

SURVIVING WORKTREES — these were deliberately NOT removed, because they hold the only copy of the attempted work:
${treeLines(trees)}

For EACH issue, post a comment (\`gh issue comment <n>\`) containing:
  1. The failing gate + the evidence above, verbatim.
  2. What a human needs to do.
  3. A **Surviving worktrees** section listing every path + branch + what it holds, exactly as given above, and the line: these are yours now — inspect or re-run them, and \`git worktree remove <path>\` when you are done.
Do NOT remove any worktree or branch yourself; a blocked track's tree is the evidence. Do NOT open a PR. Do NOT edit labels — the loop writes and verifies the \`agent:blocked\` label itself in the next step. Return strictly the schema.`,
    {
      label: `block:${track.id}`,
      phase: "Verify",
      // Mechanical: a comment transcribed from the report it was handed. It
      // reformats findings, it does not produce them.
      model: "sonnet",
      effort: "low",
      schema: BLOCK_SCHEMA,
    }
  );

  // The narrative is only half the outcome. Without this the issue keeps
  // reading `agent:in-progress` and a human reads the failure as a success.
  const labelState = await settleLabels(track, "agent:blocked", {
    phase: "Verify",
  });
  if (!labelState.settled)
    log(
      `🚨 ${track.id} is blocked but its label did NOT settle after ${labelState.attempts} attempt(s): ` +
        `issue(s) ${labelState.missing.join(", ")} still do not read agent:blocked. ` +
        `Fix them by hand — the board is currently lying about this track.`
    );
  return {
    track,
    status: "blocked",
    reason,
    lastReport,
    labelState,
    survivingTrees: trees,
  };
}

/**
 * Cut — or resume — the track's branch and worktree before any workstream runs.
 *
 * Deterministic on purpose. Every workstream in every stage branches from the
 * TRACK branch — that is what makes stage N+1 start from stage N's commits
 * instead of from `main` — so the track branch has to exist before stage 0, not
 * as a side effect of whichever agent happened to go first.
 *
 * Two paths, because a held or blocked track KEEPS its branch and worktree (see
 * the exit hygiene in dod.md) and re-running it is the whole point of keeping
 * them:
 *
 *   FRESH  — no such branch. Cut from `BASE` and assert head === base, because
 *            a newly cut branch IS its base commit and anything else means it
 *            came from something older.
 *   RESUME — the branch exists and carries prior work, so head can NEVER equal
 *            base once main has moved. Merging `BASE` in and asserting that
 *            `BASE` is an ANCESTOR of HEAD is the same guarantee restated for a
 *            branch with commits on it: nothing is ever built or validated on a
 *            base behind origin/main. Asserting equality here instead would make
 *            preserved work permanently unresumable — the guard would reject
 *            exactly the artifact the hand-over exists to preserve.
 *
 * A conflicting update stops the track cleanly with the conflicted paths named.
 * It is never auto-resolved and the preserved work is never discarded: a
 * conflict is two intents disagreeing, and picking one is a human's call.
 */
async function prepareTrack(track, branch, wt) {
  const ready = await agent(
    `Prepare an isolated build tree. This is either a FRESH cut or a RESUME of preserved work — establish which FIRST. Run exactly this, in this order, and nothing that writes code:

1. \`git fetch origin --prune\` — FIRST, always. \`${BASE}\` is a remote-tracking ref, and an unfetched one is whatever this checkout last saw.
2. \`git rev-parse --verify --quiet refs/heads/${branch}\` — does this track's branch already exist?

   **It does NOT → FRESH.** \`git worktree add -b ${branch} ${wt} ${BASE}\`
   Cut from \`${BASE}\`, never from the local branch of the same name. The local ref is whatever the human's checkout last pulled; the remote tip is what this track's PR will merge into. A track cut from a stale local \`main\` builds against files that have already changed and lands on \`mergeStateStatus: BEHIND\`. Report \`resumed: false\`.

   **It DOES → RESUME.** A held or blocked track kept this branch and worktree on purpose — they hold the only copy of that work. Do NOT re-cut it, do NOT reset it, do NOT delete anything.
     a. If ${wt} is gone but the branch is not, re-attach it: \`git worktree add ${wt} ${branch}\` (no \`-b\`).
     b. Bring it up to date instead of re-cutting it: \`git -C ${wt} merge --no-edit ${BASE}\`. This fast-forwards when the branch has no commits of its own.
     c. If that merge stops on conflicts, do NOT resolve them. Capture \`git -C ${wt} diff --name-only --diff-filter=U\` FIRST, then \`git -C ${wt} merge --abort\`, and return \`ready: false\`, \`conflicted: true\` and every captured path in \`conflictedFiles\`. The abort leaves the preserved work exactly as it was, which is the point.
   Report \`resumed: true\`.
3. \`scripts/worktree-env.sh ${wt}\` — give it a test env. It is idempotent; read its header for what it does and why. A fresh worktree has no \`.env.local\`, so \`pnpm test\` fails every DB suite until you run it — do not improvise your own env file.

Then report, VERBATIM, what each of these printed:
  - \`git -C ${wt} rev-parse --abbrev-ref HEAD\` → \`branch\`
  - \`git -C ${wt} rev-parse HEAD\` → \`headSha\`
  - \`git rev-parse ${BASE}\` → \`baseSha\`
  - \`git -C ${wt} merge-base --is-ancestor ${BASE} HEAD && echo yes || echo no\` → \`baseIsAncestor\` (\`yes\` ⇒ true)

The loop checks these rather than trusting you: a FRESH cut must have headSha == baseSha, and a RESUME must have baseIsAncestor true — \`${BASE}\` contained in this branch's history is what "not building on a stale base" means once the branch carries commits of its own. Transcribe what you saw rather than what you expect. Return strictly the schema.`,
    {
      label: `prep:${track.id}`,
      phase: "Build",
      // Two git commands and a script. Cheap is safe here because the next step
      // fails loudly if the tree is not there — unlike the claim step, this
      // writes nothing shared.
      model: "haiku",
      effort: "low",
      schema: {
        type: "object",
        required: ["ready", "branch", "headSha", "baseSha"],
        properties: {
          ready: { type: "boolean" },
          branch: { type: "string" },
          resumed: {
            type: "boolean",
            description:
              "true if the branch already existed and was updated rather than cut",
          },
          headSha: {
            type: "string",
            description: "`git -C <wt> rev-parse HEAD`, verbatim",
          },
          baseSha: {
            type: "string",
            description: "`git rev-parse <base>`, verbatim",
          },
          baseIsAncestor: {
            type: "boolean",
            description:
              "`git -C <wt> merge-base --is-ancestor <base> HEAD` succeeded",
          },
          conflicted: {
            type: "boolean",
            description:
              "the update merge stopped on conflicts and was aborted",
          },
          conflictedFiles: {
            type: "array",
            items: { type: "string" },
            description: "`git diff --name-only --diff-filter=U`, verbatim",
          },
          note: { type: "string" },
        },
      },
    }
  );

  // Checked before `ready`, because a conflicted resume reports ready:false and
  // "the worktree is not on the branch" would describe it wrongly — and would
  // send the human looking for a broken tree instead of a decision.
  if (ready?.conflicted === true)
    return {
      ok: false,
      reason:
        `${branch} carries preserved work and ${BASE} does not merge into it cleanly — conflicts in ` +
        `${(ready.conflictedFiles || []).join(", ") || "(no files reported)"}. The merge was ABORTED, so the branch and ${wt} ` +
        `still hold that work untouched; nothing was discarded and nothing was auto-resolved. ` +
        `Resolve it by hand with \`.claude/skills/resolving-merge-conflicts/SKILL.md\` in ${wt}, then re-run this track.`,
    };

  if (ready?.ready !== true || ready.branch !== branch)
    return { ok: false, reason: `the worktree ${wt} is not on ${branch}` };

  // Both anchors are the same invariant — never build on a base behind
  // origin/main — measured the only way each path allows.
  const head = String(ready.headSha || "").trim();
  const base = String(ready.baseSha || "").trim();
  if (!head || !base)
    return {
      ok: false,
      reason:
        `prep did not report both shas (${branch} at ${head || "(none)"}, ${BASE} at ${base || "(none)"}) — ` +
        `an unverifiable base is treated as a stale one.`,
    };

  if (ready.resumed === true) {
    if (ready.baseIsAncestor !== true)
      return {
        ok: false,
        reason:
          `${branch} was resumed at ${head} but ${BASE} (${base}) is NOT an ancestor of it — the update did not take, ` +
          `so this branch is missing commits that are already on main and would be built and validated against files that have changed. ` +
          `Merge ${BASE} into ${branch} in ${wt}, then re-run this track. Do NOT delete the branch or the worktree: they hold the preserved work.`,
      };
  } else if (head !== base)
    return {
      ok: false,
      reason:
        `${branch} was cut from ${head} but ${BASE} is at ${base} — ` +
        `a stale base builds against files that have already changed and lands the PR BEHIND main. ` +
        `Fetch and re-cut the branch, or rebase it onto ${BASE}.`,
    };

  return { ok: true };
}

/**
 * The #307 root-cause preamble, rendered by the PARENT and prepended verbatim
 * by every recipe (ruling mod 2: the lesson never moves into recipe files).
 * The evidence is quoted VERBATIM via evidenceBlock — a paraphrase is where a
 * named `ReferenceError` becomes "the page does not render".
 */
function renderRetryBlock(report, branch, wt) {
  return `The branch ${branch} and worktree ${wt} already exist with the prior work. A verifier REJECTED it. Fix ONLY what is needed.

**THE ROOT CAUSE IS BELOW, IN THE VERIFIER'S OWN WORDS. Read it before you open a file.**

\`\`\`
${evidenceBlock(report)}
\`\`\`

Start from that named cause and reproduce it yourself — run the thing the evidence describes and see the failure before you change anything. Do not start from what looks wrong to you: on #307 three attempts fixed a stuck button and a flaky test while the \`ReferenceError\` the verifier had named crashed the page on every one of them, and the track was blocked with the cause untouched.

Your result MUST answer it:
- \`rootCause\` — the cause NAMED above, restated in your own words.
- \`rootCauseAddressed\` — what you changed so that cause is gone, and the command output proving it.

Nothing else you did counts until those two are filled in — the loop rejects the attempt without even calling a verifier if they are empty. If you could NOT fix the named cause, say that in \`rootCauseAddressed\` and why; an honest miss is worth more than a fix report for something else.`;
}

// The recipe side-effect detector's transcript shape (ruling mod 4).
const REFS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["refs"],
  properties: {
    refs: {
      type: "array",
      items: {
        type: "object",
        required: ["ref", "sha"],
        properties: {
          ref: {
            type: "string",
            description: "the full ref path, exactly as printed",
          },
          sha: { type: "string", description: "the sha, exactly as printed" },
        },
      },
    },
    note: { type: "string" },
  },
};

/**
 * Transcribe `git ls-remote --heads origin <branches>` before and after a
 * recipe runs. Any new, moved or deleted origin ref between the two snapshots
 * is a recipe-contract violation and a failed attempt (ruling mod 4).
 * Cheap-model-safe because the parent compares the transcripts — the agent
 * only copies what the command printed.
 */
async function snapshotRefs(label, branches) {
  const reply = await agent(
    `Transcribe remote ref state. Run exactly this, and nothing that writes:
\`git ls-remote --heads origin ${branches.join(" ")}\`
Report every output line VERBATIM as a {ref, sha} row — the full ref path as printed, the sha as printed. Empty output is a real answer: return an empty refs array. Do NOT push, do NOT fetch --prune, do NOT edit anything. Return strictly the schema.`,
    {
      label,
      phase: "Build",
      model: "haiku",
      effort: "low",
      schema: REFS_SCHEMA,
    }
  );
  return (reply?.refs || []).map((r) => `${r.sha} ${r.ref}`).sort();
}

/**
 * Cut a non-solo workstream's worktree from the TRACK branch — a parent-owned
 * step (#399): under the recipe contract the worktree is a parent-provided
 * input, never something the recipe creates for itself. Solo workstreams keep
 * the track worktree and never come here.
 */
async function prepareWorkstreamTree(ws, trackBranch) {
  const ready = await agent(
    `Prepare the worktree for ONE workstream of a staged track. Run exactly this, in this order, and nothing that writes code:

1. \`git worktree add -b ${ws.branch} ${ws.wt} ${trackBranch}\`
   Cut from the TRACK branch, never from ${BASE}: the track branch already carries every earlier stage's commits, and cutting anywhere else silently drops the prerequisite this workstream was ordered after. If the branch already exists from an earlier attempt, re-attach instead of re-cutting: \`git worktree add ${ws.wt} ${ws.branch}\` (no \`-b\`), do NOT reset it, and report \`resumed: true\`.
2. \`scripts/worktree-env.sh ${ws.wt}\` — give it a test env. It is idempotent; a fresh worktree has no \`.env.local\`, so \`pnpm test\` fails every DB suite until you run it.

Then report, VERBATIM, what each of these printed:
  - \`git -C ${ws.wt} rev-parse --abbrev-ref HEAD\` → \`branch\`
  - \`git -C ${ws.wt} rev-parse HEAD\` → \`headSha\`
  - \`git rev-parse ${trackBranch}\` → \`trackSha\`

The loop asserts the branch and the cut point rather than trusting you — a fresh cut IS the track tip, and anything else means it came from somewhere older. Transcribe what you saw. Return strictly the schema.`,
    {
      label: `tree:${ws.id}`,
      phase: "Build",
      // Two git commands and a script, asserted below — same reasoning as prep.
      model: "haiku",
      effort: "low",
      schema: {
        type: "object",
        required: ["ready", "branch", "headSha", "trackSha"],
        properties: {
          ready: { type: "boolean" },
          branch: { type: "string" },
          resumed: {
            type: "boolean",
            description:
              "true if the branch already existed and was re-attached rather than cut",
          },
          headSha: {
            type: "string",
            description: "`git -C <wt> rev-parse HEAD`, verbatim",
          },
          trackSha: {
            type: "string",
            description: "`git rev-parse <trackBranch>`, verbatim",
          },
          note: { type: "string" },
        },
      },
    }
  );

  if (ready?.ready !== true || ready.branch !== ws.branch)
    return {
      ok: false,
      reason: `the worktree ${ws.wt} is not on ${ws.branch}`,
    };
  const head = String(ready.headSha || "").trim();
  const tip = String(ready.trackSha || "").trim();
  if (!head || !tip)
    return {
      ok: false,
      reason: `tree prep for ${ws.id} did not report both shas (HEAD ${head || "(none)"}, ${trackBranch} ${tip || "(none)"}) — an unverifiable cut point is treated as a wrong one`,
    };
  if (ready.resumed !== true && head !== tip)
    return {
      ok: false,
      reason: `${ws.branch} was cut at ${head} but ${trackBranch} is at ${tip} — a workstream cut anywhere but the track tip silently drops the prerequisite stages`,
    };
  return { ok: true };
}

/**
 * One workstream: implement → SCOPED verify → retry, with its own attempt budget.
 *
 * The attempt counter living here rather than on the track is the point. It used
 * to be per track, so one flaky unit re-ran the entire implementation and burned
 * all three attempts for every healthy unit beside it.
 *
 * `solo` means this workstream is the only one in its stage, so it works directly
 * in the track worktree on the track branch — no sub-worktree and no merge for
 * the common case of a stage that is one piece of work.
 */
async function runWorkstream(
  track,
  ws,
  { stageIndex, trackBranch, trackWt, priorReport = null }
) {
  const solo = ws.solo;
  const branch = solo ? trackBranch : `feature/${ws.id}`;
  const wt = solo ? trackWt : `.claude/worktrees/bud-${ws.id}`;
  const implAgent = ws.lane === "backend" ? "backend" : "frontend";
  // Recorded on the workstream so a held or blocked exit can hand the tree over
  // by name, whether or not this workstream ever finished.
  ws.branch = branch;
  ws.wt = wt;
  // A re-run ordered by the INTEGRATION verifier is a retry too. It used to
  // arrive here as attempt 1 with no report, so the implementer was handed the
  // first-attempt prompt and never saw the failure it was sent back to fix.
  let report = priorReport;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (budget.total && budget.remaining() < RESERVE)
      return {
        ok: false,
        ws,
        branch,
        report,
        reason: `token reserve hit before ${ws.id} attempt ${attempt} (remaining ${Math.round(budget.remaining() / 1000)}k < ${Math.round(RESERVE / 1000)}k)`,
      };

    // A retry is defined by having a verdict to answer, not by the counter —
    // an integration failure sent back to this workstream arrives on attempt 1.
    const isRetry = Boolean(report);

    // The worktree is a parent-provided input, not something a recipe cuts for
    // itself (#399). A non-solo workstream gets its tree here, once, before
    // its first attempt; solo workstreams keep the track worktree.
    if (attempt === 1 && !solo) {
      const tree = await prepareWorkstreamTree(ws, trackBranch);
      if (!tree.ok)
        return { ok: false, ws, branch, report, reason: tree.reason };
    }

    // -----------------------------------------------------------------------
    // The recipe seam (#399): one child workflow call = one workstream
    // attempt. The recipe gets a worktree, the structured priorReport (ruling
    // mod 1 — never a flattened string), and the parent-rendered retryBlock
    // (mod 2 — the #307 lesson never moves into recipe files). It must commit
    // to `branch` and return {summary, commits, warnings} (+rootCause,
    // rootCauseAddressed on retries, mod 3). It must NOT push, open PRs, edit
    // labels/issues, merge elsewhere, or call workflow(). The ref snapshots
    // around it are the side-effect detector (mod 4).
    // -----------------------------------------------------------------------
    const watchedRefs = [...new Set([branch, trackBranch])];
    const before = await snapshotRefs(
      `refs:${ws.id}#${attempt}:before`,
      watchedRefs
    );

    const impl = await workflow(
      { scriptPath: `.claude/workflows/recipes/${ws.recipe}.js` },
      {
        track: { id: track.id, issues: track.issues, branch: trackBranch },
        workstream: {
          id: ws.id,
          lane: ws.lane,
          issues: ws.issues,
          files: ws.files,
          summary: ws.units.map((u) => u.summary).join("; "),
          units: ws.units,
        },
        worktree: wt,
        branch,
        stageIndex,
        attempt,
        priorReport: report ?? null,
        retryBlock: isRetry ? renderRetryBlock(report, branch, wt) : null,
        conventions: CONVENTIONS,
        implAgentType: implAgent,
        unitBlocksRendered: unitBlocks(ws),
        declaredFiles: ws.files,
      }
    );

    const after = await snapshotRefs(
      `refs:${ws.id}#${attempt}:after`,
      watchedRefs
    );
    const drift = [
      ...after.filter((x) => !before.includes(x)),
      ...before.filter((x) => !after.includes(x)),
    ];
    if (drift.length) {
      report = {
        verdict: "FAIL",
        failingGate: "recipe-contract",
        fixInstructions:
          `The recipe changed origin refs it must never touch: ${drift.join("; ")}. ` +
          `Recipes MUST NOT push, open PRs, or move any remote ref — the guarantee layer publishes. ` +
          `This attempt is refused without a verifier.`,
        summary: `${ws.id}: recipe "${ws.recipe}" violated the side-effect contract (origin refs changed)`,
      };
      log(
        `⛔ ${ws.id} attempt ${attempt}: recipe-contract violation — origin refs drifted (${drift.join("; ")})`
      );
      continue;
    }

    if (!impl || !(impl.commits || []).length) {
      report = {
        verdict: "FAIL",
        failingGate: "recipe",
        fixInstructions: !impl
          ? `the recipe returned nothing on attempt ${attempt}`
          : `the recipe returned no commits on attempt ${attempt} — an attempt that committed nothing built nothing`,
        summary: `${ws.id}: recipe "${ws.recipe}" returned ${!impl ? "nothing" : "no commits"}`,
      };
      continue;
    }

    // The root cause is answered BEFORE anything else counts — including before
    // a verifier is spent on the attempt. A fix that cannot say what it did
    // about the named cause is the #307 shape, and running the gates on it only
    // buys another confident FAIL two hundred thousand tokens later.
    if (isRetry && !String(impl.rootCauseAddressed || "").trim()) {
      const named = report?.failingGate || "the failing gate";
      log(
        `↩️  ${ws.id} attempt ${attempt}: the fix did not say how it addressed ${named} — refusing it before the verifier`
      );
      report = {
        ...report,
        verdict: "FAIL",
        failingGate: report?.failingGate || "root-cause",
        fixInstructions:
          `Your last attempt did not report \`rootCauseAddressed\`, so it is not a fix — it is a change. ` +
          `The cause named below is still the only thing that matters; answer it explicitly this time.\n\n` +
          (report?.fixInstructions || ""),
        summary: `${ws.id}: fix attempt ${attempt} left the named root cause unanswered`,
      };
      continue;
    }

    // Scoped verify: only the gates that can honestly be scoped to a subset of
    // the branch. G1 and G3 are integration-only by nature — see SCOPED_DOD_SCHEMA.
    const scoped = await agent(
      `You are the INDEPENDENT verifier for ONE WORKSTREAM of a larger track. Read \`ops/agent-os/dod.md\` — in particular the scoped-vs-integration split. Validate branch ${branch} in worktree ${wt} for issue(s) ${hashes(ws.issues)}.

Run ONLY these gates. The others (G1 hermetic build, G3 functional/preview, G4, G6, and any HR gates) run ONCE at integration on the whole track branch — running them here would cost N times and prove nothing extra:

- **G0** — every acceptance criterion below has a declared verification method; the issue has a \`feature\` parent (read it with \`gh issue view <n> --json parent --jq .parent\`, the GraphQL-backed form — the REST \`issues/<n>\` \`parent\` field returns \`null\` even when a parent exists, so an agent that reads it there reports a false orphan); no blocker outside this track is open. A dependency on another unit of THIS track is satisfied by that stage already being committed on the branch you are standing on, not by its issue being closed.
- **G2-subset** — run the tests that cover this workstream's files (\`pnpm test <paths>\`). If the worktree has no \`.env.local\`, run \`scripts/worktree-env.sh ${wt}\` first and re-run; a missing env is a harness problem, not a test failure, and reporting it as one blames the workstream for the harness.
- **G5** — diff hygiene against THIS workstream's declared files only. Compute it, do not recall it:
  \`git diff --name-only $(git merge-base ${trackBranch} HEAD)...HEAD\`
  Note the base is the TRACK branch, not \`origin/main\`: earlier stages are already on the track branch, and diffing against main would report every one of their files as this workstream's deviation.
  Declared files: ${ws.files.join(", ") || "(none declared)"}

Acceptance criteria to prove:
${allCriteria(ws)}

Default to FAIL when evidence is missing or unconvincing. Do NOT fix the code — report, and the implementer fixes. Return strictly the schema.`,
      {
        label: `verify:${ws.id}#${attempt}`,
        phase: "Verify",
        agentType: "code-reviewer",
        schema: SCOPED_DOD_SCHEMA,
      }
    );
    report = scoped;
    if (!scoped) continue;
    if (scoped.verdict === "FAIL") {
      log(
        `❌ ${ws.id} attempt ${attempt}: ${scoped.failingGate || "FAIL"} — retrying`
      );
      continue;
    }
    return { ok: true, ws, branch, wt, report: scoped, attempts: attempt };
  }

  return {
    ok: false,
    ws,
    branch,
    report,
    reason: `${ws.id} did not pass its scoped gates in ${MAX_ATTEMPTS} attempts`,
  };
}

/**
 * One stage: its workstreams in parallel, then merged back onto the track branch.
 *
 * Fail-closed, one level below where the guard used to sit. `parallel()` resolves
 * a thunk that threw to null, so a workstream whose agent died comes back as a
 * hole — and a hole inside a stage that otherwise passed would let the track ship
 * with a piece of itself silently missing. That is the same failure the run-level
 * fan-in guard exists to catch; it needs to exist here too.
 */
async function runStage(track, stage, stageIndex, trackBranch, trackWt) {
  const solo = stage.length === 1;
  const need = RESERVE * stage.length;
  if (budget.total && budget.remaining() < need)
    return {
      ok: false,
      reason: `token reserve hit before stage ${stageIndex}: ${stage.length} workstream(s) need ${Math.round(need / 1000)}k, ${Math.round(budget.remaining() / 1000)}k left`,
    };

  log(
    `🔨 ${track.id} stage ${stageIndex}: ${stage.length} workstream(s)${solo ? "" : " in parallel"}`
  );
  for (const ws of stage) {
    ws.solo = solo;
    // Named up front, not on success: a workstream that dies still leaves a
    // tree, and the exit comment has to be able to hand it over.
    ws.branch = solo ? trackBranch : `feature/${ws.id}`;
    ws.wt = solo ? trackWt : `.claude/worktrees/bud-${ws.id}`;
  }

  const results = await boundedParallel(
    stage.map(
      (ws) => () =>
        runWorkstream(track, ws, { stageIndex, trackBranch, trackWt })
    )
  );
  const settled = stage.map(
    (ws, i) =>
      results[i] ?? {
        ok: false,
        ws,
        died: true,
        reason: `${ws.id} returned no result (its agent died or the budget threw) — nothing was built for it and nothing said so`,
      }
  );

  const failed = settled.filter((r) => !r.ok);
  if (failed.length)
    return {
      ok: false,
      reason: `stage ${stageIndex} failed: ${failed.map((f) => f.reason).join("; ")}`,
      report: failed.find((f) => f.report)?.report || null,
    };

  if (solo) return { ok: true, results: settled };

  // Merge the stage's parallel branches back onto the track branch. This is the
  // one place in the loop where a real conflict is possible, because two agents
  // wrote in separate worktrees.
  const integrated = await agent(
    `Integrate a stage of parallel work onto its track branch.

In the worktree ${trackWt} (on branch ${trackBranch}), merge each of these branches in the order given:
${settled.map((r) => `  - ${r.branch}`).join("\n")}

For each: \`git -C ${trackWt} merge --no-ff <branch>\`.

These branches were written concurrently against declared-disjoint file sets, so a clean merge is the expected outcome. If one DOES conflict, the file sets were wrong — use the \`resolving-merge-conflicts\` skill (.claude/skills/resolving-merge-conflicts/SKILL.md) and resolve by intent, tracing each side to what its workstream was asked to do. Never resolve by taking one side wholesale to make the conflict go away.

After every merge, run \`pnpm typecheck\` in ${trackWt}. Two individually-correct workstreams can still contradict each other, and this is the first moment that is visible.

Report which branches merged and which did not. A branch you could not merge cleanly and could not resolve belongs in \`conflicts\`, with the reason — do not report it as merged. Return strictly the schema.`,
    {
      label: `integrate:${track.id}#s${stageIndex}`,
      phase: "Build",
      agentType: "backend",
      schema: INTEGRATE_SCHEMA,
    }
  );

  const wanted = settled.map((r) => r.branch);
  const merged = integrated?.merged || [];
  const missing = wanted.filter((b) => !merged.includes(b));
  if (missing.length)
    return {
      ok: false,
      reason: `stage ${stageIndex} did not integrate: ${missing.join(", ")} ${integrated?.conflicts?.length ? `(${integrated.conflicts.join("; ")})` : "were never reported merged"}`,
      report: null,
    };

  log(
    `🔗 ${track.id} stage ${stageIndex} integrated ${merged.length} branch(es)`
  );
  return { ok: true, results: settled };
}

/**
 * Fold code-quality warnings into the parent feature's follow-up rollup, then
 * READ THE BODY BACK and assert every line landed.
 *
 * Same shape as settleLabels, for the same reason: the agent reports what
 * `gh issue view --json body` printed, the loop compares that against what it
 * asked for, and an unconfirmed write is an error rather than a footnote. The
 * pre-merge ordering guarantee is unchanged — only the destination moved from
 * one-issue-per-warning to one rollup per parent.
 */
async function foldFollowUps(track, warnings, pr) {
  const wanted = warnings.map(
    (w) =>
      `- [ ] ${w.summary}${w.files?.length ? ` (${w.files.join(", ")})` : ""}`
  );
  let followUps = [];

  for (let attempt = 1; attempt <= LABEL_ATTEMPTS; attempt++) {
    const reply = await agent(
      `Record ${warnings.length} code-quality finding(s) from PR ${pr.url} on the parent feature's follow-up rollup. They must be recorded BEFORE the merge, so a merge cannot lose them.
${
  attempt > 1
    ? `\nATTEMPT ${attempt}: a previous attempt did not land. These lines were NOT found in the body afterwards:\n${
        followUps
          .filter((f) => !f.confirmed)
          .map((f) => `  ${f.anchor}`)
          .join("\n") || "  (nothing was reported at all)"
      }\nRe-apply those and read the body back again.\n`
    : ""
}
1. **Find the parent.** \`gh issue view ${track.issues[0]} --json parent --jq .parent\` — the GraphQL-backed read, which is the ONLY one that works. Do NOT read the REST field (\`gh api repos/{owner}/{repo}/issues/<n> --jq .parent\`): it returns \`null\` on issues that demonstrably have a parent, and an agent that trusts it concludes the issue is an orphan. Platform work with no FRD may genuinely have none — in that case use the track's own issue as the anchor and say so in \`note\`.

2. **Find or create the rollup.** One open issue per parent, titled exactly \`Follow-ups — <parent title>\`, labelled \`follow-ups\`. Search before creating: \`gh issue list --state open --label follow-ups --limit 200 --search "<parent title> in:title"\`. If it does not exist, create it with \`--label follow-ups --parent <parent>\` and a body that opens with a \`## Follow-up acceptance criteria\` heading. Do NOT give a new rollup any \`agent:*\` label yet — step 4 decides that.

3. **Append**, under \`## Follow-up acceptance criteria\`, exactly these lines — verbatim, one per line, preserving the leading \`- [ ] \`:
${wanted.map((l) => `   ${l}`).join("\n")}
   Then, beneath each, an indented detail line naming ${pr.url} and:
${warnings.map((w) => `   - ${w.summary} → ${w.detail || "(no detail given)"}`).join("\n")}
   Append — never replace the body. Read the current body, add to it, write it back with \`gh issue edit <n> --body-file\`. Clobbering someone else's follow-ups to add yours is worse than failing.

4. **Takeability.** Count the \`- [ ]\` items under that heading AFTER your append. If there are **3 or more**, the rollup becomes takeable: \`gh issue edit <n> --add-label agent:queued\`. Below 3 it carries NO \`agent:*\` label and waits — dispatch picks it up with the parent's next track regardless of count.

5. **READ IT BACK.** \`gh issue view <n> --json body --jq .body\` and \`gh issue view <n> --json labels --jq '[.labels[].name]'\`. For each line you appended, set \`confirmed\` true ONLY if you can see that exact line in what the command printed. Report what you saw, not what you intended — the loop compares your report against what it asked for, and a false confirmation is worse than a failed write because it makes lost findings look recorded.

Return strictly the schema.`,
      {
        label: `follow-ups:${track.id}#${attempt}`,
        phase: "Ship",
        // Same tier as the merge node: this writes durable state that a merge
        // then makes permanent, and it is the last chance to not lose a finding.
        model: "opus",
        effort: "low",
        schema: FOLLOWUP_SCHEMA,
      }
    );

    followUps = reply?.followUps || [];
    const missing = wanted.filter(
      (line) =>
        !followUps.some(
          (f) => f.confirmed && f.anchor && line.includes(f.anchor.trim())
        ) && !followUps.some((f) => f.confirmed && f.anchor === line)
    );
    if (!missing.length)
      return { settled: true, followUps, attempts: attempt, missing: [] };

    log(
      `📝 ${track.id} follow-up fold did not stick on attempt ${attempt}/${LABEL_ATTEMPTS} — ${missing.length} finding(s) unconfirmed`
    );
    if (attempt === LABEL_ATTEMPTS)
      return { settled: false, followUps, attempts: attempt, missing };
  }
  return {
    settled: false,
    followUps,
    attempts: LABEL_ATTEMPTS,
    missing: wanted,
  };
}

async function buildTrack(track) {
  const branch = `feature/${track.id}`;
  const wt = `.claude/worktrees/bud-${track.id}`;
  let lastReport = null;
  let followUps = [];
  // True when the last assembly repair changed things without answering the
  // root cause it was handed. The next repair prompt is told.
  let repairDodged = false;

  // Claim this track's issues — and ONLY this track's issues.
  //
  // On 2026-07-26 this step swept the entire `agent:queued` label, claiming 35
  // issues for a 2-unit pass and jamming dispatch's "nothing in flight" gate
  // (board-design-2026-07.md §11). The prompt was already scoped to
  // `track.issues`; a cheap model still enumerated the label and "helpfully"
  // claimed the frontier. The old comment here read "No judgment involved",
  // which is precisely the assumption that failed — so the blast radius is now
  // asserted rather than assumed.
  if (track.issues.length) {
    const claim = await agent(
      `Label EXACTLY these issues and no others: ${track.issues.join(", ")}

For each number n in that list, run:
\`gh issue edit n --remove-label agent:queued --add-label agent:in-progress\`

HARD CONSTRAINTS — violating any of these corrupts the board:
- Do NOT run \`gh issue list\`, \`gh search\`, or anything else that enumerates issues by label in order to decide what to edit. The list above is the complete and only input.
- Do NOT edit any issue outside that list, even if it looks queued, unblocked, ready, or related.
- The number of issues you edit must be exactly ${track.issues.length}.

Then, purely to report state, run ONCE:
\`gh issue list --state open --label agent:in-progress --limit 200 --json number --jq '[.[].number]'\`

Return {"claimed": [the numbers you edited], "inProgressNow": [every number that last command printed]}.`,
      {
        label: `start:${track.id}`,
        phase: "Build",
        model: "haiku",
        effort: "low",
        schema: CLAIM_SCHEMA,
      }
    );

    const strays = (claim?.inProgressNow || []).filter(
      (n) => !PASS_ISSUES.includes(n)
    );
    if (strays.length)
      throw new Error(
        `claim step overreached: ${strays.length} issue(s) carry agent:in-progress that this pass does not own (${strays.join(", ")}). ` +
          `This pass owns ${PASS_ISSUES.join(", ") || "(none)"}. Aborting ${track.id} rather than building against a corrupted board. ` +
          `Revert the strays to agent:queued, then re-run. (If a human is genuinely mid-flight on an unrelated issue, that is what dispatch's gate 2 exists to catch before this point.)`
      );
  }

  // -------------------------------------------------------------------------
  // Build the track, one stage at a time.
  //
  // Stage 0 is the shared prerequisite; later stages fan out. Each stage's
  // workstreams run in parallel and are merged onto the track branch before the
  // next stage starts, so a stage always begins from everything that came before
  // it. A stage that cannot finish blocks the track — it never proceeds to the
  // next one with a hole in the branch.
  // -------------------------------------------------------------------------
  // Every exit below hands this over (held/blocked) or clears it (merged).
  const trees = () => survivingTrees(track, branch, wt);

  const prep = await prepareTrack(track, branch, wt);
  if (!prep.ok)
    return blockTrack(
      track,
      `could not prepare the track worktree ${wt} on ${branch}: ${prep.reason}`,
      null,
      trees()
    );

  const wsOutcomes = [];
  for (const [stageIndex, stage] of track.stages.entries()) {
    const stageResult = await runStage(track, stage, stageIndex, branch, wt);
    if (!stageResult.ok)
      return blockTrack(track, stageResult.reason, stageResult.report, trees());
    wsOutcomes.push(...stageResult.results);
  }

  const byWorkstream = new Map(wsOutcomes.map((r) => [r.ws.id, r]));

  // -------------------------------------------------------------------------
  // Integration verify — the expensive gates, once, on the assembled branch.
  //
  // G1 (hermetic build) is repo-wide and G3 needs a preview deployment that only
  // exists per branch, so neither can be scoped to a workstream. Running them
  // here instead of N times is the entire throughput argument for staging.
  //
  // A failure that names a workstream is sent back to THAT workstream and spends
  // ITS attempt. Only an unattributable failure spends a track-level one.
  // -------------------------------------------------------------------------
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (budget.total && budget.remaining() < RESERVE)
      return blockTrack(
        track,
        `token reserve hit before integration attempt ${attempt} (remaining ${Math.round(budget.remaining() / 1000)}k < reserve ${Math.round(RESERVE / 1000)}k)`,
        lastReport,
        trees()
      );

    // -----------------------------------------------------------------------
    // The guarantee tail — ONE child workflow call per integration attempt.
    //
    // verify-and-ship.js owns: push + sha assert (no verifier runs until
    // HEAD == origin/<branch> is observed), the integration DoD, the G6
    // review-fix loop, HR4 lenses, the PR, the CI anchor, label settle, and
    // the auto-merge gate. It never calls workflow() — nesting is one level,
    // and this loop is the one parent. The two behaviors that only survive
    // HERE stay here: attempt accounting, and byWorkstream re-entry with
    // priorReport.
    // -----------------------------------------------------------------------
    const ship = await workflow(
      { scriptPath: ".claude/workflows/verify-and-ship.js" },
      {
        track: {
          id: track.id,
          issues: track.issues,
          risk: track.risk,
          hold: track.hold,
          lane: track.lane,
        },
        branch,
        wt,
        base: BASE,
        attempt,
        labelAttempts: LABEL_ATTEMPTS,
        autoMerge: AUTO_MERGE,
        conventions: CONVENTIONS,
        criteria: allCriteria(track),
        wsSummaries: wsOutcomes.map((r) => ({
          id: r.ws.id,
          issues: r.ws.issues,
          summary: r.report?.summary || "passed its scoped gates",
        })),
        wsIds: wsOutcomes.map((r) => r.ws.id),
        carriedFindings: wsOutcomes.flatMap(
          (r) => r.ws.unresolvedFindings || []
        ),
        survivingTrees: trees(),
      }
    );
    if (!ship) {
      log(
        `💥 ${track.id} attempt ${attempt}: verify-and-ship returned nothing (the child died) — counting the attempt`
      );
      continue;
    }
    lastReport = ship.report || lastReport;

    if (ship.outcome === "verify-failed") {
      const verify = ship.report;
      // Machinery-synthesized failures — a stale preview (G3/preview-sync), a
      // red CI check, an HR4 dissent, or a verifier that died (no report at
      // all) — retry the whole integration attempt, exactly as they did before
      // the extraction. Only a verifier-authored FAIL routes to attribution,
      // because only a verifier can name a failingWorkstream.
      const synthesized =
        !verify ||
        verify.failingGate === "G3/preview-sync" ||
        verify.failingGate === "CI" ||
        /^HR4\//.test(verify.failingGate || "");
      if (synthesized) continue;
      // Attributable → send it back to that workstream, which still has its own
      // attempts and its own worktree. Unattributable → the whole track retries.
      const owner = byWorkstream.get(verify.failingWorkstream);
      if (owner) {
        log(
          `❌ ${track.id} integration ${attempt}: ${verify.failingGate || "FAIL"} — attributed to ${owner.ws.id}, sending it back`
        );
        owner.ws.solo = true; // its branch is the track branch now: the stage merged
        const redo = await runWorkstream(track, owner.ws, {
          stageIndex: -1,
          trackBranch: branch,
          trackWt: wt,
          // The whole point of attributing the failure: the workstream that
          // gets it back must SEE it. Without this it restarted at attempt 1
          // with a blank prompt and re-derived the bug from scratch.
          priorReport: verify,
        });
        if (!redo.ok)
          return blockTrack(track, redo.reason, redo.report, trees());
        byWorkstream.set(owner.ws.id, redo);
        continue;
      }
      log(
        `❌ ${track.id} integration ${attempt}: ${verify.failingGate || "FAIL"} — not attributable to one workstream, retrying the assembly`
      );
      const repair = await agent(
        `The integration verifier REJECTED branch ${branch} (worktree ${wt}) for issue(s) ${hashes(track.issues)}, and the failure could not be attributed to a single workstream — it is a property of the assembled branch.
${repairDodged ? "\n**The previous repair did not report `rootCauseAddressed` — it changed things without saying what it did about the named cause, and the gate still fails. Do not repeat that.**\n" : ""}
**THE ROOT CAUSE IS BELOW, IN THE VERIFIER'S OWN WORDS. Read it before you open a file.**

\`\`\`
${evidenceBlock(verify)}
\`\`\`

Reproduce that named failure yourself before you change anything, and fix THAT. Your result must answer it: \`rootCause\` (the named cause in your own words) and \`rootCauseAddressed\` (what you changed, and the command output proving the cause is gone). The loop rejects an attempt that leaves those empty, whatever else it did — on #307 three attempts of plausible-looking work shipped the named crash unfixed every time.

Work in ${wt} on ${branch}. Fix ONLY what that requires. You are looking at the whole track, so a fix that spans two workstreams' files is legitimate here — that is exactly the kind of failure this step exists for. Run \`pnpm typecheck\` and \`pnpm lint\`, and commit (conventional commits). Do NOT push and do NOT open a PR. Return strictly the schema.`,
        {
          label: `repair:${track.id}#${attempt}`,
          phase: "Build",
          agentType: track.lane === "backend" ? "backend" : "frontend",
          schema: RETRY_IMPL_SCHEMA,
        }
      );
      if (!repair)
        return blockTrack(
          track,
          `integration repair agent died on attempt ${attempt}`,
          verify,
          trees()
        );
      // An unanswered root cause is carried into the NEXT repair prompt rather
      // than forgotten. The verifier is about to run again either way — the
      // point is that the second repair is told the first one dodged.
      repairDodged = !String(repair.rootCauseAddressed || "").trim();
      if (repairDodged)
        log(
          `↩️  ${track.id} attempt ${attempt}: the assembly repair did not say how it addressed ${verify.failingGate || "the failing gate"}`
        );
      continue;
    }

    if (ship.outcome === "delivery-failed")
      return {
        track,
        status: "pr-failed",
        reason: `the PR step did not open a PR (${ship.pr?.reason || "no reason given"})`,
        pr: ship.pr,
        report: ship.report,
        attempts: attempt,
        labelState: ship.labelState,
        survivingTrees: trees(),
      };

    if (ship.outcome === "errored")
      return {
        track,
        status: "errored",
        reason: `PR ${ship.pr?.url} is open and green, but agent:in-review could not be confirmed on issue(s) ${ship.labelState?.missing?.join(", ") || "(unreported)"} after ${ship.labelState?.attempts ?? "?"} attempt(s)`,
        pr: ship.pr,
        report: ship.report,
        warnings: ship.warnings || [],
        attempts: attempt,
        labelState: ship.labelState,
      };

    return {
      track,
      status: "shipped",
      pr: ship.pr,
      merge: ship.merge,
      warnings: ship.warnings || [],
      report: ship.report,
      attempts: attempt,
      labelState: ship.labelState,
      cleanup: ship.cleanup,
      unresolvedFindings: ship.unresolvedFindings || [],
      // A merged track leaves nothing; every other shipped outcome is held, and
      // a held track's trees belong to the reviewer named in its PR comment.
      survivingTrees: ship.merge?.state === "merged" ? [] : trees(),
    };
  }

  return blockTrack(
    track,
    `every workstream passed its scoped gates, but the assembled branch did not reach the integration DoD in ${MAX_ATTEMPTS} attempts`,
    lastReport,
    trees()
  );
}

phase("Build");
// Bounded here too: a pass of three tracks that each fan out to four workstreams
// is twelve agents, and the cap is on agents.
const results = await boundedParallel(
  tracks.map((t) => () => buildTrack(t)),
  Math.max(1, Math.min(tracks.length, MAX_CONCURRENT_AGENTS))
);

// ---------------------------------------------------------------------------
// Fan-in guard
//
// parallel() resolves a thunk that threw to null, so a track whose buildTrack
// died — an agent erroring out after retries, the token budget throwing mid-run
// — comes back as a hole. `.filter(Boolean)` then removes it from the report
// entirely, and the run ends looking tidy while a unit nobody mentioned simply
// never happened: no PR, no agent:blocked label, no alert. The count that went
// in must equal the count that comes out; anything else gets named, loudly.
// ---------------------------------------------------------------------------
const lost = tracks.filter((_, i) => !results[i]);
if (lost.length) {
  log(
    `🚨 FAN-IN GAP: launched ${tracks.length} track(s), ${results.length - lost.length} returned. ` +
      `${lost.length} vanished without a verdict: ${lost.map((t) => `${t.id} (issues ${t.issues.map((n) => `#${n}`).join(", ") || "none"})`).join("; ")}. ` +
      `These are NOT blocked and NOT shipped — their issues still read agent:in-progress and no one was told. Re-run them or take them manually.`
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const done = results.filter(Boolean);

// ---------------------------------------------------------------------------
// Label guard, at the fan-in.
//
// `shipped` is a claim about the BOARD, not only about the PR — labels.md makes
// the label canonical, so a track whose issue still reads `agent:in-progress`
// has not shipped in any sense a consumer can act on. buildTrack already
// refuses to return "shipped" without a verified read-back; this re-asserts it
// over the aggregate so no future edit can reintroduce the lie one layer up.
// ---------------------------------------------------------------------------
for (const r of done) {
  if (r.status !== "shipped") continue;
  const missing = r.labelState?.settled
    ? labelViolations(r.track.issues, r.labelState.observed, "agent:in-review")
    : r.track.issues;
  if (!missing.length) continue;
  log(
    `🚨 ${r.track.id} reported shipped while issue(s) ${missing.join(", ")} do not read agent:in-review — demoting to errored.`
  );
  r.status = "errored";
  r.reason =
    r.reason ||
    `shipped was claimed but issue(s) ${missing.join(", ")} were never confirmed on agent:in-review`;
}

const shipped = done.filter((r) => r.status === "shipped");
const blocked = done.filter((r) => r.status === "blocked");
// Separate from `blocked` because the human action is different: these passed
// every gate and only the push/PR call failed, so they want a retried delivery,
// not a code review. Folding them into `blocked` sent a reader to look for a
// failing gate that does not exist (`failingGate` came out undefined).
const deliveryFailed = done.filter((r) => r.status === "pr-failed");
// Neither shipped nor cleanly blocked: the work exists but the board cannot be
// trusted about it. Loud and separate, because it needs a hand, not a re-run.
const errored = done.filter((r) => r.status === "errored");
log(
  `Done: ${shipped.length} shipped (PR opened), ${blocked.length} blocked${deliveryFailed.length ? `, ${deliveryFailed.length} delivery-failed (DoD passed, no PR)` : ""}${errored.length ? `, ${errored.length} ERRORED (label unsettled)` : ""}${lost.length ? `, ${lost.length} LOST` : ""}.`
);
return {
  summary: `${shipped.length}/${tracks.length} tracks shipped to PR; ${blocked.length} blocked${deliveryFailed.length ? `; 📦 ${deliveryFailed.length} passed the DoD but failed to deliver` : ""}${errored.length ? `; 🚨 ${errored.length} errored with an unsettled label` : ""}${lost.length ? `; ⚠️ ${lost.length} lost without a verdict` : ""}.`,
  lost: lost.map((t) => ({
    track: t.id,
    issues: t.issues,
    reason:
      "track returned no result (agent died or the budget threw) — still labelled agent:in-progress",
  })),
  shipped: shipped.map((r) => ({
    track: r.track.id,
    issues: r.track.issues,
    workstreams: r.track.stages.reduce((n, s) => n + s.length, 0),
    stages: r.track.stages.length,
    pr: r.pr?.url,
    attempts: r.attempts,
    merge: r.merge?.state || (AUTO_MERGE ? "held-for-review" : "not-attempted"),
    // Not decoration: "shipped" is only true of the board if this is true.
    labelsConfirmed: r.labelState?.settled === true,
    // Where the code-quality warnings went, and whether the write was seen.
    followUps: (r.followUps || []).map((f) => ({
      issue: f.issue,
      kind: f.kind,
      anchor: f.anchor,
    })),
    heldBy: (r.warnings || [])
      .filter((w) => w.kind === "spec-question")
      .map((w) => w.summary),
    // Empty for a merged track (it cleaned up after itself); the reviewer's to
    // remove for a held one, and named in the PR comment as well as here.
    survivingWorktrees: (r.survivingTrees || []).map((t) => t.path),
  })),
  blocked: blocked.map((r) => ({
    track: r.track.id,
    issues: r.track.issues,
    reason: r.reason,
    failingGate: r.lastReport?.failingGate,
    labelSettled: r.labelState?.settled !== false,
    // The blocked work exists nowhere else — a re-run needs these by name.
    survivingWorktrees: (r.survivingTrees || []).map((t) => t.path),
  })),
  deliveryFailed: deliveryFailed.map((r) => ({
    track: r.track.id,
    issues: r.track.issues,
    // The work is committed here and nowhere else — a retry needs it by name.
    branch: `feature/${r.track.id}`,
    reason: r.reason,
    // Not a gate name: every gate passed. Naming the step that failed is what
    // stops this being read as a code failure.
    failingGate: "delivery",
    dodVerdict: r.report?.verdict,
    labelSettled: r.labelState?.settled !== false,
    survivingWorktrees: (r.survivingTrees || []).map((t) => t.path),
  })),
  errored: errored.map((r) => ({
    track: r.track.id,
    issues: r.track.issues,
    pr: r.pr?.url,
    reason: r.reason,
    unlabelledIssues: r.labelState?.missing || r.track.issues,
    observedLabels: r.labelState?.observed || [],
  })),
  nextStep:
    (errored.length
      ? `🚨 FIRST: ${errored.length} track(s) errored because their label could not be confirmed. Their PRs may be open and green while their issues still read agent:in-progress — set the labels by hand before reading anything else on the board, because until then the board is lying about them. `
      : "") +
    (AUTO_MERGE
      ? "Your queue is ONLY the held PRs — each is held because a warning raises a question about what should have been built, so it needs a ruling rather than a code review. Auto-merged PRs need no action; their code-quality warnings were folded into their parent's follow-up rollup, which becomes takeable at 3 items or with that parent's next track."
      : "Review the opened PRs (your queue).") +
    " For blocked issues, read the issue comment for the failing gate + evidence and decide: tighten the spec, raise budget (+Nk), or take it manually." +
    " Blocked and held tracks deliberately KEEP their worktrees — each exit comment names the path, the branch and what it holds, and `survivingWorktrees` repeats them here; merged tracks removed their own." +
    (deliveryFailed.length
      ? ` 📦 ${deliveryFailed.length} track(s) read agent:delivery-failed: they PASSED the DoD and only the push/PR step failed, so do NOT review or rebuild the code — push the named branch and open the PR. The issue comment has the delivery error.`
      : "") +
    (lost.length
      ? " ⚠️ FIRST: the lost tracks got no verdict and no issue comment — nothing told you about them except this field. Re-queue them (their issues are stuck on agent:in-progress)."
      : ""),
};
