export const meta = {
  name: "generate-and-filter",
  description:
    "Build recipe: N independent candidate implementations of one workstream attempt in throwaway candidate worktrees, an opus judge picks exactly one winner, and the winner lands on the workstream branch via ff-only merge.",
  whenToUse:
    "Child recipe of build-until-done only — never invoke directly. One call = one workstream attempt; dispatch selects it per unit (`recipe: generate-and-filter`) for units where solution shape is genuinely uncertain and independent sampling beats a single attempt. Costs ~3x implement-straight and counts as 3 agents against the concurrency cap. Contract: ops/agent-os/recipes.md.",
};

// ---------------------------------------------------------------------------
// Recipe contract (ops/agent-os/recipes.md): implement the unit(s), commit to
// `branch` in `worktree`, return { summary, commits, warnings } — plus
// { rootCause, rootCauseAddressed } when priorReport is set. MUST NOT push,
// open PRs, edit labels or issues, merge to any branch other than `branch`,
// or call workflow() — nesting is one level and build-until-done is the
// parent. The parent snapshots origin refs around this call and fails the
// attempt on any drift.
//
// Strategy: fan out CANDIDATES independent implementer agents, each in its own
// local scratch worktree on a `recipe/<ws.id>-cand<i>` branch cut from the
// workstream branch HEAD. A judge (opus, code-reviewer) diffs and tests every
// candidate and picks exactly ONE winner — or none. The winner reaches
// `branch` only via `merge --ff-only` (candidates are strictly ahead of the
// branch HEAD they were cut from, so the land is atomic or fails loudly; this
// recipe never creates a merge commit and never resolves conflicts). All
// scratch branches and worktrees are removed before return — the recipe
// asserts the `recipe/<ws.id>-*` listing is empty and refuses to report
// success over leftovers. Candidate diversity comes from independent agent
// sampling; candidate names are deterministic from args — no Math.random(),
// no Date.now() (the runtime throws on both).
// ---------------------------------------------------------------------------
const A = typeof args === "string" ? JSON.parse(args) : args;
if (!A || !A.workstream || !A.worktree || !A.branch)
  throw new Error(
    "generate-and-filter is a child recipe of build-until-done and takes recipeArgs: " +
      "{track, workstream, worktree, branch, stageIndex, attempt, priorReport, retryBlock, conventions, implAgentType, unitBlocksRendered, declaredFiles}"
  );

const workstream = A.workstream;
const worktree = A.worktree;
const branch = A.branch;
const attempt = A.attempt || 1;
const priorReport = A.priorReport ?? null;
const retryBlock = A.retryBlock || null;
const isRetry = priorReport != null;
const conventions = A.conventions || "";
const unitBlocksRendered = A.unitBlocksRendered || "";
const declaredFiles = A.declaredFiles || [];

// A literal, deliberately: 3 candidates is the recipe, not a knob.
const CANDIDATES = 3;

const candBranch = (i) => `recipe/${workstream.id}-cand${i}`;
const candTree = (i) => `${worktree}-cand${i}`;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const CANDIDATE_SCHEMA = {
  type: "object",
  required: [
    "committed",
    "filesChanged",
    "summary",
    "approach",
    "selfCheckPassed",
    "commits",
  ],
  properties: {
    committed: {
      type: "boolean",
      description: "code committed to YOUR candidate branch",
    },
    filesChanged: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    approach: {
      type: "string",
      description:
        "one or two sentences on the strategy you took, so the judge can weigh candidates by approach, not just by diff",
    },
    selfCheckPassed: {
      type: "boolean",
      description: "tsc + lint passed in your candidate worktree",
    },
    commits: {
      type: "array",
      items: { type: "string" },
      description: "shas from `git log --format=%H -n <count>`, verbatim",
    },
    deviations: {
      type: "string",
      description: "any files touched outside the declared set, justified",
    },
  },
};

// Same retry half-contract as implement-straight: the implementer must restate
// the NAMED cause and say what it did about it; the PARENT refuses the attempt
// before spending a verifier if the winner's `rootCauseAddressed` is empty
// (the #307 discipline).
const CANDIDATE_RETRY_SCHEMA = {
  type: "object",
  required: [...CANDIDATE_SCHEMA.required, "rootCause", "rootCauseAddressed"],
  properties: {
    ...CANDIDATE_SCHEMA.properties,
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

const JUDGE_SCHEMA = {
  type: "object",
  required: ["winner", "reasons", "perCandidate"],
  properties: {
    winner: {
      type: "integer",
      minimum: 0,
      maximum: CANDIDATES,
      description:
        "the ONE candidate to land (1-based). 0 = none acceptable — say why in reasons.",
    },
    reasons: {
      type: "string",
      description:
        "why the winner beat the others (or why none is acceptable) — concrete, from the diffs and test runs, not from the self-reports",
    },
    perCandidate: {
      type: "array",
      items: {
        type: "object",
        required: ["candidate", "committed", "verdict", "notes"],
        properties: {
          candidate: { type: "integer" },
          committed: {
            type: "boolean",
            description: "the candidate branch has commits ahead of the base",
          },
          verdict: {
            type: "string",
            description: "winner | rejected | disqualified",
          },
          notes: { type: "string" },
        },
      },
    },
  },
};

const CLEANUP_SCHEMA = {
  type: "object",
  required: ["headSha", "worktreeList", "recipeBranches"],
  properties: {
    mergeOk: {
      type: "boolean",
      description:
        "the ff-only merge landed cleanly (omit when no merge was ordered)",
    },
    headSha: {
      type: "string",
      description: "`git -C <worktree> rev-parse HEAD`, verbatim",
    },
    landedShas: {
      type: "array",
      items: { type: "string" },
      description:
        "`git -C <worktree> log --format=%H -n <count>`, verbatim (omit when no merge was ordered)",
    },
    worktreeList: {
      type: "string",
      description: "`git worktree list` output, verbatim",
    },
    recipeBranches: {
      type: "string",
      description:
        '`git branch --list "recipe/<ws.id>-*"` output, verbatim — an empty string when nothing prints, which is the required answer',
    },
    note: { type: "string" },
  },
};

// ---------------------------------------------------------------------------
// Phase 1 — fan out: CANDIDATES independent implementations in parallel.
// Every candidate cuts from the workstream branch HEAD it was handed — NOT
// from origin/main — so all candidates start from the same prerequisite
// commits. The prompt body below the setup block preserves the
// implement-straight semantics; the candidate framing is the one addition.
// ---------------------------------------------------------------------------
const candidateNumbers = Array.from({ length: CANDIDATES }, (_, k) => k + 1);

const candidateResults = await parallel(
  candidateNumbers.map(
    (i) => () =>
      agent(
        `${retryBlock ? `${retryBlock}\n\n` : ""}You are a ${workstream.lane} engineer. ${conventions}

You are candidate ${i} of ${CANDIDATES} independent attempts at the same unit. Produce your best independent implementation; do not look for or coordinate with the others.

First cut your own scratch worktree — run exactly, in this order:
1. \`git worktree add -b ${candBranch(i)} ${candTree(i)} ${branch}\`
   Cut from ${branch} — the workstream branch HEAD you were handed — NEVER from origin/main. Every candidate must start from the same prerequisite commits, and cutting anywhere else silently drops the stages this workstream was ordered after.
2. \`scripts/worktree-env.sh ${candTree(i)}\` — give it a test env. It is idempotent; a fresh worktree has no \`.env.local\`, so \`pnpm test\` fails every DB suite until you run it.

Then work ONLY in ${candTree(i)} on branch ${candBranch(i)}. Do not touch ${worktree} or any other candidate's tree.

You own ONE workstream of a larger track. Implement exactly the unit(s) below and NOTHING else — other agents are working other workstreams of this same track in parallel, and every file outside your declared list may be theirs. Touching one is how two worktrees collide at integration.

${unitBlocksRendered}

Your declared files — stay inside them:
${declaredFiles.map((f) => `  - ${f}`).join("\n") || "  (none declared)"}

Write code AND tests. Run \`pnpm typecheck\` and \`pnpm lint\` in ${candTree(i)} and fix what you can. Commit to ${candBranch(i)} (conventional commits). Do NOT push, do NOT open a PR, and do NOT merge anything — a judge picks one candidate and the loop integrates and ships the track. State your \`approach\` in a sentence or two so the judge can weigh strategies. Report every commit you made in \`commits\`, transcribed from \`git log --format=%H -n <count>\`. Return strictly the schema.`,
        {
          label: `cand${i}:${workstream.id}#${attempt}`,
          // Explicit — nested inside parallel(), so don't race the global phase().
          phase: "Build",
          agentType: A.implAgentType,
          schema: isRetry ? CANDIDATE_RETRY_SCHEMA : CANDIDATE_SCHEMA,
        }
      )
  )
);

const anyCommitted = candidateResults.some(
  (r) => r && (r.commits || []).length > 0
);

// ---------------------------------------------------------------------------
// Phase 2 — judge: one opus reviewer picks exactly ONE winner, or none.
// Skipped when no candidate committed anything — there is nothing to judge,
// and spending an opus agent to confirm three empty branches proves nothing.
// ---------------------------------------------------------------------------
let judge = null;
if (anyCommitted) {
  const candidateBlocks = candidateNumbers
    .map((i) => {
      const r = candidateResults[i - 1];
      return `### Candidate ${i}
- branch: \`${candBranch(i)}\`
- worktree: \`${candTree(i)}\`
- self-report: ${r ? JSON.stringify(r) : "(the candidate agent died — no self-report; it is disqualified unless its branch shows commits you can verify yourself)"}`;
    })
    .join("\n\n");

  judge = await agent(
    `You are the JUDGE for a generate-and-filter build attempt: ${CANDIDATES} independent agents each implemented the same workstream on their own branch, and you pick exactly ONE winner to land on ${branch}. You judge from the code, not from the self-reports — a self-report is a claim to check, never evidence.

The workstream (issue(s) ${(workstream.issues || []).map((n) => `#${n}`).join(", ") || "(none)"}):

${unitBlocksRendered}

Acceptance criteria the winner must satisfy:
${
  (workstream.units || [])
    .map((u) => (u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n"))
    .join("\n") || "  (none declared)"
}
${
  isRetry
    ? `
This attempt is a RETRY. A verifier rejected the prior work, and its STRUCTURED report is below, verbatim. Weigh every candidate against the root cause it NAMES — a candidate that does not remove that named cause cannot win, whatever else it improves:

\`\`\`json
${JSON.stringify(priorReport, null, 2)}
\`\`\`
`
    : ""
}
The candidates:

${candidateBlocks}

For EACH candidate, in order:
1. Read its full diff: \`git diff ${branch}..${candBranch("<i>")}\` — substitute the candidate number for \`<i>\`. A candidate whose diff is empty, or whose branch has no commits ahead of ${branch}, is DISQUALIFIED — record it and move on.
2. Run the tests that cover the declared files in THAT candidate's worktree (\`cd\` into it first): \`pnpm test ${declaredFiles.join(" ") || "<the relevant paths>"}\`. If a worktree has no \`.env.local\`, run \`scripts/worktree-env.sh <tree>\` first and re-run — a missing env is a harness problem, not the candidate's failure.
3. Judge on: correctness against the acceptance criteria, test quality (do the tests prove the ACs or just exercise the code?), staying inside the declared files, and simplicity — prefer the candidate a maintainer would rather own.

Declared files, for the diff-hygiene check:
${declaredFiles.map((f) => `  - ${f}`).join("\n") || "  (none declared)"}

Pick exactly ONE winner, or 0 if no candidate is acceptable — 0 is a real answer and better than landing a wrong one, but it fails the whole attempt, so use it for genuine unacceptability, not for taste. Do NOT fix any code, do NOT merge, do NOT push, do NOT delete anything — a cleanup step lands the winner and removes the scratch trees after you. Fill \`perCandidate\` for all ${CANDIDATES} candidates. Return strictly the schema.`,
    {
      label: `judge:${workstream.id}#${attempt}`,
      phase: "Verify",
      model: "opus",
      agentType: "code-reviewer",
      schema: JUDGE_SCHEMA,
    }
  );
}

// Resolve the winner defensively: the judge's pick must exist, be in range,
// and have self-reported commits we can assert the landed HEAD against. An
// unverifiable winner is no winner.
const pickedIdx = judge && Number.isInteger(judge.winner) ? judge.winner : 0;
const pickedReport =
  pickedIdx >= 1 && pickedIdx <= CANDIDATES
    ? candidateResults[pickedIdx - 1]
    : null;
const winnerOk = Boolean(pickedReport && (pickedReport.commits || []).length);
const winnerIdx = winnerOk ? pickedIdx : 0;
const winnerReport = winnerOk ? pickedReport : null;
// `git log --format=%H` prints newest first — [0] is the tip the merge must land.
const winnerTip = winnerOk ? pickedReport.commits[0] : null;
const winnerCount = winnerOk ? pickedReport.commits.length : 0;

// ---------------------------------------------------------------------------
// Phase 3 — land + clean. One haiku agent, transcribe-verbatim discipline:
// it runs fixed commands and copies what they printed; THIS SCRIPT does the
// asserting. The cleanup runs on EVERY path — winner or none — because
// leftover recipe/* refs are a contract violation the parent cannot see.
// ---------------------------------------------------------------------------
const removals = candidateNumbers
  .map(
    (i) =>
      `   \`git worktree remove ${candTree(i)} --force\` (ignore "not a working tree" if it never got created)`
  )
  .join("\n");
const branchDeletes = candidateNumbers.map((i) => candBranch(i)).join(" ");

const landStep = winnerOk
  ? `1. \`git -C ${worktree} merge --ff-only ${candBranch(winnerIdx)}\`
   This lands the winning candidate. It is ff-only ON PURPOSE: the candidate was cut from ${branch} HEAD, so it is strictly ahead and the merge is atomic — or it fails loudly. If it fails, do NOT retry without --ff-only, do NOT create a merge commit, do NOT resolve anything; report \`mergeOk: false\` and continue with the cleanup steps.
`
  : `1. There is NO merge to perform — no candidate won. Do NOT merge anything into ${branch}.
`;

const cleanup = await agent(
  `Land and clean up after a generate-and-filter build attempt. Run exactly these commands, in this order, and nothing that writes code:

${landStep}2. Remove every candidate worktree:
${removals}
3. \`git branch -D ${branchDeletes}\` (after the worktrees are removed — a branch checked out in a worktree cannot be deleted; ignore "not found" for branches that never got created)
4. \`git worktree prune\`

Then report, VERBATIM, what each of these printed — the loop asserts the state rather than trusting you, so transcribe, do not summarize:
  - \`git -C ${worktree} rev-parse HEAD\` → \`headSha\`${
    winnerOk
      ? `
  - \`git -C ${worktree} log --format=%H -n ${winnerCount}\` → \`landedShas\``
      : ""
  }
  - \`git worktree list\` → \`worktreeList\`
  - \`git branch --list "recipe/${workstream.id}-*"\` → \`recipeBranches\` — this MUST print nothing; if it prints anything, transcribe it anyway.

Do NOT push, do NOT touch origin, do NOT open a PR, do NOT edit labels or issues. Return strictly the schema.`,
  {
    label: `land:${workstream.id}#${attempt}`,
    phase: "Build",
    model: "haiku",
    effort: "low",
    schema: CLEANUP_SCHEMA,
  }
);

// ---------------------------------------------------------------------------
// Assertions + return. Every failure path returns commits: [] — the parent's
// empty-commits check turns that into a failed attempt. Nothing is hidden:
// the warning names what happened, including any leftover refs.
// ---------------------------------------------------------------------------
const perCandidateNotes = (judge?.perCandidate || [])
  .filter((p) => p && p.candidate !== winnerIdx && String(p.notes || "").trim())
  .map((p) => `cand${p.candidate} (${p.verdict}): ${p.notes}`);

if (!cleanup)
  return {
    summary: `${workstream.id}: the land-and-clean agent died on attempt ${attempt} — candidate refs may be left behind`,
    commits: [],
    warnings: [
      `the cleanup agent returned nothing — candidate worktrees ${candidateNumbers.map((i) => candTree(i)).join(", ")} and branches recipe/${workstream.id}-cand* may still exist and must be swept`,
      ...perCandidateNotes,
    ],
  };

const leftoverBranches = String(cleanup.recipeBranches || "").trim();
const leftoverTrees = candidateNumbers
  .map((i) => candTree(i))
  .filter((t) => String(cleanup.worktreeList || "").includes(t));
if (leftoverBranches || leftoverTrees.length)
  return {
    summary: `${workstream.id}: cleanup left recipe refs behind on attempt ${attempt}`,
    commits: [],
    warnings: [
      `leftover candidate refs after cleanup — branches: ${leftoverBranches || "(none)"}; worktrees: ${leftoverTrees.join(", ") || "(none)"} — the attempt is refused rather than reported clean over leftovers`,
      ...perCandidateNotes,
    ],
  };

if (!winnerOk)
  return {
    summary: `${workstream.id}: no acceptable candidate out of ${CANDIDATES} on attempt ${attempt}`,
    commits: [],
    warnings: [
      !anyCommitted
        ? `no candidate committed anything — all ${CANDIDATES} implementer agents died or produced empty branches`
        : judge
          ? pickedIdx !== winnerIdx
            ? `the judge picked candidate ${pickedIdx}, but that candidate has no verifiable self-reported commits — an unverifiable winner is no winner`
            : `judge: ${judge.reasons || "(no reasons given)"}`
          : `the judge agent died — no winner can be declared without a verdict`,
      ...perCandidateNotes,
    ],
  };

const landedHead = String(cleanup.headSha || "").trim();
if (cleanup.mergeOk === false || landedHead !== winnerTip)
  return {
    summary: `${workstream.id}: the winning candidate did not land on attempt ${attempt}`,
    commits: [],
    warnings: [
      cleanup.mergeOk === false
        ? `the ff-only merge of ${candBranch(winnerIdx)} into ${branch} failed — the candidate was not strictly ahead of the branch HEAD, which should be impossible unless something else moved ${branch} mid-attempt`
        : `after the merge, ${worktree} HEAD is ${landedHead || "(unreadable)"} but the winner's tip is ${winnerTip} — the landed state does not match the judged state, so the attempt is refused`,
      ...perCandidateNotes,
    ],
  };

return {
  summary: `${winnerReport.approach || winnerReport.summary || `candidate ${winnerIdx} won`} — judge: ${judge.reasons || "(no reasons given)"}`,
  commits: winnerReport.commits,
  warnings: [
    ...(winnerReport.deviations ? [winnerReport.deviations] : []),
    ...perCandidateNotes,
  ],
  ...(isRetry
    ? {
        rootCause: winnerReport.rootCause || "",
        rootCauseAddressed: winnerReport.rootCauseAddressed || "",
      }
    : {}),
};
