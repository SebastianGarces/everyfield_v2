export const meta = {
  name: "implement-straight",
  description:
    "The default build recipe: one implementer agent writes code and tests for one workstream attempt in a parent-provided worktree, commits to the workstream branch, and returns the commit shas.",
  whenToUse:
    "Child recipe of build-until-done only — never invoke directly. One call = one workstream attempt; dispatch selects it per unit (`recipe: implement-straight`, the default). Contract: ops/agent-os/recipes.md.",
};

// ---------------------------------------------------------------------------
// Recipe contract (ops/agent-os/recipes.md): implement the unit(s), commit to
// `branch` in `worktree`, return { summary, commits, warnings } — plus
// { rootCause, rootCauseAddressed } when priorReport is set. MUST NOT push,
// open PRs, edit labels or issues, merge to any branch other than `branch`,
// or call workflow() — nesting is one level and build-until-done is the
// parent. The parent snapshots origin refs around this call and fails the
// attempt on any drift.
// ---------------------------------------------------------------------------
const A = typeof args === "string" ? JSON.parse(args) : args;
if (!A || !A.workstream || !A.worktree || !A.branch)
  throw new Error(
    "implement-straight is a child recipe of build-until-done and takes recipeArgs: " +
      "{track, workstream, worktree, branch, stageIndex, attempt, priorReport, retryBlock, conventions, implAgentType, unitBlocksRendered, declaredFiles}"
  );

const workstream = A.workstream;
const worktree = A.worktree;
const branch = A.branch;
const attempt = A.attempt || 1;
const retryBlock = A.retryBlock || null;
const isRetry = A.priorReport != null;
const conventions = A.conventions || "";
const unitBlocksRendered = A.unitBlocksRendered || "";
const declaredFiles = A.declaredFiles || [];

const RESULT_SCHEMA = {
  type: "object",
  required: [
    "committed",
    "filesChanged",
    "summary",
    "selfCheckPassed",
    "commits",
  ],
  properties: {
    committed: {
      type: "boolean",
      description: "code committed to the workstream branch",
    },
    filesChanged: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    selfCheckPassed: {
      type: "boolean",
      description: "tsc + lint passed in the worktree",
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

// The retry contract — a fix must answer the ROOT CAUSE it was given. The
// retryBlock the parent renders carries the evidence verbatim; this schema is
// the other half: the implementer must restate the cause and say what it did
// about it, and the PARENT refuses the attempt before spending a verifier if
// `rootCauseAddressed` comes back empty (the #307 discipline).
const RETRY_RESULT_SCHEMA = {
  type: "object",
  required: [...RESULT_SCHEMA.required, "rootCause", "rootCauseAddressed"],
  properties: {
    ...RESULT_SCHEMA.properties,
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

// The ONE sanctioned delta from the pre-#399 inline prompt (AC3): the 3-way
// `setup` variant collapsed — retry text arrives pre-rendered as retryBlock,
// and the non-solo worktree creation moved to the parent's
// prepareWorkstreamTree. Everything below the setup line is byte-identical to
// the inline call this recipe extracted.
const impl = await agent(
  `${retryBlock ? `${retryBlock}\n\n` : ""}You are a ${workstream.lane} engineer. ${conventions}

Work in the existing worktree ${worktree}, which is already on branch ${branch} with a test env. Just \`cd\` into it.

You own ONE workstream of a larger track. Implement exactly the unit(s) below and NOTHING else — other agents are working other workstreams of this same track in parallel, and every file outside your declared list may be theirs. Touching one is how two worktrees collide at integration.

${unitBlocksRendered}

Your declared files — stay inside them:
${declaredFiles.map((f) => `  - ${f}`).join("\n") || "  (none declared)"}

Write code AND tests. Run \`pnpm typecheck\` and \`pnpm lint\` in ${worktree} and fix what you can. Commit to ${branch} (conventional commits). Do NOT push, do NOT open a PR, and do NOT merge anything — the loop integrates the workstreams and ships the track. Report every commit you made in \`commits\`, transcribed from \`git log --format=%H -n <count>\`. Return strictly the schema.`,
  {
    label: `impl:${workstream.id}#${attempt}`,
    phase: "Build",
    agentType: A.implAgentType,
    schema: isRetry ? RETRY_RESULT_SCHEMA : RESULT_SCHEMA,
  }
);

if (!impl)
  return {
    summary: `${workstream.id}: the implementer returned nothing on attempt ${attempt}`,
    commits: [],
    warnings: ["the implementer agent died — no commits were made"],
  };

return {
  summary: impl.summary || "",
  commits: impl.commits || [],
  warnings: impl.deviations ? [impl.deviations] : [],
  ...(isRetry
    ? {
        rootCause: impl.rootCause || "",
        rootCauseAddressed: impl.rootCauseAddressed || "",
      }
    : {}),
};
